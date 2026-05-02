/// REE driver: spawns the Gensyn `gensynai/ree` container per inference,
/// waits for exit, reads the receipt JSON, and returns text + receipt blob.
///
/// REE has no HTTP API. The official entry point is the `gensyn-sdk`
/// binary inside `gensynai/ree:v0.2.0`. We invoke `run-all` (prepare →
/// generate → decode → receipt) once per call, with a per-call task-dir
/// so concurrent calls don't clobber each other's artifacts.
///
/// Trade-offs:
///  - We share a single `--task-dir` per model name across calls so the
///    expensive ONNX export and MLIR compile only happen on the first
///    call for a given model. Subsequent calls overwrite prompt_tokens
///    and reuse model.onnx + compiled artifacts. Cold first call:
///    ~5min (Qwen 0.5B CPU); warm call: ~15s + tokens × 2s.
///  - Sharing requires serialization. We hold an in-process mutex around
///    every call. For Tribunal (one judge per case) that's fine.

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { keccak256 } from "ethers";

export interface ReeMessage { role: "system" | "user" | "assistant"; content: string }

export interface ReeInferRequest {
  model: string;
  messages: ReeMessage[];
  maxTokens?: number;
}

export interface ReeInferResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /// keccak256 of the on-disk receipt file bytes. Verifiers re-run REE
  /// `verify` against the served bytes; mutating the JSON would break
  /// reproducibility, so we hash the raw file contents.
  receiptHash: `0x${string}`;
  /// The receipt JSON file contents, as bytes.
  receiptBytes: Uint8Array;
}

export interface ReeClient {
  infer(req: ReeInferRequest): Promise<ReeInferResponse>;
}

export interface ReeClientOptions {
  /// Docker image. Default `gensynai/ree:v0.2.0`.
  image: string;
  /// Host-side cache dir bind-mounted to /home/gensyn/.cache inside the
  /// container. Holds HF model downloads + per-run task dirs.
  cacheRoot: string;
  /// Whether to pass `--cpu-only` to gensyn-sdk.
  cpuOnly: boolean;
  /// Hard timeout for a single docker run, ms.
  timeoutMs: number;
  /// Override docker binary path (mostly for tests).
  dockerBin?: string;
  /// Optional logger.
  log?: (line: string) => void;
}

/// Assemble system + chat messages into the single string REE accepts.
///
/// REE's `--prompt-text` is one string; gensyn-sdk applies the model's
/// chat template (`apply_chat_template([{role: "user", content: <text>}])`)
/// to it. There is no separate system slot, so we inline the system
/// prompt as the leading paragraph of the user content. For multi-turn
/// histories we interleave role markers.
export function flattenPrompt(system: string, messages: ReeMessage[]): string {
  if (messages.length === 0) return system.trim();
  if (messages.length === 1 && messages[0]!.role === "user") {
    return `${system.trim()}\n\n${messages[0]!.content.trim()}`;
  }
  const turns = messages.map((m) => {
    const tag = m.role === "user" ? "USER" : m.role === "assistant" ? "ASSISTANT" : "SYSTEM";
    return `${tag}: ${m.content.trim()}`;
  });
  return `${system.trim()}\n\n${turns.join("\n\n")}`;
}

const inflightLock: { p: Promise<void> } = { p: Promise.resolve() };
async function withSerial<T>(fn: () => Promise<T>): Promise<T> {
  const prev = inflightLock.p;
  let release!: () => void;
  inflightLock.p = new Promise<void>((r) => { release = r; });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
}

async function findNewReceipt(taskDir: string, exclude: Set<string>): Promise<string> {
  const all: string[] = [];
  await walk(taskDir, all);
  const matches = all
    .filter((p) => /\/receipt_[^/]*\.json$/.test(p))
    .filter((p) => !exclude.has(p))
    .sort();
  if (matches.length === 0) {
    throw new Error(`new receipt_*.json not found under ${taskDir} (had ${exclude.size} pre-existing)`);
  }
  return matches[matches.length - 1]!;
}

