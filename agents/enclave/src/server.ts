/// Tribunal judge enclave service.
///
/// Endpoints:
///   POST /complete    Accepts an Llm-shape prompt, runs gensynai/ree via
///                     `docker run`, persists the receipt JSON, returns
///                     text + receipt pointer.
///   POST /judge       Higher-level: takes a verdict envelope and signs
///                     it with the enclave key for on-chain anchoring.
///   GET  /receipts/:hash   Serves the stored receipt blob by keccak hash.
///   GET  /attestation Returns the enclave's pubkey + (placeholder) attestation.
///   GET  /health      Liveness probe + REE image readiness.
///
/// Storage: in-memory map of receipts keyed by keccak256(receipt_bytes).
/// Receipts are also kept on disk under <cacheRoot>/gensyn/runs/<uuid>
/// for `gensyn-sdk verify`. Restarting the service drops the in-memory
/// index; verifiers can still fetch the receipt from the on-disk path
/// printed in the docker run logs.

import * as http from "node:http";
import { Wallet } from "ethers";
import { loadConfig, type EnclaveConfig } from "./config.js";
import { createReeClient, type ReeClient, type ReeMessage } from "./ree-client.js";
import { signEnvelope } from "./sign.js";

interface CompleteBody {
  model?: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  /// Currently advisory — REE does not implement JSON-mode. The judge
  /// already retries on parse failure, so we forward the prompt verbatim.
  responseFormat?: "json";
}

interface JudgeBody {
  caseId: string;
  prevailingIsAccuser: boolean;
  opinionHash: `0x${string}`;
  receiptHash: `0x${string}`;
  receiptUrl: string;
}

const receiptStore = new Map<string, Uint8Array>();

function jsonResponse(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function checkAuth(req: http.IncomingMessage, cfg: EnclaveConfig): boolean {
  if (!cfg.apiToken) return true;
  const h = req.headers["authorization"];
  return typeof h === "string" && h === `Bearer ${cfg.apiToken}`;
}

async function handleComplete(req: http.IncomingMessage, res: http.ServerResponse, cfg: EnclaveConfig, ree: ReeClient) {
  if (!checkAuth(req, cfg)) return jsonResponse(res, 401, { error: "unauthorized" });
  let body: CompleteBody;
  try { body = await readJson<CompleteBody>(req); } catch { return jsonResponse(res, 400, { error: "bad json" }); }
  if (!body.system || !Array.isArray(body.messages)) {
    return jsonResponse(res, 400, { error: "missing system/messages" });
  }

  const reeMessages: ReeMessage[] = [
    { role: "system", content: body.system },
    ...body.messages.map((m) => ({ role: m.role, content: m.content }) as ReeMessage),
  ];

  const r = await ree.infer({
    model: body.model ?? cfg.defaultModel,
    messages: reeMessages,
    maxTokens: body.maxTokens,
  });

  receiptStore.set(r.receiptHash.toLowerCase(), r.receiptBytes);

  jsonResponse(res, 200, {
    text: r.text,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    receipt: {
      hash: r.receiptHash,
      url: `${cfg.receiptBaseUrl}/receipts/${r.receiptHash}`,
    },
  });
}

async function handleJudge(req: http.IncomingMessage, res: http.ServerResponse, cfg: EnclaveConfig) {
  if (!checkAuth(req, cfg)) return jsonResponse(res, 401, { error: "unauthorized" });
  let body: JudgeBody;
  try { body = await readJson<JudgeBody>(req); } catch { return jsonResponse(res, 400, { error: "bad json" }); }
  const signed = await signEnvelope(body, cfg.enclavePrivKey);
  jsonResponse(res, 200, signed);
}

function handleReceiptGet(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? "";
  const m = url.match(/^\/receipts\/(0x[0-9a-fA-F]{64})$/);
  if (!m) return jsonResponse(res, 404, { error: "bad receipt id" });
  const blob = receiptStore.get(m[1]!.toLowerCase());
  if (!blob) return jsonResponse(res, 404, { error: "not found" });
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(blob);
}

function handleAttestation(res: http.ServerResponse, cfg: EnclaveConfig) {
  const wallet = new Wallet(cfg.enclavePrivKey);
  jsonResponse(res, 200, {
    enclaveAddress: wallet.address,
    enclavePubkey: wallet.signingKey.publicKey,
    mode: "ree",
    image: cfg.reeImage,
    defaultModel: cfg.defaultModel,
    attestation: "",
  });
}

async function main() {
  const cfg = loadConfig();
  const ree = createReeClient({
    image: cfg.reeImage,
    cacheRoot: cfg.cacheRoot,
    cpuOnly: cfg.cpuOnly,
    timeoutMs: cfg.reeTimeoutMs,
  });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return jsonResponse(res, 200, { ok: true, image: cfg.reeImage });
      if (req.method === "GET" && req.url === "/attestation") return handleAttestation(res, cfg);
      if (req.method === "GET" && req.url?.startsWith("/receipts/")) return handleReceiptGet(req, res);
      if (req.method === "POST" && req.url === "/complete") return await handleComplete(req, res, cfg, ree);
      if (req.method === "POST" && req.url === "/judge") return await handleJudge(req, res, cfg);
      return jsonResponse(res, 404, { error: "not found" });
    } catch (e: any) {
      console.error("[enclave] error:", e);
      return jsonResponse(res, 500, { error: String(e?.message ?? e) });
    }
  });
  server.listen(cfg.port, () => {
    const enclaveAddr = new Wallet(cfg.enclavePrivKey).address;
    console.log(`[enclave] listening on :${cfg.port}`);
    console.log(`[enclave] image=${cfg.reeImage} model=${cfg.defaultModel} cpuOnly=${cfg.cpuOnly}`);
    console.log(`[enclave] cacheRoot=${cfg.cacheRoot} enclave=${enclaveAddr}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
