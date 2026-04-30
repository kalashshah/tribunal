import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleSubmitEvidence,
  handleGetDocket,
  handleAnswerQuestion,
  handleMyCases,
  handleInbox,
  withGuidance,
  handleWaitForAction,
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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/docket") && String(url).includes("cases/1/docket")) {
        // Both the POST and the GET (withGuidance) hit /docket — differentiate by call order not feasible,
        // so return a shape that works for both: text() gives submit result, json() gives docket shape.
        return { ok: true, text: async () => `{"ok":true}`, json: async () => ({ items: [] }) } as any;
      }
      if (url.includes("/inbox")) return { ok: true, json: async () => ({ cases: [] }) } as any;
      return { ok: true, text: async () => `{"ok":true}`, json: async () => ({}) } as any;
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await handleSubmitEvidence(ctx, { caseId: "1", body: "I have the contract", url: "https://example.com" });
    const parsed = JSON.parse(out);
    expect(parsed.result).toEqual({ ok: true });
    const postCall = fetchMock.mock.calls[0] as any[];
    const [callUrl, init] = postCall;
    expect(callUrl).toBe("http://x/api/cases/1/docket");
    const sent = JSON.parse((init as any).body);
    expect(sent).toMatchObject({ address: "0xAddRess", signature: "0xsignature", body: "I have the contract", url: "https://example.com" });
    expect(sent.message).toMatch(/^tribunal-auth/);
  });
});

describe("handleAnswerQuestion", () => {
  it("POSTs signed answer to /answer", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/answer")) return { ok: true, text: async () => `{"ok":true}` } as any;
      if (url.includes("/docket")) return { ok: true, json: async () => ({ items: [] }) } as any;
      if (url.includes("/inbox")) return { ok: true, json: async () => ({ cases: [] }) } as any;
      return { ok: false, status: 404 } as any;
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await handleAnswerQuestion(ctx, { caseId: "1", questionId: "q_1_a", answer: "yes" });
    const parsed = JSON.parse(out);
    expect(parsed.result).toEqual({ ok: true });
    const answerCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/answer"))!;
    expect(String(answerCall[0])).toBe("http://x/api/cases/1/questions/q_1_a/answer");
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
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/docket")) return { ok: true, text: async () => `{"items":[]}`, json: async () => ({ items: [] }) } as any;
      if (url.includes("/inbox")) return { ok: true, json: async () => ({ cases: [] }) } as any;
      return { ok: false, status: 404 } as any;
    }));
    const out = await handleGetDocket(ctx, { caseId: "9" });
    const parsed = JSON.parse(out);
    expect(parsed.result).toEqual({ items: [] });
  });
  it("my_cases delegates to inbox with role=any", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => `{"cases":[]}` } as any));
    vi.stubGlobal("fetch", fetchMock);
    await handleMyCases(ctx);
    const [url] = fetchMock.mock.calls[0] as any[];
    expect(String(url)).toContain("role=any");
  });
});

describe("withGuidance", () => {
  it("returns evidence-gathering phase + URGENT nextAction when docket is empty", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/docket")) return { ok: true, json: async () => ({ items: [] }) } as any;
      if (url.includes("/inbox")) return { ok: true, json: async () => ({ cases: [{ caseId: "5", status: 1, pendingQuestions: 0 }] }) } as any;
      return { ok: false, status: 404 } as any;
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = JSON.parse(await withGuidance(ctx, "5", { caseId: "5" }));
    expect(out.phase).toBe("evidence-gathering");
    expect(out.docketItemCount).toBe(0);
    expect(out.nextActions.join(" ")).toMatch(/URGENT/);
    expect(out.nextActions.join(" ")).toMatch(/tribunal_submit_evidence/);
    expect(out.nextActions.join(" ")).toMatch(/tribunal_wait_for_action/);
  });

  it("flags pending questions when present", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/docket")) return { ok: true, json: async () => ({ items: [{ id: "evd_5_a" }] }) } as any;
      if (url.includes("/inbox")) return { ok: true, json: async () => ({ cases: [{ caseId: "5", status: 3, pendingQuestions: 2 }] }) } as any;
      return { ok: false, status: 404 } as any;
    }));
    const out = JSON.parse(await withGuidance(ctx, "5", {}));
    expect(out.phase).toBe("trial-running");
    expect(out.pendingQuestionCount).toBe(2);
    expect(out.nextActions.join(" ")).toMatch(/2 question/);
  });

  it("returns ruled phase when status >= 5", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/docket")) return { ok: true, json: async () => ({ items: [{ id: "evd_5_a" }] }) } as any;
      if (url.includes("/inbox")) return { ok: true, json: async () => ({ cases: [{ caseId: "5", status: 6, pendingQuestions: 0 }] }) } as any;
      return { ok: false, status: 404 } as any;
    }));
    const out = JSON.parse(await withGuidance(ctx, "5", {}));
    expect(out.phase).toBe("ruled");
    expect(out.nextActions.join(" ")).toMatch(/tribunal_get_verdict/);
  });
});

describe("handleWaitForAction", () => {
  it("calls /wait with address + timeout, wraps response in guidance", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/wait")) return { ok: true, text: async () => `{"event":"idle","caseId":"5","now":1,"status":3}` } as any;
      if (url.includes("/docket")) return { ok: true, json: async () => ({ items: [] }) } as any;
      if (url.includes("/inbox")) return { ok: true, json: async () => ({ cases: [{ caseId: "5", status: 3, pendingQuestions: 0 }] }) } as any;
      return { ok: false, status: 404 } as any;
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = JSON.parse(await handleWaitForAction(ctx, { caseId: "5", timeoutMs: 7000 }));
    expect(out.result).toMatchObject({ event: "idle" });
    const waitCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/wait"));
    expect(String(waitCall![0])).toContain("address=0xaddress");
    expect(String(waitCall![0])).toContain("timeoutMs=7000");
  });
});
