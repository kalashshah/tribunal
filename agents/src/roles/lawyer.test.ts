import { describe, expect, it, vi } from "vitest";
import { createLawyer } from "./lawyer";

function deps() {
  const llm = { complete: vi.fn(async () => ({ text: "claim... evidence... conclusion.", inputTokens: 1, outputTokens: 1 })) };
  const axl = { send: vi.fn(async () => {}), peerId: vi.fn(async () => "PEER_LAWYER"), recv: vi.fn() };
  return { llm, axl };
}

function lawyer({ llm, axl }: ReturnType<typeof deps>) {
  return createLawyer({
    side: "accuser",
    brief: "Alice claims she delivered the report.",
    ensName: "lawyer-quinn.tribunal.eth",
    clerkPeerId: "PEER_CLERK",
    caseId: "1",
    llm: llm as any,
    axl: axl as any,
    model: "claude-sonnet-4-6",
  });
}

describe("Lawyer", () => {
  it("opening statement: prompts the LLM and sends the result to the clerk over AXL", async () => {
    const d = deps();
    const text = await lawyer(d).openingStatement();
    expect(text).toBe("claim... evidence... conclusion.");
    expect(d.llm.complete).toHaveBeenCalledOnce();
    expect(d.axl.send).toHaveBeenCalledWith(
      "PEER_CLERK",
      expect.objectContaining({
        kind: "argument",
        from: "lawyer-quinn.tribunal.eth",
        body: "claim... evidence... conclusion.",
        meta: { side: "accuser", caseId: "1" },
      }),
    );
  });

  it("rebuttal: includes the opposing argument in the prompt", async () => {
    const d = deps();
    await lawyer(d).rebuttal("Defendant says no delivery occurred.");
    const args = d.llm.complete.mock.calls[0]![0] as any;
    expect(args.messages[0].content).toContain("Defendant says no delivery occurred.");
  });

  it("closing statement: includes the transcript text", async () => {
    const d = deps();
    await lawyer(d).closingStatement("[filing] alice: ...\n[argument] lawyer-A: ...");
    const args = d.llm.complete.mock.calls[0]![0] as any;
    expect(args.messages[0].content).toContain("[filing] alice");
  });
});
