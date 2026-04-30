/// Question/answer bridge using autonomous party agents.
///
/// Architecture:
///   1. Lawyer calls askParty(deps, target, question, transcriptSoFar, partyAgent).
///   2. A `question` event is sent via AXL → clerk persists it in the transcript
///      so the courtroom UI shows the question being asked.
///   3. partyAgent.answer() is called directly — no human in the loop.
///   4. The answer is sent as an `answer` event via AXL → clerk persists it
///      and it appears in the courtroom transcript.
///   5. The answer string is returned to the caller.

import type { AxlClient } from "../transport/axl.js";
import type { PartyAgent } from "./party.js";

export type Party = "accuser" | "defendant";

export interface AskPartyDeps {
  caseId: string;
  axl: AxlClient;
  clerkPeerId: string;
  asker: string;            // ENS of the agent asking
  askerSide: Party | "judge";
  partyEns: { accuser: string; defendant: string };
}

export async function askParty(
  deps: AskPartyDeps,
  target: Party,
  question: string,
  transcriptSoFar: string,
  partyAgent: PartyAgent,
): Promise<string> {
  const questionId =
    `q_${deps.caseId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Anchor question event in the courtroom transcript.
  await deps.axl.send(deps.clerkPeerId, {
    kind: "question",
    from: deps.asker,
    body: question,
    meta: {
      questionId,
      target,
      askerSide: deps.askerSide,
      caseId: deps.caseId,
    },
  });

  // Party agent answers autonomously.
  const answer = await partyAgent.answer(question, transcriptSoFar);

  // Anchor answer event in the courtroom transcript.
  await deps.axl.send(deps.clerkPeerId, {
    kind: "answer",
    from: target === "accuser" ? deps.partyEns.accuser : deps.partyEns.defendant,
    body: answer,
    meta: {
      questionId,
      answeringSide: target,
      caseId: deps.caseId,
    },
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
