// OpenRouter LLM client. Uses the OpenAI-compatible Chat Completions
// endpoint so we don't need the openai SDK — just fetch.
//
// Free models on OpenRouter share an upstream pool, so any single model
// can be momentarily rate-limited. The client takes a primary model plus
// an optional fallback chain. On 429/502/503/504 it tries the next model.

import type { Llm, CompleteArgs, CompleteResult } from "./client.js";

export interface CreateOpenRouterOpts {
  apiKey: string;
  model: string;
  /// Optional ordered list of models to try if `model` is rate-limited or
  /// the upstream provider is briefly down. Tried left-to-right.
  fallbackModels?: string[];
  /// Optional. OpenRouter recommends setting these for analytics; harmless either way.
  appUrl?: string;
  appTitle?: string;
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/// Default fallback chain — well-known free models that span multiple
/// upstream providers, so when one is congested another is usually free.
export const DEFAULT_FREE_FALLBACKS = [
  "openai/gpt-oss-20b:free",
  "openai/gpt-oss-120b:free",
  "google/gemma-3-27b-it:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "meta-llama/llama-3.2-3b-instruct:free",
];

export function createOpenRouterLlm(opts: CreateOpenRouterOpts): Llm {
  const f = opts.fetchImpl ?? fetch;

  async function tryModel(model: string, args: CompleteArgs): Promise<{ ok: true; result: CompleteResult } | { ok: false; status: number; body: string }> {
    const res = await f("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
        ...(opts.appUrl   ? { "HTTP-Referer": opts.appUrl } : {}),
        ...(opts.appTitle ? { "X-Title": opts.appTitle } : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: args.maxTokens ?? 2048,
        messages: [
          { role: "system", content: args.system },
          ...args.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        ...(args.responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text() };
    }
    const body = (await res.json()) as {
      choices: {
        message: { content: string | null; reasoning?: string | null };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    // Some "thinking" models (nemotron-nano, hermes) return their answer in
    // `reasoning` and leave `content` null. Fall back so callers don't see
    // empty strings.
    const message = body.choices[0]?.message;
    const text = message?.content ?? message?.reasoning ?? "";
    return {
      ok: true,
      result: {
        text,
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }

  return {
    async complete(args: CompleteArgs): Promise<CompleteResult> {
      const chain = [opts.model, ...(opts.fallbackModels ?? [])];
      const errors: string[] = [];
      for (const m of chain) {
        const r = await tryModel(m, args);
        if (r.ok) return r.result;
        // Retryable upstream conditions → try next model.
        if (RETRYABLE_STATUSES.has(r.status)) {
          errors.push(`${m}: HTTP ${r.status}`);
          continue;
        }
        // Non-retryable (e.g. 401 bad key, 400 bad request) — fail fast.
        throw new Error(`OpenRouter HTTP ${r.status}: ${r.body}`);
      }
      throw new Error(`OpenRouter all models exhausted: ${errors.join("; ")}`);
    },
  };
}
