import { Transcript, RawEvent, CaseEvent } from "../case/transcript.js";
import type { TribunalClient } from "../chain/tribunal-client.js";
import type { ZgStorage } from "../storage/og-storage.js";

export interface ClerkDeps {
  caseId: bigint;
  storage: ZgStorage;
  tribunal: TribunalClient;
  /// Called for every persisted event so consumers (UI WebSocket, smoke
  /// tests) can observe the trial as it streams.
  forward: (event: CaseEvent) => Promise<void> | void;
  transcript?: Transcript;
}

export interface Clerk {
  handleIncoming(env: { from: string; payload: unknown }): Promise<CaseEvent>;
  transcript(): readonly CaseEvent[];
  render(): string;
}

/// The clerk persists every incoming AXL message as a Transcript event,
/// uploads the canonical JSON to 0G Storage, anchors its content hash on
/// TribunalCore via recordEvent, and forwards the event to subscribers.
export function createClerk(deps: ClerkDeps): Clerk {
  const transcript = deps.transcript ?? new Transcript(String(deps.caseId));

  return {
    async handleIncoming(env) {
      const raw = env.payload as RawEvent;
      const ev = transcript.append(raw);
      const blob = new TextEncoder().encode(JSON.stringify(ev));
      await deps.storage.upload(blob);
      await deps.tribunal.anchorEvent(deps.caseId, ev.contentHash);
      await deps.forward(ev);
      return ev;
    },
    transcript() { return transcript.list(); },
    render() { return transcript.render(); },
  };
}
