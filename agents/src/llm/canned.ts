// Canned LLM. Returns deterministic responses keyed by role + prompt
// fragments. Used by the demo runner and integration tests so the full
// trial flow can run without network or API keys.

import type { Llm, CompleteArgs } from "./client.js";

export interface CannedScript {
  /// Matchers run in order; first match wins.
  match(args: CompleteArgs): string | null;
}

export function createCannedLlm(scripts: CannedScript[]): Llm {
  return {
    async complete(args) {
      for (const s of scripts) {
        const text = s.match(args);
        if (text != null) return { text, inputTokens: 0, outputTokens: 0 };
      }
      throw new Error(`canned LLM: no script matched system="${args.system.slice(0, 40)}…"`);
    },
  };
}

/// Default script for the demo: produces realistic-sounding lawyer
/// statements and a judge ruling that finds for the accuser. Matches by
/// detecting role keywords in the system prompt.
export function defaultDemoScripts(): CannedScript[] {
  return [
    {
      match: (a) => {
        if (!a.system.includes("lawyer for the accuser")) return null;
        const userMsg = a.messages[0]?.content ?? "";
        if (userMsg.startsWith("Provide your opening")) {
          return "CLAIM: My client Alice delivered the research report on 2026-04-20 at 14:00 UTC.\nEVIDENCE: timestamped delivery receipt, IPFS hash QmReport, signed handoff log.\nCONCLUSION: Bob's claim of non-receipt is contradicted by his own wallet's read-receipt event.";
        }
        if (userMsg.startsWith("Opposing argument")) {
          return "CLAIM: Bob's read-receipt was on-chain at 14:01:08 UTC.\nEVIDENCE: tx hash 0xb0b1, block 8923014.\nCONCLUSION: Either Bob received the report or his agent silently dropped it after acknowledging — neither voids the escrow.";
        }
        return "CLOSING: The transcript shows a delivery, an acknowledgement, and a refusal to release funds. The defendant's case is internally inconsistent. Find for the accuser.";
      },
    },
    {
      match: (a) => {
        if (!a.system.includes("lawyer for the defendant")) return null;
        const userMsg = a.messages[0]?.content ?? "";
        if (userMsg.startsWith("Provide your opening")) {
          return "CLAIM: My client Bob never received the substantive report.\nEVIDENCE: only an empty-payload notification reached his inbox at 14:00:42 UTC.\nCONCLUSION: A notification is not a delivery; the escrow conditions were not met.";
        }
        if (userMsg.startsWith("Opposing argument")) {
          return "CLAIM: A read-receipt acknowledges arrival, not contents.\nEVIDENCE: standard agent libraries auto-emit receipts on any inbound packet.\nCONCLUSION: The escrow contract requires successful delivery of the report, not of an envelope.";
        }
        return "CLOSING: Without proof of substantive delivery, the escrow should remain locked. Find for the defendant, or at minimum order remediation before payout.";
      },
    },
    {
      match: (a) => {
        if (!a.system.includes("judge in the Tribunal")) return null;
        return JSON.stringify({
          prevailingIsAccuser: true,
          opinion:
            "Both parties agree a notification reached the defendant; they dispute whether it carried the report. The accuser produced an IPFS hash and a signed handoff log. The defendant produced no counter-hash and no inspection of the inbound payload. On the record before me, the accuser has met the preponderance standard. Verdict for the accuser.",
        });
      },
    },
  ];
}
