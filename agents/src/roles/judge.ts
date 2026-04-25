import { keccak256, toUtf8Bytes } from "ethers";
import type { AxlClient } from "../transport/axl.js";
import type { Llm } from "../llm/client.js";
import type { TribunalClient } from "../chain/tribunal-client.js";

export interface JudgeArgs {
  ensName: string;
  caseId: bigint;
  /// ERC-7857 token id for this judge in JudgeINFT
  tokenId: bigint;
  personaPrompt: string;
  /// Hashes of prior cases this judge has ruled on, loaded from the iNFT
  /// rulingHistory. Used as soft precedent context.
  priorRulings: string[];
  llm: Llm;
  axl: AxlClient;
  tribunal: TribunalClient;
  clerkPeerId: string;
  model: string;
}

export interface Ruling {
  prevailingIsAccuser: boolean;
  opinion: string;
}

const SYSTEM = (persona: string, prior: string[]) =>
  `You are a judge in the Tribunal, an AI court for autonomous agents.

${persona}

Your prior ruling hashes (precedent context):
${prior.length > 0 ? prior.join("\n") : "(none)"}

Given the trial transcript, return JSON of the form:
  {"prevailingIsAccuser": boolean, "opinion": string}
The opinion is your reasoning, max 300 words. Return JSON ONLY, no preamble.`;

function parseRuling(text: string): Ruling {
  // The LLM may wrap JSON in ``` fences; strip them defensively.
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(stripped);
  if (typeof parsed.prevailingIsAccuser !== "boolean" || typeof parsed.opinion !== "string") {
    throw new Error("ruling JSON missing required fields");
  }
  return parsed as Ruling;
}

export interface Judge {
  deliberateAndRule(transcriptText: string): Promise<Ruling>;
}

export function createJudge(a: JudgeArgs): Judge {
  return {
    async deliberateAndRule(transcriptText) {
      const out = await a.llm.complete({
        system: SYSTEM(a.personaPrompt, a.priorRulings),
        messages: [
          { role: "user", content: `Trial transcript:\n${transcriptText}\n\nReturn the JSON now.` },
        ],
      });
      const ruling = parseRuling(out.text);
      const opinionHash = keccak256(toUtf8Bytes(ruling.opinion)) as `0x${string}`;

      await a.axl.send(a.clerkPeerId, {
        kind: "ruling",
        from: a.ensName,
        body: ruling.opinion,
        meta: {
          prevailingIsAccuser: ruling.prevailingIsAccuser,
          caseId: a.caseId.toString(),
        },
      });
      await a.tribunal.submitRuling(a.caseId, ruling.prevailingIsAccuser, opinionHash);
      await a.tribunal.appendJudgeMemory(a.tokenId, opinionHash);
      return ruling;
    },
  };
}
