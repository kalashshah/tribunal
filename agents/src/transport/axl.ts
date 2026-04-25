// AXL transport wrapper.
//
// AXL is Gensyn's peer-to-peer agent communication layer (https://docs.gensyn.ai/tech/agent-exchange-layer).
// Each peer runs a Go node binary; this module talks to that node over its localhost HTTP API.
//
// Real API shape (verified against docs):
//   POST /send  — header X-Destination-Peer-Id: <hex64>, body = raw message bytes
//   GET  /recv  — returns body bytes + header X-From-Peer-Id: <hex64>
//   GET  /topology — returns { our_public_key, our_ipv6, ... }

export interface AxlClient {
  send(toPeerId: string, payload: unknown): Promise<void>;
  recv(): Promise<IncomingEnvelope | null>;
  peerId(): Promise<string>;
}

export interface IncomingEnvelope {
  from: string;       // sender's hex64 public key
  payload: unknown;   // JSON-parsed body (we always JSON-encode on send)
}

export interface CreateAxlClientOptions {
  baseUrl: string;            // e.g. "http://127.0.0.1:9002"
  fetchImpl?: typeof fetch;
  recvTimeoutMs?: number;     // long-poll wait, default 15s
}

export function createAxlClient(opts: CreateAxlClientOptions): AxlClient {
  const f = opts.fetchImpl ?? fetch;
  const timeout = opts.recvTimeoutMs ?? 15_000;
  return {
    async send(toPeerId, payload) {
      const res = await f(`${opts.baseUrl}/send`, {
        method: "POST",
        headers: {
          "X-Destination-Peer-Id": toPeerId,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`AXL /send failed: HTTP ${res.status} ${await res.text()}`);
      }
    },
    async recv() {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout + 1_000);
      try {
        const res = await f(`${opts.baseUrl}/recv`, { signal: ctrl.signal });
        if (res.status === 204) return null;
        if (!res.ok) {
          throw new Error(`AXL /recv failed: HTTP ${res.status} ${await res.text()}`);
        }
        const from = res.headers.get("X-From-Peer-Id") ?? "";
        const text = await res.text();
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { payload = text; }
        return { from, payload };
      } finally {
        clearTimeout(t);
      }
    },
    async peerId() {
      const res = await f(`${opts.baseUrl}/topology`);
      if (!res.ok) throw new Error(`AXL /topology failed: HTTP ${res.status}`);
      const body = (await res.json()) as { our_public_key: string };
      return body.our_public_key;
    },
  };
}

export interface SubscribeOptions {
  idleBackoffMs?: number;   // wait when /recv returns null, default 50
  errorBackoffMs?: number;  // wait when /recv throws, default 500
}

export function subscribe(
  client: AxlClient,
  onMessage: (env: IncomingEnvelope) => void | Promise<void>,
  opts: SubscribeOptions = {},
): () => void {
  const idleBackoff = opts.idleBackoffMs ?? 50;
  const errorBackoff = opts.errorBackoffMs ?? 500;
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        const env = await client.recv();
        if (env) await onMessage(env);
        else await new Promise((r) => setTimeout(r, idleBackoff));
      } catch (e) {
        if (!stopped) await new Promise((r) => setTimeout(r, errorBackoff));
      }
    }
  })();
  return () => { stopped = true; };
}
