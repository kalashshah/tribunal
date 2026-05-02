import { describe, expect, it, vi } from "vitest";
import { createLlm } from "../../src/llm/client";

describe("createLlm.complete", () => {
  it("calls SDK with system + messages and returns extracted text", async () => {
    const create = vi.fn(async () => ({
      content: [{ type: "text", text: "ruling: party A wins" }],
      usage: { input_tokens: 10, output_tokens: 4 },
    }));
    const sdk = { messages: { create } };
    const llm = createLlm({ sdk: sdk as any, model: "claude-sonnet-4-6" });
    const out = await llm.complete({
      system: "You are judge-athena.",
      messages: [{ role: "user", content: "Decide." }],
    });
    expect(out).toEqual({ text: "ruling: party A wins", inputTokens: 10, outputTokens: 4 });
    expect(create).toHaveBeenCalledWith({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: "You are judge-athena.",
      messages: [{ role: "user", content: "Decide." }],
    });
  });

  it("returns empty string when SDK returns no text block", async () => {
    const create = vi.fn(async () => ({
      content: [{ type: "tool_use", name: "x", input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const llm = createLlm({ sdk: { messages: { create } } as any, model: "m" });
    const out = await llm.complete({ system: "s", messages: [] });
    expect(out.text).toBe("");
  });

  it("respects custom maxTokens", async () => {
    const create = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const llm = createLlm({ sdk: { messages: { create } } as any, model: "m" });
    await llm.complete({ system: "s", messages: [], maxTokens: 256 });
    expect(create.mock.calls[0]![0].max_tokens).toBe(256);
  });
});
