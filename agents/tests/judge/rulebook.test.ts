import { describe, it, expect, vi } from "vitest";
import { loadRulebook } from "../../src/judge/rulebook.js";

describe("loadRulebook (RuleBook registry + ENS)", () => {
  function ruleBook(entries: { articleId: string; ensNode: string; chapter: string }[]) {
    return {
      articleCount: vi.fn(async () => BigInt(entries.length)),
      articleAt: vi.fn(async (i: number | bigint) => {
        const e = entries[Number(i)]!;
        return { ...e, addedAt: 0n };
      }),
    };
  }

  function ensFixture(records: Record<string, Record<string, string>>) {
    return {
      resolveText: vi.fn(async (node: string, key: string) => {
        return records[node]?.[key] ?? null;
      }),
    };
  }

  it("reads the registry, resolves each ENS namehash, and builds toc + byId", async () => {
    const rb = ruleBook([
      { articleId: "1.7", ensNode: "0xnode_1_7", chapter: "1" },
      { articleId: "7.4.2", ensNode: "0xnode_7_4_2", chapter: "7.4" },
    ]);
    const ens = ensFixture({
      "0xnode_1_7":   { description: "good faith body", "tribunal.title": "Good faith" },
      "0xnode_7_4_2": { description: "compensate body", "tribunal.title": "Full compensation" },
    });
    const rulebook = await loadRulebook({ ruleBook: rb as any, ens: ens as any });
    expect(rulebook.toc.map((e) => e.id)).toEqual(["1.7", "7.4.2"]);
    expect(rulebook.byId.get("7.4.2")?.body).toBe("compensate body");
    expect(rulebook.byId.get("7.4.2")?.title).toBe("Full compensation");
    expect(rulebook.ensByArticleId.get("1.7")).toBe("0xnode_1_7");
  });

  it("falls back to articleId when title text record missing", async () => {
    const rb = ruleBook([{ articleId: "1.7", ensNode: "0xn", chapter: "1" }]);
    const ens = ensFixture({ "0xn": { description: "body" } });
    const rulebook = await loadRulebook({ ruleBook: rb as any, ens: ens as any });
    expect(rulebook.byId.get("1.7")?.title).toBe("1.7");
  });

  it("skips articles whose description text record is missing", async () => {
    const skipped: string[] = [];
    const rb = ruleBook([
      { articleId: "1.7", ensNode: "0xn1", chapter: "1" },
      { articleId: "7.4.2", ensNode: "0xn2", chapter: "7.4" },
    ]);
    const ens = ensFixture({
      "0xn1": {},
      "0xn2": { description: "compensate" },
    });
    const rulebook = await loadRulebook({
      ruleBook: rb as any, ens: ens as any,
      onSkip: (id) => skipped.push(id),
    });
    expect(skipped).toEqual(["1.7"]);
    expect(rulebook.toc.map((e) => e.id)).toEqual(["7.4.2"]);
  });

  it("skips articles when ENS resolution throws", async () => {
    const skipped: { id: string; why: string }[] = [];
    const rb = ruleBook([
      { articleId: "1.7", ensNode: "0xn1", chapter: "1" },
      { articleId: "7.4.2", ensNode: "0xn2", chapter: "7.4" },
    ]);
    const ens = {
      resolveText: vi.fn(async (node: string) => {
        if (node === "0xn1") throw new Error("RPC down");
        return "compensate";
      }),
    };
    const rulebook = await loadRulebook({
      ruleBook: rb as any, ens: ens as any,
      onSkip: (id, why) => skipped.push({ id, why }),
    });
    expect(skipped[0]?.id).toBe("1.7");
    expect(skipped[0]?.why).toMatch(/RPC down/);
    expect(rulebook.toc.map((e) => e.id)).toEqual(["7.4.2"]);
  });
});
