// Pick an LLM implementation based on environment variables. Picks the
// first matching provider; falls back to canned scripts so unit tests and
// the offline demo still work.

import type { Llm } from "./client.js";
import { createLlm } from "./client.js";
import { createOpenRouterLlm, DEFAULT_FREE_FALLBACKS } from "./openrouter.js";
import { createCannedLlm, defaultDemoScripts } from "./canned.js";

export interface PickLlmResult {
  llm: Llm;
  provider: "openrouter" | "anthropic" | "canned";
  model: string;
}

export function pickLlmFromEnv(): PickLlmResult {
  if (process.env.OPENROUTER_API_KEY) {
    const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-20b:free";
    // Build the fallback chain: the configured model first, then the
    // defaults (de-duped so we don't try the configured model twice).
    const fallbackModels = DEFAULT_FREE_FALLBACKS.filter((m) => m !== model);
    return {
      llm: createOpenRouterLlm({
        apiKey: process.env.OPENROUTER_API_KEY,
        model,
        fallbackModels,
        appUrl: "https://github.com/kalashshah/tribunal",
        appTitle: "Tribunal",
      }),
      provider: "openrouter",
      model,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
    return {
      llm: createLlm({ apiKey: process.env.ANTHROPIC_API_KEY, model }),
      provider: "anthropic",
      model,
    };
  }
  return {
    llm: createCannedLlm(defaultDemoScripts()),
    provider: "canned",
    model: "demo-canned",
  };
}
