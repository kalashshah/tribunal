import { describe, expect, it, vi } from "vitest";
import { createAxlClient, subscribe } from "../../src/transport/axl";

describe("createAxlClient.send", () => {
  it("POSTs to /send with X-Destination-Peer-Id header and JSON body", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const client = createAxlClient({ baseUrl: "http://localhost:9002", fetchImpl: fetchMock });
    await client.send("PEER_B_HEX", { kind: "ping", n: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:9002/send");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Destination-Peer-Id"]).toBe("PEER_B_HEX");
    expect(JSON.parse(init?.body as string)).toEqual({ kind: "ping", n: 1 });
  });

  it("throws when /send returns non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    const client = createAxlClient({ baseUrl: "http://localhost:9002", fetchImpl: fetchMock });
    await expect(client.send("PEER_B_HEX", {})).rejects.toThrow(/500/);
  });
});

describe("createAxlClient.recv", () => {
  it("returns { from, payload } when a message is available", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ kind: "argument", body: "hi" }), {
          status: 200,
          headers: { "X-From-Peer-Id": "PEER_A_HEX" },
        }),
    );
    const client = createAxlClient({ baseUrl: "http://localhost:9002", fetchImpl: fetchMock });
    const env = await client.recv();
    expect(env).toEqual({ from: "PEER_A_HEX", payload: { kind: "argument", body: "hi" } });
  });

  it("returns null on 204 No Content", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createAxlClient({ baseUrl: "http://localhost:9002", fetchImpl: fetchMock });
    expect(await client.recv()).toBeNull();
  });

  it("falls back to raw text when body is not JSON", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("plain hello", {
          status: 200,
          headers: { "X-From-Peer-Id": "PEER_A_HEX" },
        }),
    );
    const client = createAxlClient({ baseUrl: "http://localhost:9002", fetchImpl: fetchMock });
    const env = await client.recv();
    expect(env?.payload).toBe("plain hello");
    expect(env?.from).toBe("PEER_A_HEX");
  });
});

describe("createAxlClient.peerId", () => {
  it("reads our_public_key from /topology", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ our_public_key: "abcd1234", our_ipv6: "200::1" }), {
          status: 200,
        }),
    );
    const client = createAxlClient({ baseUrl: "http://localhost:9002", fetchImpl: fetchMock });
    expect(await client.peerId()).toBe("abcd1234");
  });
});

describe("subscribe", () => {
  it("invokes onMessage for each received envelope and stops when unsubscribed", async () => {
    let calls = 0;
    const client = {
      send: vi.fn(),
      peerId: vi.fn(),
      recv: vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { from: "P", payload: { n: 1 } };
        if (calls === 2) return { from: "P", payload: { n: 2 } };
        return null;
      }),
    };
    const seen: any[] = [];
    const unsub = subscribe(client as any, (env) => { seen.push(env); }, { idleBackoffMs: 5 });
    await new Promise((r) => setTimeout(r, 80));
    unsub();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.length).toBe(2);
    expect(seen[0]).toEqual({ from: "P", payload: { n: 1 } });
    expect(seen[1]).toEqual({ from: "P", payload: { n: 2 } });
  });

  it("backs off and continues when recv throws", async () => {
    let calls = 0;
    const client = {
      send: vi.fn(),
      peerId: vi.fn(),
      recv: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("transport down");
        if (calls === 2) return { from: "P", payload: { ok: true } };
        return null;
      }),
    };
    const seen: any[] = [];
    const unsub = subscribe(client as any, (env) => { seen.push(env); }, { idleBackoffMs: 5, errorBackoffMs: 5 });
    await new Promise((r) => setTimeout(r, 60));
    unsub();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([{ from: "P", payload: { ok: true } }]);
  });
});
