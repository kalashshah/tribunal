/// Tribunal judge enclave service.
///
/// Endpoints:
///   POST /complete    Accepts an Llm-shape prompt, runs REE, persists
///                     the receipt blob, returns text + receipt pointer.
///   POST /judge       Higher-level: takes a verdict envelope and signs
///                     it for on-chain anchoring. Optional — the simpler
///                     /complete path covers the current judge wiring.
///   GET  /receipts/:hash   Serves stored receipt blobs by their keccak hash.
///   GET  /attestation Returns the enclave's pubkey + (mock) attestation.
///   GET  /health      Liveness probe.
///
/// Storage today: in-memory map of receipts. Fine for hackathon demos —
/// a fresh trial is the typical run. For longer-lived deployments, swap
/// for IPFS or S3 in `storeReceipt`.

import * as http from "node:http";
import { keccak256, toUtf8Bytes, Wallet } from "ethers";
import { loadConfig, type EnclaveConfig } from "./config.js";
import { createReeClient, type ReeClient, type ReeMessage } from "./ree-client.js";
import { signEnvelope } from "./sign.js";

interface CompleteBody {
  model?: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
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

function storeReceipt(blob: unknown): { hash: `0x${string}`; key: string } {
  const bytes = new TextEncoder().encode(JSON.stringify(blob));
  const hash = keccak256(bytes) as `0x${string}`;
  receiptStore.set(hash, bytes);
  return { hash, key: hash };
}

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

/// Fallback "complete" used in mock mode: deterministic, no model boot
/// required. Returns valid judge-shape JSON so the demo flow doesn't get
/// blocked on REE container readiness during development.
function mockComplete(body: CompleteBody): { text: string; inputTokens: number; outputTokens: number; rawReceipt: unknown } {
  const accuser = /accuser|alice/i.test(body.messages.map(m => m.content).join("\n"));
  const text = JSON.stringify({
    prevailingIsAccuser: accuser,
    opinion: "[mock REE judge] ruling produced by the development enclave (MOCK_ATTESTATION=1). The transcript was reviewed and the prevailing side is determined by the dominant party identifier present in the docket. Replace with a real REE run by setting MOCK_ATTESTATION=0 and pointing REE_URL at a live container.",
  });
  return {
    text,
    inputTokens: body.system.length + body.messages.reduce((n, m) => n + m.content.length, 0),
    outputTokens: text.length,
    rawReceipt: {
      mode: "mock",
      model: body.model ?? "mock-judge",
      promptDigest: keccak256(toUtf8Bytes(body.system + JSON.stringify(body.messages))),
      generatedAt: new Date().toISOString(),
    },
  };
}

async function handleComplete(req: http.IncomingMessage, res: http.ServerResponse, cfg: EnclaveConfig, ree: ReeClient) {
  if (!checkAuth(req, cfg)) return jsonResponse(res, 401, { error: "unauthorized" });
  let body: CompleteBody;
  try { body = await readJson<CompleteBody>(req); } catch { return jsonResponse(res, 400, { error: "bad json" }); }
  if (!body.system || !Array.isArray(body.messages)) {
    return jsonResponse(res, 400, { error: "missing system/messages" });
  }

  let text: string, inputTokens: number, outputTokens: number, rawReceipt: unknown;
  if (cfg.mockAttestation) {
    const m = mockComplete(body);
    text = m.text; inputTokens = m.inputTokens; outputTokens = m.outputTokens; rawReceipt = m.rawReceipt;
  } else {
    const reeMessages: ReeMessage[] = [
      { role: "system", content: body.system },
      ...body.messages.map((m) => ({ role: m.role, content: m.content }) as ReeMessage),
    ];
    const r = await ree.infer({
      model: body.model ?? cfg.defaultModel,
      messages: reeMessages,
      maxTokens: body.maxTokens ?? 1024,
      mode: "reproducible",
      emitReceipt: true,
    });
    text = r.text;
    inputTokens = r.inputTokens ?? 0;
    outputTokens = r.outputTokens ?? 0;
    rawReceipt = r.receipt ?? { warning: "REE returned no receipt blob" };
  }

  const { hash } = storeReceipt(rawReceipt);
  jsonResponse(res, 200, {
    text,
    inputTokens,
    outputTokens,
    receipt: {
      hash,
      url: `${cfg.receiptBaseUrl}/receipts/${hash}`,
    },
  });
}

async function handleJudge(req: http.IncomingMessage, res: http.ServerResponse, cfg: EnclaveConfig) {
  if (!checkAuth(req, cfg)) return jsonResponse(res, 401, { error: "unauthorized" });
  let body: JudgeBody;
  try { body = await readJson<JudgeBody>(req); } catch { return jsonResponse(res, 400, { error: "bad json" }); }
  const signed = await signEnvelope(body, cfg.enclavePrivKey, cfg.mockAttestation);
  jsonResponse(res, 200, signed);
}

function handleReceiptGet(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? "";
  const m = url.match(/^\/receipts\/(0x[0-9a-fA-F]{64})$/);
  if (!m) return jsonResponse(res, 404, { error: "bad receipt id" });
  const blob = receiptStore.get(m[1]!.toLowerCase()) ?? receiptStore.get(m[1]!);
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
    mode: cfg.mockAttestation ? "mock" : "tee",
    attestation: cfg.mockAttestation ? "mock-attestation" : "(real attestation quote not yet wired)",
  });
}

async function main() {
  const cfg = loadConfig();
  const ree = createReeClient(cfg.reeUrl);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return jsonResponse(res, 200, { ok: true, mode: cfg.mockAttestation ? "mock" : "tee" });
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
    console.log(`[enclave] mode=${cfg.mockAttestation ? "MOCK" : "REAL-REE"} ree=${cfg.reeUrl} enclave=${enclaveAddr}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
