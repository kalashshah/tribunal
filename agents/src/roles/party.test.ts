import { describe, expect, it, vi } from "vitest";
import { createPartyAgent } from "./party";

function fakeLlm(response: string) {
  return { complete: vi.fn(async () => ({ text: response, inputTokens: 1, outputTokens: 1 })) };
}

describe("createPartyAgent", () => {
  it("builds a party agent with correct side and ensName", () => {
    const llm = fakeLlm("I delivered the report on time.");
    const agent = createPartyAgent({
      side: "accuser",
      ensName: "alice.tribunal.eth",
      accusation: "Alice failed to deliver the report.",
      llm: llm as any,
      model: "demo",
    });
    expect(agent.side).toBe("accuser");
    expect(agent.ensName).toBe("alice.tribunal.eth");
  });

  it("system prompt contains 'accuser' for accuser side", async () => {
    const llm = fakeLlm("  I delivered it.  ");
    const agent = createPartyAgent({
      side: "accuser",
      ensName: "alice.tribunal.eth",
      accusation: "Alice failed to deliver the report.",
      llm: llm as any,
      model: "demo",
    });
    await agent.answer("When did you deliver?", "transcript line 1");
    const callArgs = llm.complete.mock.calls[0]![0] as any;
    expect(callArgs.system).toContain("accuser");
    expect(callArgs.system).toContain("alice.tribunal.eth");
    expect(callArgs.system).toContain("Alice failed to deliver the report.");
  });

  it("system prompt contains 'defendant' for defendant side", async () => {
    const llm = fakeLlm("I never received notice.");
    const agent = createPartyAgent({
      side: "defendant",
      ensName: "bob.tribunal.eth",
      accusation: "Bob failed to pay.",
      llm: llm as any,
      model: "demo",
    });
    await agent.answer("Did you receive notice?", "");
    const callArgs = llm.complete.mock.calls[0]![0] as any;
    expect(callArgs.system).toContain("defendant");
    expect(callArgs.system).toContain("bob.tribunal.eth");
  });

  it("user message contains the question and transcript snippet", async () => {
    const llm = fakeLlm("Yes, I have the receipt.");
    const agent = createPartyAgent({
      side: "accuser",
      ensName: "alice.tribunal.eth",
      accusation: "Failure to pay.",
      llm: llm as any,
      model: "demo",
    });
    await agent.answer("Do you have the receipt?", "prior transcript line");
    const callArgs = llm.complete.mock.calls[0]![0] as any;
    expect(callArgs.messages).toHaveLength(1);
    expect(callArgs.messages[0].role).toBe("user");
    expect(callArgs.messages[0].content).toContain("Do you have the receipt?");
    expect(callArgs.messages[0].content).toContain("prior transcript line");
  });

  it("answer trims whitespace from LLM output", async () => {
    const llm = fakeLlm("  \n  trimmed answer  \n  ");
    const agent = createPartyAgent({
      side: "defendant",
      ensName: "bob.tribunal.eth",
      accusation: "Bob failed to pay.",
      llm: llm as any,
      model: "demo",
    });
    const result = await agent.answer("Explain yourself.", "");
    expect(result).toBe("trimmed answer");
  });

  it("maxTokens is set to 500", async () => {
    const llm = fakeLlm("answer");
    const agent = createPartyAgent({
      side: "accuser",
      ensName: "alice.tribunal.eth",
      accusation: "test",
      llm: llm as any,
      model: "demo",
    });
    await agent.answer("q", "t");
    const callArgs = llm.complete.mock.calls[0]![0] as any;
    expect(callArgs.maxTokens).toBe(500);
  });
});
