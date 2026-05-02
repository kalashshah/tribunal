// REE-backed Llm. Calls the local enclave service (`agents/enclave/`),
// which wraps Gensyn's Reproducible Execution Environment container and
// returns both the model output and a verifiable receipt.
//
// The enclave service exposes:
//   POST /complete  { system, messages, responseFormat?, model? }
//                -> { text, inputTokens, outputTokens, receipt: { hash, url } }
//
// Compared to OpenRouter/OpenAI: same Llm interface, no fallback chain
// (REE is single-model by design — switching models would invalidate the
// reproducibility guarantee for the run), and an extra `receipt` field on
// the result that callers MAY pass through to chain settlement.

import type { Llm, CompleteArgs, CompleteResult, CompletionReceipt } from "./client.js";

export interface CreateReeOpts {
  /// Base URL of the enclave service. Default http://127.0.0.1:9000.
  baseUrl?: string;
  /// Model identifier the enclave exposes (e.g. "llama-3.2-3b-instruct").
  /// Forwarded as a hint; the enclave decides which weights to load.
  model: string;
  /// Optional bearer token if the enclave service requires auth.
  apiToken?: string;
  /// Request timeout in ms. REE in reproducible mode is slow on CPU —
  /// default is generous.
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createReeLlm(opts: CreateReeOpts): Llm {
  const f = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? "http://127.0.0.1:9000").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return {
    async complete(args: CompleteArgs): Promise<CompleteResult> {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await f(`${baseUrl}/complete`, {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "content-type": "application/json",
            ...(opts.apiToken ? { authorization: `Bearer ${opts.apiToken}` } : {}),
          },
          body: JSON.stringify({
            model: opts.model,
            system: args.system,
            messages: args.messages,
            maxTokens: args.maxTokens,
            responseFormat: args.responseFormat,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`REE ${res.status}: ${body.slice(0, 200)}`);
        }
        const j = await res.json() as {
          text: string;
          inputTokens?: number;
          outputTokens?: number;
          receipt?: { hash: string; url: string };
        };
        const receipt: CompletionReceipt | undefined =
          j.receipt && typeof j.receipt.hash === "string" && typeof j.receipt.url === "string"
            ? { hash: j.receipt.hash as `0x${string}`, url: j.receipt.url }
            : undefined;
        return {
          text: j.text,
          inputTokens: j.inputTokens ?? 0,
          outputTokens: j.outputTokens ?? 0,
          receipt,
        };
      } finally {
        clearTimeout(t);
      }
    },
  };
}
