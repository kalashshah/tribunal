import { describe, expect, it } from "vitest";
import { Transcript } from "./transcript";

describe("Transcript", () => {
  it("appends events with monotonic sequence numbers", () => {
    const t = new Transcript("case-1");
    const a = t.append({ kind: "filing", from: "alice.tribunal.eth", body: "I delivered." });
    const b = t.append({ kind: "argument", from: "lawyer-A", body: "Evidence at ipfs://..." });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(t.size()).toBe(2);
  });

  it("computes a stable content hash that differs for different positions", () => {
    const t = new Transcript("c");
    const a = t.append({ kind: "filing", from: "x", body: "y" });
    const b = t.append({ kind: "filing", from: "x", body: "y" });
    expect(a.contentHash).not.toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("renders the transcript as plain text in arrival order", () => {
    const t = new Transcript("c");
    t.append({ kind: "filing",   from: "alice", body: "I delivered." });
    t.append({ kind: "argument", from: "lawyer-A", body: "Evidence." });
    expect(t.render()).toBe(
      "[filing] alice: I delivered.\n[argument] lawyer-A: Evidence.",
    );
  });
});
