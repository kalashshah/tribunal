import { describe, expect, it, vi } from "vitest";
import { createClerk } from "../../src/roles/clerk";

async function flushMicrotasks() {
  // Drain microtask queue so the clerk's background persist/anchor IIFE runs.
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("createClerk.handleIncoming", () => {
  it("forwards immediately, then uploads to 0G + anchors on-chain in background", async () => {
    const upload = vi.fn(async () => ({ rootHash: "0xrh" as const, txHash: "0xtx" as const }));
    const anchorEvent = vi.fn(async () => ({ txHash: "0xanchor" }));
    const forward = vi.fn(async () => undefined);
    const onPersisted = vi.fn();
    const clerk = createClerk({
      caseId: 1n,
      storage: { upload, download: vi.fn() } as any,
      tribunal: { anchorEvent, acceptCase: vi.fn(), submitRuling: vi.fn(), appendJudgeMemory: vi.fn(), markSettled: vi.fn() } as any,
      forward,
      onPersisted,
    });

    const ev = await clerk.handleIncoming({
      from: "PEER_LAWYER_A",
      payload: { kind: "argument", from: "lawyer-A", body: "evidence" },
    });

    expect(ev.seq).toBe(1);
    expect(ev.kind).toBe("argument");
    expect(forward).toHaveBeenCalledWith(ev);
    expect(clerk.transcript().length).toBe(1);

    await flushMicrotasks();
    expect(upload).toHaveBeenCalledOnce();
    expect(anchorEvent).toHaveBeenCalledWith(1n, ev.contentHash);
    expect(onPersisted).toHaveBeenCalledWith(1, {
      rootHash: "0xrh",
      storageTxHash: "0xtx",
      storageTxSeq: undefined,
      anchorTxHash: "0xanchor",
    });
  });

  it("monotonic sequence numbers across multiple incomings", async () => {
    const clerk = createClerk({
      caseId: 1n,
      storage: { upload: vi.fn(async () => ({ rootHash: "0x" as const, txHash: "0x" as const })), download: vi.fn() } as any,
      tribunal: { anchorEvent: vi.fn(async () => ({ txHash: "0x" })), acceptCase: vi.fn(), submitRuling: vi.fn(), appendJudgeMemory: vi.fn(), markSettled: vi.fn() } as any,
      forward: () => Promise.resolve(),
    });
    const a = await clerk.handleIncoming({ from: "P", payload: { kind: "argument", from: "L1", body: "x" } });
    const b = await clerk.handleIncoming({ from: "P", payload: { kind: "argument", from: "L2", body: "y" } });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
  });
});