interface ReceiptParse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/// REE receipt schema (v1.1.0):
///   { model: { name, commit_hash, ... },
///     input:  { prompt, parameters: {...} },
///     output: { text_output, token_count, finish_reason, ... },
///     hashes: { receipt_hash } }
///
/// We strip the model's EOS marker from `text_output` (Qwen emits
/// `<|im_end|>` etc.) so callers get clean text. Input tokens aren't
/// recorded in the receipt — we report 0 rather than guess. The
/// on-chain anchoring doesn't depend on token counts.
function parseReceipt(json: any): ReceiptParse {
  const raw: unknown = json?.output?.text_output ?? json?.text_output;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("REE receipt missing output.text_output");
  }
  const text = raw.replace(/<\|im_end\|>\s*$/, "").replace(/<\|endoftext\|>\s*$/, "").trim();
  const outputTokens = Number(json?.output?.token_count ?? 0) | 0;
  return { text, inputTokens: 0, outputTokens };
}

export function createReeClient(opts: ReeClientOptions): ReeClient {
  const dockerBin = opts.dockerBin ?? "docker";
  const log = opts.log ?? ((l) => process.stdout.write(l));

  return {
    async infer(req) {
      return withSerial(async () => {
        const containerCache = "/home/gensyn/.cache";
        // One task-dir per model name (slashes sanitized) — see the
        // top-of-file note on why we share across calls.
        const safeModel = req.model.replace(/[^A-Za-z0-9._-]/g, "__");
        const hostTaskDirRel = path.posix.join("gensyn", "tribunal", safeModel);
        const hostTaskDir = path.join(opts.cacheRoot, hostTaskDirRel);
        const containerTaskDir = path.posix.join(containerCache, hostTaskDirRel);
        await fs.mkdir(hostTaskDir, { recursive: true });
        // Track which receipt this call produces by snapshotting the
        // receipt set before invocation. After exit the new receipt is
        // (current set) − (snapshot).
        const beforeReceipts = new Set<string>();
        const preWalk: string[] = [];
        await walk(hostTaskDir, preWalk);
        for (const p of preWalk) if (/\/receipt_[^/]*\.json$/.test(p)) beforeReceipts.add(p);

        const promptText = flattenPrompt(
          req.messages.find((m) => m.role === "system")?.content ?? "",
          req.messages.filter((m) => m.role !== "system"),
        );

        const args = [
          "run", "--rm",
          "-v", `${opts.cacheRoot}:${containerCache}`,
          opts.image,
          "run-all",
          "--task-dir", containerTaskDir,
          "--model-name", req.model,
          "--prompt-text", promptText,
          "--max-new-tokens", String(req.maxTokens ?? 256),
          "--operation-set", "reproducible",
        ];
        if (opts.cpuOnly) args.push("--cpu-only");

        log(`[ree] docker run ${req.model} → ${hostTaskDir}\n`);

        const stderrBuf: string[] = [];
        await new Promise<void>((resolve, reject) => {
          const child = spawn(dockerBin, args, { stdio: ["ignore", "pipe", "pipe"] });
          const t = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`REE timeout after ${opts.timeoutMs}ms`));
          }, opts.timeoutMs);
          child.stdout.on("data", (b) => log(`[ree] ${b.toString()}`));
          child.stderr.on("data", (b) => { const s = b.toString(); stderrBuf.push(s); log(`[ree.err] ${s}`); });
          child.on("error", (e) => { clearTimeout(t); reject(e); });
          child.on("close", (code) => {
            clearTimeout(t);
            if (code !== 0) {
              return reject(new Error(`REE exit ${code}: ${stderrBuf.join("").slice(-400)}`));
            }
            resolve();
          });
        });

        const receiptPath = await findNewReceipt(hostTaskDir, beforeReceipts);
        const receiptBytes = await fs.readFile(receiptPath);
        const receiptHash = keccak256(receiptBytes) as `0x${string}`;
        const json = JSON.parse(receiptBytes.toString("utf8"));
        const { text, inputTokens, outputTokens } = parseReceipt(json);

        return { text, inputTokens, outputTokens, receiptHash, receiptBytes: new Uint8Array(receiptBytes) };
      });
    },
  };
}

export function defaultCacheRoot(): string {
  return process.env.REE_CACHE_ROOT
    ? path.resolve(process.env.REE_CACHE_ROOT)
    : path.join(os.homedir(), ".cache");
}
