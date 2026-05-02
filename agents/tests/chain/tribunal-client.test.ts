import { describe, expect, it, vi } from "vitest";
import { createTribunalClient } from "../../src/chain/tribunal-client";

function fakeTx() {
  return { wait: vi.fn(async () => ({ status: 1 })) };
}

describe("createTribunalClient", () => {
  it("anchors a content hash via TribunalCore.recordEvent and waits for the tx", async () => {
    const tx = fakeTx();
    const recordEvent = vi.fn(async () => tx);
    const client = createTribunalClient({
      tribunalCore: { recordEvent } as any,
      judgeINFT: { appendRulingMemory: vi.fn() } as any,
    });
    await client.anchorEvent(1n, "0xabc");
    expect(recordEvent).toHaveBeenCalledWith(1n, "0xabc");
    expect(tx.wait).toHaveBeenCalledOnce();
  });

  it("submits a ruling and forwards args verbatim", async () => {
    const submitRuling = vi.fn(async () => fakeTx());
    const client = createTribunalClient({
      tribunalCore: { submitRuling, recordEvent: vi.fn(), acceptCase: vi.fn(), markSettled: vi.fn() } as any,
      judgeINFT: { appendRulingMemory: vi.fn() } as any,
    });
    await client.submitRuling(7n, true, "0xdeadbeef");
    expect(submitRuling).toHaveBeenCalledWith(7n, true, "0xdeadbeef");
  });

  it("appends judge memory via JudgeINFT.appendRulingMemory", async () => {
    const appendRulingMemory = vi.fn(async () => fakeTx());
    const client = createTribunalClient({
      tribunalCore: { recordEvent: vi.fn(), submitRuling: vi.fn(), acceptCase: vi.fn(), markSettled: vi.fn() } as any,
      judgeINFT: { appendRulingMemory } as any,
    });
    await client.appendJudgeMemory(3n, "0xabc");
    expect(appendRulingMemory).toHaveBeenCalledWith(3n, "0xabc");
  });

  it("only exposes postVerdict when a verdictLog dependency was injected", async () => {
    const without = createTribunalClient({
      tribunalCore: { recordEvent: vi.fn(), submitRuling: vi.fn(), acceptCase: vi.fn(), markSettled: vi.fn() } as any,
      judgeINFT: { appendRulingMemory: vi.fn() } as any,
    });
    expect(without.postVerdict).toBeUndefined();

    const post = vi.fn(async () => fakeTx());
    const withLog = createTribunalClient({
      tribunalCore: { recordEvent: vi.fn(), submitRuling: vi.fn(), acceptCase: vi.fn(), markSettled: vi.fn() } as any,
      judgeINFT: { appendRulingMemory: vi.fn() } as any,
      verdictLog: { post } as any,
    });
    await withLog.postVerdict!(1n, true, "0xroot");
    expect(post).toHaveBeenCalledWith(1n, true, "0xroot");
  });
});
