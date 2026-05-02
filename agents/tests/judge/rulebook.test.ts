import { describe, it, expect, vi } from "vitest";
import { loadRulebook } from "../../src/judge/rulebook.js";

describe("loadRulebook", () => {
  const baseBytes = new TextEncoder().encode(JSON.stringify({
    version: "v1", name: "RB",
    articles: [
      { id: "1.7",   title: "Good faith",       body: "act in good faith" },
      { id: "7.4.2", title: "Full compensation", body: "compensate harm" },
    ],
  }));

  it("downloads base + amendments and merges into a single rulebook", async () => {
    const governor = {
      baseRoot: vi.fn(async () => "0xbase"),
      amendmentCount: vi.fn(async () => 1n),
      amendmentAt: vi.fn(async () => ({ cidRoot: "0xamend", cidUrl: "u", title: "AML", appliedAt: 0n })),
    };
    const amendBytes = new TextEncoder().encode(JSON.stringify({
      articles: [{ id: "9.1", title: "AML compliance", body: "follow AML" }],
    }));
    const storage = {
      download: vi.fn(async (root: string) => root === "0xbase" ? baseBytes : amendBytes),
    };
    const rb = await loadRulebook({ governor: governor as any, storage: storage as any });
    expect(rb.toc.map((e) => e.id)).toEqual(["1.7", "7.4.2", "9.1"]);
    expect(rb.byId.get("9.1")?.body).toBe("follow AML");
  });

  it("dedupes TOC and overrides body when amendment shares an id with base", async () => {
    const governor = {
      baseRoot: vi.fn(async () => "0xbase"),
      amendmentCount: vi.fn(async () => 1n),
      amendmentAt: vi.fn(async () => ({ cidRoot: "0xamend", cidUrl: "u", title: "Good faith v2", appliedAt: 0n })),
    };
    const amendBytes = new TextEncoder().encode(JSON.stringify({
      articles: [{ id: "1.7", title: "Good faith (revised)", body: "broader good faith duty" }],
    }));
    const storage = {
      download: vi.fn(async (root: string) => root === "0xbase" ? baseBytes : amendBytes),
    };
    const rb = await loadRulebook({ governor: governor as any, storage: storage as any });
    expect(rb.toc.map((e) => e.id)).toEqual(["1.7", "7.4.2"]);
    expect(rb.toc.find((e) => e.id === "1.7")?.title).toBe("Good faith (revised)");
    expect(rb.byId.get("1.7")?.body).toBe("broader good faith duty");
    expect(rb.byId.get("7.4.2")?.body).toBe("compensate harm");
  });
});
