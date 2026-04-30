// OpenAI Chat Completions client. Uses the same OpenAI-compatible shape as
// our OpenRouter client, but talks directly to api.openai.com so we don't
// share the OpenRouter free-model rate-limit pool — important for demos.
//
// Selection precedence in pickLlmFromEnv():
//   1. OPENAI_API_KEY      — default for actual demos (paid, reliable JSON)
//   2. OPENROUTER_API_KEY  — free fallback chain for debugging
//   3. ANTHROPIC_API_KEY   — direct Anthropic SDK
//   4. canned scripts (offline demo)

import type { Llm, CompleteArgs, CompleteResult } from "./client.js";

export interface CreateOpenAiOpts {
  apiKey: string;
  model: string;
  organization?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenAiLlm(opts: CreateOpenAiOpts): Llm {
  const f = opts.fetchImpl ?? fetch;
  return {
    async complete(args: CompleteArgs): Promise<CompleteResult> {
      const res = await f("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          ...(opts.organization ? { "OpenAI-Organization": opts.organization } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
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
        const body = await res.text();
        throw new Error(`OpenAI HTTP ${res.status}: ${body}`);
      }
      const body = (await res.json()) as {
        choices: { message: { content: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: body.choices[0]?.message?.content ?? "",
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      };
    },
  };
}
