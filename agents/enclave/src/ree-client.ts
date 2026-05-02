/// Thin client for the Gensyn REE container's HTTP API.
///
/// The container is launched in `--serve` mode (see docker-compose.yml)
/// and exposes `/infer` for prompt-in / tokens-out plus a receipt blob.
/// Exact request/response shapes track the Gensyn docs at
/// https://docs.gensyn.ai/tech/ree/get-started — adjust if upstream
/// changes.

export interface ReeMessage { role: "system" | "user" | "assistant"; content: string }

export interface ReeInferRequest {
  model: string;
  messages: ReeMessage[];
  maxTokens?: number;
  /// "reproducible" yields bitwise-identical outputs across hardware at
  /// the cost of latency. Use for verifiable judging. "default" is fast
  /// for development.
  mode?: "reproducible" | "deterministic" | "default";
  /// When set, REE responds with a JSON-serialisable receipt blob in
  /// addition to the text. We always set this true.
  emitReceipt?: boolean;
}

export interface ReeInferResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /// Opaque receipt object as returned by REE. We don't introspect it —
  /// we hash and persist it so anyone can re-run REE in verify mode and
  /// confirm the verdict.
  receipt?: unknown;
}

export interface ReeClient {
  infer(req: ReeInferRequest): Promise<ReeInferResponse>;
}

export function createReeClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ReeClient {
  const u = baseUrl.replace(/\/$/, "");
  return {
    async infer(req) {
      const res = await fetchImpl(`${u}/infer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "reproducible",
          emitReceipt: true,
          ...req,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`REE ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as ReeInferResponse;
    },
  };
}
