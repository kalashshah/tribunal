import { describe, expect, it, vi } from "vitest";
import { createClerk } from "./clerk";

describe("createClerk.handleIncoming", () => {
  it("appends, uploads to 0G, anchors hash on-chain, then forwards", async () => {
    const upload = vi.fn(async () => ({ rootHash: "0xrh" as const, txHash: "0xtx" as const }));
    const anchorEvent = vi.fn(async () => undefined);
    const forward = vi.fn(async () => undefined);
    const clerk = createClerk({
      caseId: 1n,
      storage: { upload, download: vi.fn() } as any,
      tribunal: { anchorEvent, acceptCase: vi.fn(), submitRuling: vi.fn(), appendJudgeMemory: vi.fn(), markSettled: vi.fn() } as any,
      forward,
    });

    const ev = await clerk.handleIncoming({
      from: "PEER_LAWYER_A",
      payload: { kind: "argument", from: "lawyer-A", body: "evidence" },
    });

    expect(ev.seq).toBe(1);
    expect(ev.kind).toBe("argument");
    expect(upload).toHaveBeenCalledOnce();
    expect(anchorEvent).toHaveBeenCalledWith(1n, ev.contentHash);
    expect(forward).toHaveBeenCalledWith(ev);
    expect(clerk.transcript().length).toBe(1);
  });

  it("monotonic sequence numbers across multiple incomings", async () => {
    const clerk = createClerk({
      caseId: 1n,
      storage: { upload: vi.fn(async () => ({ rootHash: "0x" as const, txHash: "0x" as const })), download: vi.fn() } as any,
      tribunal: { anchorEvent: vi.fn(), acceptCase: vi.fn(), submitRuling: vi.fn(), appendJudgeMemory: vi.fn(), markSettled: vi.fn() } as any,
      forward: () => Promise.resolve(),
    });
    const a = await clerk.handleIncoming({ from: "P", payload: { kind: "argument", from: "L1", body: "x" } });
    const b = await clerk.handleIncoming({ from: "P", payload: { kind: "argument", from: "L2", body: "y" } });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
  });
});
