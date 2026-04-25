import Anthropic from "@anthropic-ai/sdk";

export interface LlmMessage { role: "user" | "assistant"; content: string }

export interface CompleteArgs {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Llm {
  complete(args: CompleteArgs): Promise<CompleteResult>;
}

export interface CreateLlmOpts {
  sdk?: Anthropic;
  apiKey?: string;
  model: string;
}

export function createLlm(opts: CreateLlmOpts): Llm {
  const sdk = opts.sdk ?? new Anthropic({ apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY! });
  return {
    async complete(args) {
      const resp = await sdk.messages.create({
        model: opts.model,
        max_tokens: args.maxTokens ?? 2048,
        system: args.system,
        messages: args.messages,
      });
      const block = resp.content.find((c) => c.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      return {
        text: block?.text ?? "",
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
      };
    },
  };
}
