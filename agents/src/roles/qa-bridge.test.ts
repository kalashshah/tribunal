import { describe, it, expect, beforeEach, vi } from "vitest";
import { postQuestion, pollAnswer } from "./qa-bridge";

describe("qa-bridge", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("postQuestion POSTs JSON to /api/cases/:id/questions", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) } as any));
    vi.stubGlobal("fetch", fetchMock);
    await postQuestion("http://x", {
      caseId: "5", questionId: "q_5_a", askedBy: "alice.tribunal.eth",
      target: "defendant", targetAddress: "0xabc", body: "Did you sign?",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://x/api/cases/5/questions");
    expect((init as any).method).toBe("POST");
    expect(JSON.parse((init as any).body)).toMatchObject({
      questionId: "q_5_a", target: "defendant",
    });
  });

  it("pollAnswer returns the answer once status flips to answered", async () => {
    const responses = [
      { question: { id: "q_5_a", status: "pending" } },
      { question: { id: "q_5_a", status: "pending" } },
      { question: { id: "q_5_a", status: "answered", answer: "yes I did" } },
    ];
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => responses.shift() } as any));
    vi.stubGlobal("fetch", fetchMock);
    const got = await pollAnswer("http://x", "5", "q_5_a", { intervalMs: 1, timeoutMs: 1000 });
    expect(got).toBe("yes I did");
  });

  it("pollAnswer returns null on timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ question: { id: "q_5_a", status: "pending" } }),
    } as any)));
    const got = await pollAnswer("http://x", "5", "q_5_a", { intervalMs: 1, timeoutMs: 5 });
    expect(got).toBeNull();
  });
});
