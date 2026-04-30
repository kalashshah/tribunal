import { Transcript, RawEvent, CaseEvent } from "../case/transcript.js";
import type { TribunalClient } from "../chain/tribunal-client.js";
import type { ZgStorage } from "../storage/og-storage.js";

export interface PersistedInfo {
  rootHash?: string;
  storageTxHash?: string;   // 0G Flow.submit tx (EVM tx on chainscan-galileo)
  storageTxSeq?: number;    // submissionIndex on storagescan-galileo
  anchorTxHash?: string;    // TribunalCore.recordEvent tx
  error?: string;
}

export interface ClerkDeps {
  caseId: bigint;
  storage: ZgStorage;
  tribunal: TribunalClient;
  /// Called for every persisted event so consumers (UI WebSocket, smoke
  /// tests) can observe the trial as it streams.
  forward: (event: CaseEvent) => Promise<void> | void;
  /// Called once 0G upload + on-chain anchor finish for an event. Carries
  /// the storage root hash and recordEvent tx hash for explorer linking.
  /// Fires later than `forward` (and in some failure modes, never).
  onPersisted?: (seq: number, info: PersistedInfo) => void;
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
      // Forward to UI consumers first. 0G upload + on-chain anchor can
      // take tens of seconds on testnet; doing them inline blocks the live
      // transcript from ever reaching the browser before the verdict lands.
      await deps.forward(ev);
      const blob = new TextEncoder().encode(JSON.stringify(ev));
      void (async () => {
        try {
          const up = await deps.storage.upload(blob);
          const anchor = await deps.tribunal.anchorEvent(deps.caseId, ev.contentHash);
          deps.onPersisted?.(ev.seq, {
            rootHash: up.rootHash,
            storageTxHash: up.txHash,
            storageTxSeq: up.txSeq,
            anchorTxHash: anchor.txHash,
          });
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          console.error(`[clerk] persist/anchor failed for seq ${ev.seq}:`, msg);
          deps.onPersisted?.(ev.seq, { error: msg.slice(0, 200) });
        }
      })();
      return ev;
    },
    transcript() { return transcript.list(); },
    render() { return transcript.render(); },
  };
}
