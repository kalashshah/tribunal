import { describe, expect, it, vi } from "vitest";
import { createJudge } from "../../src/roles/judge";

function deps(text: string) {
  const llm = { complete: vi.fn(async () => ({ text, inputTokens: 1, outputTokens: 1 })) };
  const axl = { send: vi.fn(async () => {}), peerId: vi.fn(async () => "PEER_J"), recv: vi.fn() };
  const tribunal = {
    anchorEvent: vi.fn(),
    acceptCase: vi.fn(),
    submitRuling: vi.fn(async () => {}),
    appendJudgeMemory: vi.fn(async () => {}),
    markSettled: vi.fn(),
  };
  return { llm, axl, tribunal };
}

function judge(d: ReturnType<typeof deps>) {
  return createJudge({
    ensName: "judge-athena.tribunal.eth",
    caseId: 1n,
    tokenId: 7n,
    personaPrompt: "You are a careful textualist.",
    priorRulings: [],
    llm: d.llm as any,
    axl: d.axl as any,
    tribunal: d.tribunal as any,
    clerkPeerId: "PEER_CLERK",
    model: "claude-sonnet-4-6",
  });
}

describe("Judge.deliberateAndRule", () => {
  it("parses JSON ruling, emits over AXL, submits on-chain, and appends iNFT memory", async () => {
    const d = deps('{"prevailingIsAccuser": true, "opinion": "Alice delivered."}');
    const ruling = await judge(d).deliberateAndRule("transcript text");
    expect(ruling).toEqual({ prevailingIsAccuser: true, opinion: "Alice delivered." });
    expect(d.tribunal.submitRuling).toHaveBeenCalledOnce();
    expect(d.tribunal.appendJudgeMemory).toHaveBeenCalledOnce();
    expect(d.axl.send).toHaveBeenCalledWith(
      "PEER_CLERK",
      expect.objectContaining({ kind: "ruling", from: "judge-athena.tribunal.eth" }),
    );
  });

  it("strips ```json fencing if the LLM wraps the JSON", async () => {
    const d = deps('```json\n{"prevailingIsAccuser": false, "opinion": "Bob wins."}\n```');
    const ruling = await judge(d).deliberateAndRule("t");
    expect(ruling.prevailingIsAccuser).toBe(false);
  });

  it("throws when ruling JSON is malformed", async () => {
    const d = deps('not json');
    await expect(judge(d).deliberateAndRule("t")).rejects.toThrow();
    expect(d.tribunal.submitRuling).not.toHaveBeenCalled();
  });

  it("throws when required fields are missing", async () => {
    const d = deps('{"opinion": "no verdict"}');
    await expect(judge(d).deliberateAndRule("t")).rejects.toThrow(/missing required fields/);
  });
});
