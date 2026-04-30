// web/lib/siwe.test.ts
import { describe, it, expect } from "vitest";
import { Wallet, hashMessage } from "ethers";
import { verifyTribunalAuth } from "./siwe";

describe("verifyTribunalAuth", () => {
  it("accepts a valid signature whose address matches", async () => {
    const w = Wallet.createRandom();
    const msg = `tribunal-auth\naddress: ${w.address.toLowerCase()}\nnonce: abc123\nissued-at: 2026-04-30T00:00:00Z`;
    const sig = await w.signMessage(msg);
    const ok = verifyTribunalAuth({ address: w.address, message: msg, signature: sig });
    expect(ok).toBe(true);
  });

  it("rejects a signature from a different key", async () => {
    const w1 = Wallet.createRandom();
    const w2 = Wallet.createRandom();
    const msg = `tribunal-auth\naddress: ${w1.address.toLowerCase()}\nnonce: x\nissued-at: 2026-04-30T00:00:00Z`;
    const sig = await w2.signMessage(msg);
    const ok = verifyTribunalAuth({ address: w1.address, message: msg, signature: sig });
    expect(ok).toBe(false);
  });

  it("rejects a message that doesn't start with 'tribunal-auth'", async () => {
    const w = Wallet.createRandom();
    const msg = `bogus\naddress: ${w.address}\n`;
    const sig = await w.signMessage(msg);
    expect(verifyTribunalAuth({ address: w.address, message: msg, signature: sig })).toBe(false);
  });
});
