import Anthropic from "@anthropic-ai/sdk";

export interface LlmMessage { role: "user" | "assistant"; content: string }

export interface CompleteArgs {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  /// When "json", requests strict JSON output from the provider where
  /// supported (OpenRouter forwards via response_format). Caller is still
  /// responsible for parsing — providers can ignore the hint.
  responseFormat?: "json";
}

/// Cryptographic receipt produced by a verifiable inference backend (REE).
/// `hash` is the keccak256 of the receipt blob; `url` points at the blob
/// (IPFS, S3, or the enclave's local /receipts endpoint). Backends without
/// verifiable inference omit this field entirely.
export interface CompletionReceipt {
  hash: `0x${string}`;
  url: string;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  receipt?: CompletionReceipt;
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
