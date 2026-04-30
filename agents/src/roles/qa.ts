/// Question/answer bridge.
///
/// Two modes:
///   - "human" (default): post the question to the web backend and long-poll
///     for an answer submitted by the user via MCP. On timeout, return a
///     literal "(party did not respond)" string — never fabricate.
///   - "auto": call partyAgent.answer() directly. Used for offline demos and
///     unit tests; the LLM persona is constrained to refuse fabrication.

import type { AxlClient } from "../transport/axl.js";
import type { PartyAgent } from "./party.js";
import { postQuestion, pollAnswer } from "./qa-bridge.js";

export type Party = "accuser" | "defendant";
export type PartyMode = "human" | "auto";

export interface AskPartyDeps {
  caseId: string;
  axl: AxlClient;
  clerkPeerId: string;
  asker: string;
  askerSide: Party | "judge";
  partyEns: { accuser: string; defendant: string };
  /// 0x addresses of the two parties; required in human mode.
  partyAddress: { accuser: string; defendant: string };
  backendUrl: string;
  mode: PartyMode;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const NO_RESPONSE = (target: Party, ens: string) =>
  `(${target} ${ens} did not respond within the question window)`;

export async function askParty(
  deps: AskPartyDeps,
  target: Party,
  question: string,
  transcriptSoFar: string,
  partyAgent: PartyAgent | undefined,
): Promise<string> {
  const questionId =
    `q_${deps.caseId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const targetEns = target === "accuser" ? deps.partyEns.accuser : deps.partyEns.defendant;
  const targetAddr = target === "accuser" ? deps.partyAddress.accuser : deps.partyAddress.defendant;

  // Anchor the question in the transcript regardless of mode.
  await deps.axl.send(deps.clerkPeerId, {
    kind: "question",
    from: deps.asker,
    body: question,
    meta: { questionId, target, askerSide: deps.askerSide, caseId: deps.caseId },
  });

  let answer: string;
  if (deps.mode === "human") {
    await postQuestion(deps.backendUrl, {
      caseId: deps.caseId,
      questionId,
      askedBy: deps.asker,
      target,
      targetAddress: targetAddr,
      body: question,
    });
    const polled = await pollAnswer(deps.backendUrl, deps.caseId, questionId, {
      intervalMs: deps.pollIntervalMs,
      timeoutMs: deps.timeoutMs,
    });
    answer = polled ?? NO_RESPONSE(target, targetEns);
  } else {
    if (!partyAgent) throw new Error(`askParty: mode=auto requires a partyAgent for ${target}`);
    answer = await partyAgent.answer(question, transcriptSoFar);
  }

  await deps.axl.send(deps.clerkPeerId, {
    kind: "answer",
    from: targetEns,
    body: answer,
    meta: { questionId, answeringSide: target, caseId: deps.caseId },
  });
  return answer;
}

/// Strip markdown fences and find the first balanced JSON object in arbitrary
/// LLM output. Returns null if no parseable object is found.
export function tryParseJsonObject<T = unknown>(text: string): T | null {
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(stripped.slice(start, i + 1)) as T; }
        catch { return null; }
      }
    }
  }
  return null;
}
