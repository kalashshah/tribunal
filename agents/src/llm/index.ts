// Pick an LLM implementation based on environment variables.
//
// Selection precedence (top wins):
//   1. LLM_PROVIDER=ree|openai|openrouter|anthropic|canned — explicit override
//   2. OPENAI_API_KEY      — default for demos (paid, reliable JSON)
//   3. OPENROUTER_API_KEY  — free fallback chain for debugging
//   4. ANTHROPIC_API_KEY
//   5. canned (offline demo)
//
// `ree` routes through the local Gensyn REE enclave service. Use
// pickJudgeLlmFromEnv when you want only the judge on REE while the rest
// of the demo stays on OpenRouter/OpenAI.

import type { Llm } from "./client.js";
import { createLlm } from "./client.js";
import { createOpenAiLlm } from "./openai.js";
import { createOpenRouterLlm, DEFAULT_FREE_FALLBACKS } from "./openrouter.js";
import { createCannedLlm, defaultDemoScripts } from "./canned.js";
import { createReeLlm } from "./ree.js";

export type LlmProvider = "ree" | "openai" | "openrouter" | "anthropic" | "canned";

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

function buildRee(envPrefix: "" | "JUDGE_" = ""): PickLlmResult {
  const baseUrl = process.env[`${envPrefix}REE_URL`] ?? process.env.REE_URL ?? "http://127.0.0.1:9000";
  const model   = process.env[`${envPrefix}REE_MODEL`] ?? process.env.REE_MODEL ?? "llama-3.2-3b-instruct";
  const apiToken = process.env[`${envPrefix}REE_TOKEN`] ?? process.env.REE_TOKEN;
  return {
    llm: createReeLlm({ baseUrl, model, apiToken }),
    provider: "ree",
    model,
  };
}

function buildForced(forced: LlmProvider): PickLlmResult | null {
  switch (forced) {
    case "ree":        return buildRee();
    case "openai":     return buildOpenAi();
    case "openrouter": return buildOpenRouter();
    case "anthropic":  return buildAnthropic();
    case "canned":     return buildCanned();
  }
}

export function pickLlmFromEnv(): PickLlmResult {
  const forced = (process.env.LLM_PROVIDER ?? "").toLowerCase() as LlmProvider | "";
  if (forced) {
    const built = buildForced(forced as LlmProvider);
    if (built) return built;
    throw new Error(`LLM_PROVIDER=${forced} but no matching API key in env`);
  }
  return buildOpenAi() ?? buildOpenRouter() ?? buildAnthropic() ?? buildCanned();
}

/// Pick an LLM specifically for the judge role. Lets the demo run lawyers
/// on a fast paid/free model while the judge runs on REE for verifiable
/// inference. Falls back to pickLlmFromEnv when no judge override is set.
///   JUDGE_LLM_PROVIDER=ree → REE
///   JUDGE_LLM_PROVIDER=<other> → that provider, with JUDGE_*_MODEL etc. respected
export function pickJudgeLlmFromEnv(): PickLlmResult {
  const forced = (process.env.JUDGE_LLM_PROVIDER ?? "").toLowerCase() as LlmProvider | "";
  if (!forced) return pickLlmFromEnv();
  if (forced === "ree") return buildRee("JUDGE_");
  const built = buildForced(forced as LlmProvider);
  if (built) return built;
  throw new Error(`JUDGE_LLM_PROVIDER=${forced} but no matching API key in env`);
}
