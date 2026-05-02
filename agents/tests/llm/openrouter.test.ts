import { describe, expect, it, vi } from "vitest";
import { createOpenRouterLlm } from "../../src/llm/openrouter";

describe("createOpenRouterLlm", () => {
  it("POSTs to OpenRouter with system + messages and parses choices[0]", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ruling: A wins" } }],
            usage: { prompt_tokens: 10, completion_tokens: 4 },
          }),
          { status: 200 },
        ),
    );
    const llm = createOpenRouterLlm({
      apiKey: "or-test",
      model: "meta-llama/llama-3.3-70b-instruct:free",
      fetchImpl: fetchMock,
    });
    const out = await llm.complete({
      system: "You are judge-athena.",
      messages: [{ role: "user", content: "Decide." }],
    });
    expect(out).toEqual({ text: "ruling: A wins", inputTokens: 10, outputTokens: 4 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(body.messages[0]).toEqual({ role: "system", content: "You are judge-athena." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Decide." });
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer or-test");
  });

  it("includes optional analytics headers when provided", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
    );
    const llm = createOpenRouterLlm({
      apiKey: "k",
      model: "m",
      appUrl: "https://tribunal.local",
      appTitle: "Tribunal",
      fetchImpl: fetchMock,
    });
    await llm.complete({ system: "s", messages: [] });
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["HTTP-Referer"]).toBe("https://tribunal.local");
    expect(headers["X-Title"]).toBe("Tribunal");
  });

  it("throws on non-retryable non-2xx (e.g. 401)", async () => {
    const fetchMock = vi.fn(async () => new Response("bad key", { status: 401 }));
    const llm = createOpenRouterLlm({ apiKey: "k", model: "m", fetchImpl: fetchMock });
    await expect(llm.complete({ system: "s", messages: [] })).rejects.toThrow(/401/);
  });

  it("falls back to the next model on 429", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("rate limit", { status: 429 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "fallback ok" } }] }),
        { status: 200 },
      );
    });
    const llm = createOpenRouterLlm({
      apiKey: "k",
      model: "primary:free",
      fallbackModels: ["secondary:free"],
      fetchImpl: fetchMock,
    });
    const out = await llm.complete({ system: "s", messages: [] });
    expect(out.text).toBe("fallback ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
    expect(secondBody.model).toBe("secondary:free");
  });

  it("throws when every model in the chain fails with a retryable status", async () => {
    const fetchMock = vi.fn(async () => new Response("rl", { status: 429 }));
    const llm = createOpenRouterLlm({
      apiKey: "k", model: "a:free", fallbackModels: ["b:free"], fetchImpl: fetchMock,
    });
    await expect(llm.complete({ system: "s", messages: [] })).rejects.toThrow(/all models exhausted/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to message.reasoning when content is null (thinking models)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: null, reasoning: "5 words: hi to you" } }],
          }),
          { status: 200 },
        ),
    );
    const llm = createOpenRouterLlm({ apiKey: "k", model: "m", fetchImpl: fetchMock });
    const out = await llm.complete({ system: "s", messages: [] });
    expect(out.text).toBe("5 words: hi to you");
  });
});
