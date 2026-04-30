import { describe, it, expect, beforeEach, vi } from "vitest";
import { askParty, type AskPartyDeps } from "./qa";

const sentEnvelopes: any[] = [];
const fakeAxl = {
  send: vi.fn(async (_peer: string, payload: any) => { sentEnvelopes.push(payload); }),
} as any;

const deps: AskPartyDeps = {
  caseId: "7",
  axl: fakeAxl,
  clerkPeerId: "clerk-peer",
  asker: "alice.tribunal.eth",
  askerSide: "accuser",
  partyEns: { accuser: "alice.tribunal.eth", defendant: "bob.tribunal.eth" },
  partyAddress: { accuser: "0xa1", defendant: "0xb2" },
  backendUrl: "http://x",
  mode: "human",
  timeoutMs: 1000,
  pollIntervalMs: 1,
};

beforeEach(() => {
  sentEnvelopes.length = 0;
  fakeAxl.send.mockClear();
});

describe("askParty (human mode)", () => {
  it("posts a question, polls, returns the human answer", async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (typeof url === "string" && url.endsWith("/questions") && init?.method === "POST") {
        return { ok: true, json: async () => ({ ok: true }) } as any;
      }
      return { ok: true, json: async () => ({ question: { status: "answered", answer: "real answer" } }) } as any;
    });
    vi.stubGlobal("fetch", fetchMock);
    const got = await askParty(deps, "defendant", "Did you sign it?", "transcript", undefined as any);
    expect(got).toBe("real answer");
    expect(sentEnvelopes.map((e) => e.kind)).toEqual(["question", "answer"]);
  });

  it("returns explicit no-response sentinel on timeout (does NOT fabricate)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ ok: true }) } as any;
      return { ok: true, json: async () => ({ question: { status: "pending" } }) } as any;
    }));
    const got = await askParty(deps, "defendant", "Did you sign it?", "transcript", undefined as any);
    expect(got).toMatch(/did not respond/i);
    const answerEnv = sentEnvelopes.find((e) => e.kind === "answer");
    expect(answerEnv.body).toMatch(/did not respond/i);
  });
});

describe("askParty (auto mode)", () => {
  it("falls through to the partyAgent LLM when mode=auto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) } as any)));
    const partyAgent = { side: "defendant", ensName: "bob", answer: vi.fn(async () => "auto reply") } as any;
    const got = await askParty({ ...deps, mode: "auto" }, "defendant", "Did you sign?", "t", partyAgent);
    expect(got).toBe("auto reply");
  });
});
