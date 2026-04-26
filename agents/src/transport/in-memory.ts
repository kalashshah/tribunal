// In-memory AXL bus. Implements the same shape as createAxlClient() but
// routes messages locally with no Go binary, no localhost HTTP. Used for
// the demo runner and integration tests.

import type { AxlClient, IncomingEnvelope } from "./axl.js";

interface QueuedMessage {
  from: string;
  payload: unknown;
}

export interface InMemoryBus {
  newClient(peerId: string): AxlClient;
  /// For test assertions — total messages routed across all clients.
  totalSent(): number;
}

export function createInMemoryBus(): InMemoryBus {
  const inboxes = new Map<string, QueuedMessage[]>();
  let totalSent = 0;

  function ensure(peerId: string) {
    if (!inboxes.has(peerId)) inboxes.set(peerId, []);
    return inboxes.get(peerId)!;
  }

  return {
    totalSent: () => totalSent,
    newClient(peerId) {
      ensure(peerId);
      return {
        async send(toPeerId, payload) {
          ensure(toPeerId).push({ from: peerId, payload });
          totalSent += 1;
        },
        async recv(): Promise<IncomingEnvelope | null> {
          const inbox = ensure(peerId);
          if (inbox.length === 0) return null;
          return inbox.shift()!;
        },
        async peerId() {
          return peerId;
        },
      };
    },
  };
}
