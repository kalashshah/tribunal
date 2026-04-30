import type { Llm } from "../llm/client.js";

export type PartySide = "accuser" | "defendant";

export interface PartyDeps {
  side: PartySide;
  ensName: string;        // e.g. "bright-compass.tribunal.eth"
  accusation: string;     // original accusation text
  llm: Llm;
  model: string;
  /// Optional case docket text to ground the LLM. Pass formatDocket(...) output.
  docketText?: string;
}

export interface PartyAgent {
  side: PartySide;
  ensName: string;
  /// Generates an in-character answer to a question from the lawyer.
  /// `transcriptSoFar` = concatenated trial transcript (clerk.render()) so the
  /// party agent stays consistent with what's been said in court.
  answer(question: string, transcriptSoFar: string): Promise<string>;
}

export function createPartyAgent(deps: PartyDeps): PartyAgent {
  const sideLabel =
    deps.side === "accuser"
      ? "accuser (the party who filed this complaint)"
      : "defendant (the party being accused)";
  const persona =
    `You are the ${sideLabel} in a Tribunal proceeding. Your handle is ${deps.ensName}.\n` +
    `The accusation under dispute is:\n  ${deps.accusation}\n\n` +
    `You are speaking to your own counsel during a confidential interview.\n\n` +
    `STRICT RULES — failing these is worse than refusing to answer:\n` +
    `  1. NEVER invent facts. No invented dates, dollar amounts, transaction hashes, contract terms, names, places, or quotes.\n` +
    `  2. If a question asks for evidence (a tx hash, a screenshot, an email, a contract clause) and you do not have it, reply literally: "I do not have evidence of that on the case record." Do not paraphrase.\n` +
    `  3. Reference only items already in the trial transcript or in your case docket. If the docket is empty, say so.\n` +
    `  4. One or two short paragraphs. First-person. Plain prose, no legal arguments — that is your lawyer's job.\n`;

  return {
    side: deps.side,
    ensName: deps.ensName,
    async answer(question, transcriptSoFar) {
      const docketBlock = deps.docketText ? `${deps.docketText}\n\n` : "";
      const prompt =
        `${docketBlock}` +
        `Trial transcript so far:\n---\n${transcriptSoFar}\n---\n\n` +
        `Your counsel asks:\n  ${question}\n\nYour answer:`;
      const out = await deps.llm.complete({
        system: persona,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 500,
      });
      return out.text.trim();
    },
  };
}
