// Pick an LLM implementation based on environment variables. Picks the
// first matching provider; falls back to canned scripts so unit tests and
// the offline demo still work.

import type { Llm } from "./client.js";
import { createLlm } from "./client.js";
import { createOpenRouterLlm } from "./openrouter.js";
import { createCannedLlm, defaultDemoScripts } from "./canned.js";

export interface PickLlmResult {
  llm: Llm;
  provider: "openrouter" | "anthropic" | "canned";
  model: string;
}

export function pickLlmFromEnv(): PickLlmResult {
  if (process.env.OPENROUTER_API_KEY) {
    const model = process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free";
    return {
      llm: createOpenRouterLlm({
        apiKey: process.env.OPENROUTER_API_KEY,
        model,
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
