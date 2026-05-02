import { describe, it, expect, vi } from "vitest";
import { buildChainManifest, uploadChainManifest } from "../../src/judge/chain.js";

const sampleChain = [
  { index: 0, kind: "lookup" as const, articleIds: ["7.4.2"], receiptHash: "0xaa", receiptUrl: "u1", prevHash: null },
  { index: 1, kind: "rule"   as const, receiptHash: "0xbb", receiptUrl: "u2", prevHash: "0xaa" },
];

describe("buildChainManifest", () => {
  it("emits a manifest with case + ruling + steps", () => {
    const m = buildChainManifest({
      caseId: "42", model: "qwen-0.5b",
      ruling: { prevailingIsAccuser: true, opinion: "per Art. 7.4.2" },
      chain: sampleChain,
    });
    expect(m.caseId).toBe("42");
    expect(m.ruling.opinion).toContain("7.4.2");
    expect(m.chain).toEqual(sampleChain);
    expect(m.version).toBe("tribunal-chain-v1");
  });
});

describe("uploadChainManifest", () => {
  it("uploads manifest bytes to 0G and returns the rootHash", async () => {
    const storage = { upload: vi.fn(async (b: Uint8Array) => ({ rootHash: "0xchain", txHash: "0xtx", txSeq: 7 })) };
    const url = (h: string) => `0g://${h}`;
    const out = await uploadChainManifest({
      storage: storage as any,
      manifest: buildChainManifest({
        caseId: "1", model: "m",
        ruling: { prevailingIsAccuser: false, opinion: "o" }, chain: sampleChain,
      }),
      url,
    });
    expect(out.rootHash).toBe("0xchain");
    expect(out.url).toBe("0g://0xchain");
    expect(storage.upload).toHaveBeenCalledOnce();
  });
});
