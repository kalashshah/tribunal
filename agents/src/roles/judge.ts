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

/// Extract the first balanced {...} object from arbitrary LLM output.
/// Handles markdown fences, leading commentary, and trailing prose.
function extractFirstJsonObject(text: string): string {
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return stripped;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return stripped.slice(start);
}

function parseRuling(text: string): Ruling {
  const candidate = extractFirstJsonObject(text);
  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    // Best-effort repair: replace bare newlines inside strings with \n.
    const repaired = candidate.replace(
      /"((?:\\.|[^"\\])*)"/gs,
      (_m, body) => `"${body.replace(/\r?\n/g, "\\n")}"`,
    );
    parsed = JSON.parse(repaired);
  }
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
      // Up to 3 attempts: free models occasionally return malformed JSON.
      let ruling: Ruling | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const out = await a.llm.complete({
          system: SYSTEM(a.personaPrompt, a.priorRulings),
          messages: [
            { role: "user", content: `Trial transcript:\n${transcriptText}\n\nReturn the JSON now.` },
          ],
          responseFormat: "json",
        });
        try {
          ruling = parseRuling(out.text);
          break;
        } catch (e) {
          lastError = e;
          if (attempt === 3) {
            console.error(`[judge] parse failed (attempt ${attempt}). Raw output:\n${out.text}`);
          }
        }
      }
      if (!ruling) throw lastError ?? new Error("ruling could not be parsed");
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
