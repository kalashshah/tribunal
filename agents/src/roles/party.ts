import type { Llm } from "../llm/client.js";

export type PartySide = "accuser" | "defendant";

export interface PartyDeps {
  side: PartySide;
  ensName: string;        // e.g. "bright-compass.tribunal.eth"
  accusation: string;     // original accusation text
  llm: Llm;
  model: string;
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
    `You are speaking to your own counsel during a confidential interview. Answer questions ` +
    `honestly from your perspective — what you believe happened, what you remember, what evidence ` +
    `you can point to. Be specific and concrete; if you don't know something, say so plainly. ` +
    `Do not perform legal arguments — that's your lawyer's job. Speak in first person, one or two ` +
    `paragraphs at most.`;

  return {
    side: deps.side,
    ensName: deps.ensName,
    async answer(question, transcriptSoFar) {
      const prompt =
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
