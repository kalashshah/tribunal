import { describe, it, expect, vi } from "vitest";
import { runDeliberateLoop, parseStep } from "../../src/judge/deliberate-loop.js";

describe("parseStep", () => {
  it("parses a LOOKUP line", () => {
    expect(parseStep("LOOKUP: 7.4.2, 7.1.7")).toEqual({
      kind: "lookup", ids: ["7.4.2", "7.1.7"],
    });
  });

  it("parses a RULE block", () => {
    const text = 'RULE: {"prevailingIsAccuser":true,"opinion":"per Art. 7.4.2"}';
    expect(parseStep(text)).toEqual({
      kind: "rule",
      ruling: { prevailingIsAccuser: true, opinion: "per Art. 7.4.2" },
    });
  });

  it("strips a leading code fence", () => {
    expect(parseStep("```\nLOOKUP: 1.7\n```")).toEqual({
      kind: "lookup", ids: ["1.7"],
    });
  });

  it("returns malformed when neither marker present", () => {
    const r = parseStep("hmm let me think");
    expect(r.kind).toBe("malformed");
  });
});

describe("runDeliberateLoop", () => {
  const toc = [
    { id: "7.4.2", title: "Full compensation" },
    { id: "1.7",   title: "Good faith" },
  ];
  const lookup = (id: string) => ({ id, title: `t${id}`, body: `body of ${id}` });

  it("loops LOOKUP → RULE and produces a chain of receipts", async () => {
    const responses = [
      { text: "LOOKUP: 7.4.2",                                           receipt: { hash: "0xaa", url: "u1" } },
      { text: 'RULE: {"prevailingIsAccuser":true,"opinion":"o"}',         receipt: { hash: "0xbb", url: "u2" } },
    ];
    let i = 0;
    const llm = { complete: vi.fn(async () => responses[i++] as any) };
    const out = await runDeliberateLoop({
      llm: llm as any,
      systemBase: "you are a judge",
      transcript: "alice vs bob",
      toc,
      lookupArticle: (id) => lookup(id),
      maxLookups: 3,
      maxArticles: 5,
    });
    expect(out.ruling.prevailingIsAccuser).toBe(true);
    expect(out.chain.length).toBe(2);
    expect(out.chain[0]).toMatchObject({ kind: "lookup", receiptHash: "0xaa", prevHash: null });
    expect(out.chain[1]).toMatchObject({ kind: "rule",   receiptHash: "0xbb", prevHash: "0xaa" });
  });

  it("re-prompts once on malformed output", async () => {
    const responses = [
      { text: "I would like to think...", receipt: { hash: "0x01", url: "u" } },
      { text: 'RULE: {"prevailingIsAccuser":false,"opinion":"o"}', receipt: { hash: "0x02", url: "u" } },
    ];
    let i = 0;
    const llm = { complete: vi.fn(async () => responses[i++] as any) };
    const out = await runDeliberateLoop({
      llm: llm as any, systemBase: "s", transcript: "t",
      toc, lookupArticle: lookup, maxLookups: 3, maxArticles: 5,
    });
    expect(out.ruling.prevailingIsAccuser).toBe(false);
  });

  it("rejects unknown article ids and asks again", async () => {
    const responses = [
      { text: "LOOKUP: 9.9.9",                                          receipt: { hash: "0x1", url: "u" } },
      { text: "LOOKUP: 7.4.2",                                          receipt: { hash: "0x2", url: "u" } },
      { text: 'RULE: {"prevailingIsAccuser":true,"opinion":"o"}',        receipt: { hash: "0x3", url: "u" } },
    ];
    let i = 0;
    const llm = { complete: vi.fn(async () => responses[i++] as any) };
    const out = await runDeliberateLoop({
      llm: llm as any, systemBase: "s", transcript: "t",
      toc, lookupArticle: lookup, maxLookups: 3, maxArticles: 5,
    });
    expect(out.chain.length).toBe(3);
  });

  it("caps total iterations and throws if no RULE emitted", async () => {
    const llm = { complete: vi.fn(async () => ({ text: "LOOKUP: 1.7", receipt: { hash: "0x", url: "u" } } as any)) };
    await expect(runDeliberateLoop({
      llm: llm as any, systemBase: "s", transcript: "t",
      toc, lookupArticle: lookup, maxLookups: 2, maxArticles: 5,
    })).rejects.toThrow(/exceeded max lookups/);
  });

  it("aborts after 3 consecutive malformed responses", async () => {
    const llm = { complete: vi.fn(async () => ({ text: "uhh let me think", receipt: { hash: "0xm", url: "u" } } as any)) };
    await expect(runDeliberateLoop({
      llm: llm as any, systemBase: "s", transcript: "t",
      toc, lookupArticle: lookup, maxLookups: 5, maxArticles: 5,
    })).rejects.toThrow(/3 times in a row/);
  });

  it("allows maxLookups LOOKUPs followed by a RULE", async () => {
    const responses = [
      { text: "LOOKUP: 7.4.2",                                          receipt: { hash: "0x1", url: "u" } },
      { text: "LOOKUP: 1.7",                                            receipt: { hash: "0x2", url: "u" } },
      { text: 'RULE: {"prevailingIsAccuser":true,"opinion":"o"}',        receipt: { hash: "0x3", url: "u" } },
    ];
    let i = 0;
    const llm = { complete: vi.fn(async () => responses[i++] as any) };
    const out = await runDeliberateLoop({
      llm: llm as any, systemBase: "s", transcript: "t",
      toc, lookupArticle: lookup, maxLookups: 2, maxArticles: 5,
    });
    expect(out.chain.length).toBe(3);
    expect(out.chain.map((s) => s.kind)).toEqual(["lookup", "lookup", "rule"]);
  });

  it("parses RULE blocks with trailing prose after the JSON", async () => {
    const responses = [
      { text: 'RULE: {"prevailingIsAccuser":false,"opinion":"o"} thanks!', receipt: { hash: "0xr", url: "u" } },
    ];
    let i = 0;
    const llm = { complete: vi.fn(async () => responses[i++] as any) };
    const out = await runDeliberateLoop({
      llm: llm as any, systemBase: "s", transcript: "t",
      toc, lookupArticle: lookup, maxLookups: 2, maxArticles: 5,
    });
    expect(out.ruling.prevailingIsAccuser).toBe(false);
  });
});
