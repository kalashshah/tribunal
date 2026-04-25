import { keccak256, toUtf8Bytes } from "ethers";

export type EventKind =
  | "filing"
  | "acceptance"
  | "argument"
  | "evidence"
  | "deliberation"
  | "ruling";

export interface RawEvent {
  kind: EventKind;
  from: string;                       // sender's ENS name (or peer id fallback)
  body: string;
  meta?: Record<string, unknown>;
}

export interface CaseEvent extends RawEvent {
  caseId: string;
  seq: number;
  contentHash: `0x${string}`;
  timestamp: number;
}

/// Append-only log of events for a single case. Each append computes a stable
/// keccak256 over the canonical JSON payload (which includes the seq number),
/// so identical messages at different positions hash differently.
export class Transcript {
  private events: CaseEvent[] = [];

  constructor(public readonly caseId: string) {}

  append(e: RawEvent): CaseEvent {
    const seq = this.events.length + 1;
    const timestamp = Date.now();
    const payload = JSON.stringify({ caseId: this.caseId, seq, ...e });
    const contentHash = keccak256(toUtf8Bytes(payload)) as `0x${string}`;
    const stored: CaseEvent = { ...e, caseId: this.caseId, seq, contentHash, timestamp };
    this.events.push(stored);
    return stored;
  }

  list(): readonly CaseEvent[] { return this.events; }
  size(): number { return this.events.length; }

  /// Plain-text rendering suitable for feeding to a judge LLM.
  render(): string {
    return this.events
      .map((e) => `[${e.kind}] ${e.from}: ${e.body}`)
      .join("\n");
  }
}
