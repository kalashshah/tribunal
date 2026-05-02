/// Environment-driven config for the enclave service.
///
/// Set MOCK_ATTESTATION=1 (default in dev) to skip the real REE call and
/// return a stub receipt + canned model output. This lets the rest of
/// Tribunal develop end-to-end without booting the full Gensyn container
/// or downloading multi-GB ONNX weights. Flip to 0 to hit a real REE
/// instance at REE_URL.

export interface EnclaveConfig {
  port: number;
  reeUrl: string;
  mockAttestation: boolean;
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
  defaultModel: string;
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(): EnclaveConfig {
  const port = Number(process.env.PORT ?? 9000);
  const reeUrl = (process.env.REE_URL ?? "http://127.0.0.1:8088").replace(/\/$/, "");
  const mockAttestation = bool(process.env.MOCK_ATTESTATION, true);
  const receiptBaseUrl = (process.env.RECEIPT_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const enclavePrivKey = process.env.ENCLAVE_PRIVKEY
    ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const apiToken = process.env.ENCLAVE_API_TOKEN || undefined;
  const defaultModel = process.env.REE_MODEL ?? "llama-3.2-3b-instruct";
  return { port, reeUrl, mockAttestation, receiptBaseUrl, enclavePrivKey, apiToken, defaultModel };
}
