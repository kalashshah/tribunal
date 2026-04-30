// Pick an LLM implementation based on environment variables.
//
// Selection precedence (top wins):
//   1. LLM_PROVIDER=openai|openrouter|anthropic|canned  — explicit override
//   2. OPENAI_API_KEY      — default for demos (paid, reliable JSON)
//   3. OPENROUTER_API_KEY  — free fallback chain for debugging
//   4. ANTHROPIC_API_KEY
//   5. canned (offline demo)
//
// Set `LLM_PROVIDER=openrouter` (with OPENROUTER_API_KEY also set) to force
// the free chain even when OPENAI_API_KEY is configured — useful while
// iterating on prompts without burning paid credits.

import type { Llm } from "./client.js";
import { createLlm } from "./client.js";
import { createOpenAiLlm } from "./openai.js";
import { createOpenRouterLlm, DEFAULT_FREE_FALLBACKS } from "./openrouter.js";
import { createCannedLlm, defaultDemoScripts } from "./canned.js";

export type LlmProvider = "openai" | "openrouter" | "anthropic" | "canned";

export interface PickLlmResult {
  llm: Llm;
  provider: LlmProvider;
  model: string;
}

function buildOpenAi(): PickLlmResult | null {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  return {
    llm: createOpenAiLlm({
      apiKey: process.env.OPENAI_API_KEY,
      model,
      organization: process.env.OPENAI_ORG,
    }),
    provider: "openai",
    model,
  };
}

function buildOpenRouter(): PickLlmResult | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const model = process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-20b:free";
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

function buildAnthropic(): PickLlmResult | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  return {
    llm: createLlm({ apiKey: process.env.ANTHROPIC_API_KEY, model }),
    provider: "anthropic",
    model,
  };
}

function buildCanned(): PickLlmResult {
  return {
    llm: createCannedLlm(defaultDemoScripts()),
    provider: "canned",
    model: "demo-canned",
  };
}

export function pickLlmFromEnv(): PickLlmResult {
  const forced = (process.env.LLM_PROVIDER ?? "").toLowerCase() as LlmProvider | "";
  if (forced) {
    const built =
      forced === "openai"     ? buildOpenAi()     :
      forced === "openrouter" ? buildOpenRouter() :
      forced === "anthropic"  ? buildAnthropic()  :
      forced === "canned"     ? buildCanned()     : null;
    if (built) return built;
    throw new Error(`LLM_PROVIDER=${forced} but no matching API key in env`);
  }
  return buildOpenAi() ?? buildOpenRouter() ?? buildAnthropic() ?? buildCanned();
}
