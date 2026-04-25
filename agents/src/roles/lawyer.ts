import type { AxlClient } from "../transport/axl.js";
import type { Llm } from "../llm/client.js";

export interface LawyerArgs {
  side: "accuser" | "defendant";
  brief: string;
  ensName: string;
  clerkPeerId: string;
  caseId: string;
  llm: Llm;
  axl: AxlClient;
  model: string;
}

export interface Lawyer {
  openingStatement(): Promise<string>;
  rebuttal(opposingArgument: string): Promise<string>;
  closingStatement(transcriptText: string): Promise<string>;
}

const SYSTEM = (side: string, brief: string) =>
  `You are a lawyer for the ${side} in an AI court. Argue persuasively but truthfully.

Brief from your client:
${brief}

Keep responses under 200 words and structured (claim, evidence, conclusion).`;

export function createLawyer(a: LawyerArgs): Lawyer {
  async function speak(prompt: string): Promise<string> {
    const out = await a.llm.complete({
      system: SYSTEM(a.side, a.brief),
      messages: [{ role: "user", content: prompt }],
    });
    await a.axl.send(a.clerkPeerId, {
      kind: "argument",
      from: a.ensName,
      body: out.text,
      meta: { side: a.side, caseId: a.caseId },
    });
    return out.text;
  }
  return {
    openingStatement: () => speak("Provide your opening statement."),
    rebuttal: (opposing) =>
      speak(`Opposing argument:\n${opposing}\n\nRebut.`),
    closingStatement: (transcriptText) =>
      speak(`Trial transcript so far:\n${transcriptText}\n\nProvide your closing.`),
  };
}
