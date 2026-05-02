/// Environment-driven config for the enclave service.
///
/// The enclave is REE-only — no mock path. For dev runs that don't want
/// 30s+ inference latency, point the agents runner at LLM_PROVIDER=canned
/// (or openrouter) instead of routing through this service.

import { defaultCacheRoot } from "./ree-client.js";

export interface EnclaveConfig {
  port: number;
  /// Public URL the enclave advertises for receipt blobs (so verifiers
  /// can fetch them). When the enclave serves receipts over its own HTTP
  /// surface (the default), this is just the enclave's own base URL.
  receiptBaseUrl: string;
  /// Hex private key used to sign verdict envelopes. In a real TEE this
  /// is sealed inside the enclave; here it's just env-loaded so the
  /// surrounding flow is identical now and after the TEE swap.
  enclavePrivKey: string;
  /// Optional bearer token required on incoming /complete requests. When
  /// unset, the service is open (fine for localhost dev).
  apiToken?: string;
  /// Default REE model when /complete doesn't specify one.
  defaultModel: string;
  /// Gensyn REE Docker image tag.
  reeImage: string;
  /// Host cache root mounted into the REE container as /home/gensyn/.cache.
  cacheRoot: string;
  /// Pass --cpu-only to gensyn-sdk. Default true; flip off when REE_CPU_ONLY=0
  /// and an NVIDIA runtime is configured on the host docker.
  cpuOnly: boolean;
  /// Hard timeout per docker run (ms). Cold first-call exports ONNX, which
  /// dominates latency; default 30 minutes.
  reeTimeoutMs: number;
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(): EnclaveConfig {
  const port = Number(process.env.PORT ?? 9000);
  const receiptBaseUrl = (process.env.RECEIPT_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const enclavePrivKey = process.env.ENCLAVE_PRIVKEY
    ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const apiToken = process.env.ENCLAVE_API_TOKEN || undefined;
  const defaultModel = process.env.REE_MODEL ?? "Qwen/Qwen2.5-0.5B-Instruct";
  const reeImage = process.env.REE_IMAGE ?? "gensynai/ree:v0.2.0";
  const cacheRoot = defaultCacheRoot();
  const cpuOnly = bool(process.env.REE_CPU_ONLY, true);
  const reeTimeoutMs = Number(process.env.REE_TIMEOUT_MS ?? 30 * 60_000);
  return { port, receiptBaseUrl, enclavePrivKey, apiToken, defaultModel, reeImage, cacheRoot, cpuOnly, reeTimeoutMs };
}
