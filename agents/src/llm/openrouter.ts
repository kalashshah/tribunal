// OpenRouter LLM client. Uses the OpenAI-compatible Chat Completions
// endpoint so we don't need the openai SDK — just fetch.
//
// OpenRouter routes to many providers. Free models worth trying:
//   meta-llama/llama-3.3-70b-instruct:free   (strong general)
//   google/gemini-2.0-flash-exp:free         (fast, good JSON)
//   deepseek/deepseek-chat:free              (strong reasoning)

import type { Llm, CompleteArgs, CompleteResult } from "./client.js";

export interface CreateOpenRouterOpts {
  apiKey: string;
  model: string;
  /// Optional. OpenRouter recommends setting these for analytics; harmless either way.
  appUrl?: string;
  appTitle?: string;
  fetchImpl?: typeof fetch;
}

export function createOpenRouterLlm(opts: CreateOpenRouterOpts): Llm {
  const f = opts.fetchImpl ?? fetch;
  return {
    async complete(args: CompleteArgs): Promise<CompleteResult> {
      const res = await f("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          ...(opts.appUrl   ? { "HTTP-Referer": opts.appUrl } : {}),
          ...(opts.appTitle ? { "X-Title": opts.appTitle } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: args.maxTokens ?? 2048,
          messages: [
            { role: "system", content: args.system },
            ...args.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
      }
      const body = (await res.json()) as {
        choices: { message: { content: string } }[];
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
