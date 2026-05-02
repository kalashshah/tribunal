import { describe, it, expect, vi } from "vitest";
import { createJudge } from "../../src/roles/judge.js";

describe("judge.deliberateAndRule (rulebook loop)", () => {
  it("runs LOOKUP→RULE, anchors chain root, appends iNFT memory", async () => {
    const responses = [
      { text: "LOOKUP: 7.4.2",                                              receipt: { hash: "0xaa", url: "u1" } },
      { text: 'RULE: {"prevailingIsAccuser":true,"opinion":"per Art. 7.4.2"}', receipt: { hash: "0xbb", url: "u2" } },
    ];
    let i = 0;
    const llm = { complete: vi.fn(async () => responses[i++] as any) };
    const axl = { send: vi.fn(async () => {}), peerId: vi.fn(async () => "p") };
    const tribunal = {
      anchorEvent: vi.fn(), acceptCase: vi.fn(),
      submitRuling: vi.fn(),
      appendJudgeMemory: vi.fn(),
      markSettled: vi.fn(),
      finalizeVerdict: vi.fn(async () => ({ txHash: "0xtx" })),
      finalizeVerdictWithReceipt: vi.fn(async () => ({ txHash: "0xtx" })),
    };
    const storage = { upload: vi.fn(async () => ({ rootHash: "0xchain", txHash: "0xtx", txSeq: 1 })), download: vi.fn() };
    const rulebook = {
      toc:  [{ id: "7.4.2", title: "Full compensation" }, { id: "1.7", title: "Good faith" }],
      byId: new Map([
        ["7.4.2", { id: "7.4.2", title: "Full compensation", body: "compensate" }],
        ["1.7",   { id: "1.7",   title: "Good faith",        body: "good faith" }],
      ]),
    };

    const judge = createJudge({
      ensName: "judge.eth", caseId: 7n, tokenId: 1n, personaPrompt: "p", priorRulings: [],
      llm: llm as any, axl: axl as any, tribunal: tribunal as any, clerkPeerId: "c", model: "m",
      partyEns: { accuser: "a", defendant: "b" }, partyAddress: { accuser: "0x1", defendant: "0x2" },
      backendUrl: "http://x", mode: "auto",
      rulebook, storage: storage as any,
      chainUrl: (h) => `0g://${h}`,
    });

    const ruling = await judge.deliberateAndRule("alice vs bob");
    expect(ruling.prevailingIsAccuser).toBe(true);
    expect(tribunal.submitRuling).toHaveBeenCalled();
    expect(tribunal.appendJudgeMemory).toHaveBeenCalled();
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(ruling.receipt?.hash).toBe("0xchain");
    expect(ruling.receipt?.url).toBe("0g://0xchain");
  });
});
