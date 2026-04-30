import { describe, expect, it, vi } from "vitest";
import { createOpenAiLlm } from "./openai";

describe("createOpenAiLlm", () => {
  it("POSTs to api.openai.com with system + messages and parses choices[0]", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "verdict for accuser" } }],
            usage: { prompt_tokens: 11, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    const llm = createOpenAiLlm({ apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl: fetchMock });
    const out = await llm.complete({
      system: "You are judge-athena.",
      messages: [{ role: "user", content: "Decide." }],
    });
    expect(out).toEqual({ text: "verdict for accuser", inputTokens: 11, outputTokens: 3 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0]).toEqual({ role: "system", content: "You are judge-athena." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Decide." });
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
  });

  it("forwards response_format: json_object when responseFormat is 'json'", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }),
    );
    const llm = createOpenAiLlm({ apiKey: "k", model: "gpt-4o-mini", fetchImpl: fetchMock });
    await llm.complete({ system: "s", messages: [], responseFormat: "json" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("includes OpenAI-Organization header when provided", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
    );
    const llm = createOpenAiLlm({ apiKey: "k", model: "m", organization: "org-foo", fetchImpl: fetchMock });
    await llm.complete({ system: "s", messages: [] });
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["OpenAI-Organization"]).toBe("org-foo");
  });

  it("throws with status + body on non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("bad key", { status: 401 }));
    const llm = createOpenAiLlm({ apiKey: "k", model: "m", fetchImpl: fetchMock });
    await expect(llm.complete({ system: "s", messages: [] })).rejects.toThrow(/401.*bad key/);
  });
});
