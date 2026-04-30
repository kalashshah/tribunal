import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleSubmitEvidence,
  handleGetDocket,
  handleAnswerQuestion,
  handleMyCases,
  handleInbox,
  type EvidenceCtx,
} from "./tools-evidence";

const ctx: EvidenceCtx = {
  backendUrl: "http://x",
  signMessage: vi.fn(async () => "0xsignature"),
  walletAddress: "0xAddRess",
};

beforeEach(() => { vi.restoreAllMocks(); (ctx.signMessage as any).mockClear(); });

describe("handleSubmitEvidence", () => {
  it("POSTs signed payload to /docket", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => `{"ok":true}` } as any));
    vi.stubGlobal("fetch", fetchMock);
    const out = await handleSubmitEvidence(ctx, { caseId: "1", body: "I have the contract", url: "https://example.com" });
    expect(JSON.parse(out)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("http://x/api/cases/1/docket");
    const sent = JSON.parse((init as any).body);
    expect(sent).toMatchObject({ address: "0xAddRess", signature: "0xsignature", body: "I have the contract", url: "https://example.com" });
    expect(sent.message).toMatch(/^tribunal-auth/);
  });
});

describe("handleAnswerQuestion", () => {
  it("POSTs signed answer to /answer", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => `{"ok":true}` } as any));
    vi.stubGlobal("fetch", fetchMock);
    const out = await handleAnswerQuestion(ctx, { caseId: "1", questionId: "q_1_a", answer: "yes" });
    expect(JSON.parse(out)).toEqual({ ok: true });
    const [url] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("http://x/api/cases/1/questions/q_1_a/answer");
  });
});

describe("handleInbox", () => {
  it("calls /api/cases/inbox?address=…", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => `{"cases":[]}` } as any));
    vi.stubGlobal("fetch", fetchMock);
    await handleInbox(ctx, { role: "defendant" });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://x/api/cases/inbox?address=${ctx.walletAddress.toLowerCase()}&role=defendant`,
    );
  });
});

describe("handleGetDocket / handleMyCases", () => {
  it("GET docket", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => `{"items":[]}` } as any)));
    const out = await handleGetDocket(ctx, { caseId: "9" });
    expect(JSON.parse(out)).toEqual({ items: [] });
  });
  it("my_cases delegates to inbox with role=any", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => `{"cases":[]}` } as any));
    vi.stubGlobal("fetch", fetchMock);
    await handleMyCases(ctx);
    const [url] = fetchMock.mock.calls[0] as any[];
    expect(String(url)).toContain("role=any");
  });
});
