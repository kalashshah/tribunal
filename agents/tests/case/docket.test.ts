import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchDocket, formatDocket } from "../../src/case/docket";

describe("docket", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns [] when route returns empty items", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ caseId: "1", items: [] }),
    } as any)));
    const got = await fetchDocket("http://x", "1");
    expect(got).toEqual([]);
  });

  it("returns parsed items", async () => {
    const items = [{ id: "evd_1_a", caseId: "1", submittedBy: "0x1", submittedAt: "t", kind: "evidence", body: "X" }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ caseId: "1", items }) } as any)));
    const got = await fetchDocket("http://x", "1");
    expect(got).toEqual(items);
  });

  it("returns [] on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, text: async () => "down" } as any)));
    const got = await fetchDocket("http://x", "1");
    expect(got).toEqual([]);
  });

  it("formatDocket renders empty notice when no items", () => {
    expect(formatDocket([])).toMatch(/no evidence/i);
  });

  it("formatDocket renders id + body + url", () => {
    const text = formatDocket([{
      id: "evd_1_a", caseId: "1", submittedBy: "0xabc",
      submittedAt: "2026-04-30T00:00:00.000Z",
      kind: "evidence", body: "they signed it", url: "https://etherscan.io/tx/0xdead",
    }] as any);
    expect(text).toContain("evd_1_a");
    expect(text).toContain("they signed it");
    expect(text).toContain("https://etherscan.io/tx/0xdead");
    expect(text).toContain("0xabc");
  });
});
