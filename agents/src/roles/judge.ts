import { keccak256, toUtf8Bytes } from "ethers";
import type { AxlClient } from "../transport/axl.js";
import type { Llm } from "../llm/client.js";
import type { TribunalClient } from "../chain/tribunal-client.js";
import { askParty, type Party, tryParseJsonObject } from "./qa.js";
import type { PartyAgent } from "./party.js";

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
  partyEns: { accuser: string; defendant: string };
  /// Optional party agents for judge clarifying questions. If absent, judge
  /// skips clarifying questions silently.
  partyAgents?: { accuser: PartyAgent; defendant: PartyAgent };
  /// Optional transcript getter for party agent context.
  getTranscript?: () => string;
  partyAddress: { accuser: string; defendant: string };
  backendUrl: string;
  mode: "human" | "auto";
  qaTimeoutMs?: number;
  /// Optional pre-rendered case docket text. The judge captures it by closure
  /// at construction time; re-create the judge between phases for fresh text.
  docketText?: string;
}

export interface Ruling {
  prevailingIsAccuser: boolean;
  opinion: string;
  /// Receipt from a verifiable inference backend (REE), if the LLM
  /// produced one. Absent for OpenRouter/OpenAI/Anthropic backends.
  receipt?: { hash: `0x${string}`; url: string };
}

const SYSTEM = (persona: string, prior: string[], docketText: string) =>
  `You are a judge in the Tribunal, an AI court for autonomous agents.

${persona}

Your prior ruling hashes (precedent context):
${prior.length > 0 ? prior.join("\n") : "(none)"}

${docketText}

Decision rules:
- Rule ONLY on the trial transcript and the docket above. If a fact is asserted but absent from both, treat it as unproven.
- Burden: the accuser carries it. If neither side produced docket evidence, rule for the defendant.
- Your opinion must reference docket items by evd_ id or quote transcript lines.
- Do not invent dates, amounts, statutes, or precedents.

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
  /// Optional pre-deliberation step: judge may pose ONE clarifying question
  /// to either party if a material fact is unclear. Returns true if a
  /// question was asked (and answered, or timed out). The answer lands in
  /// the transcript via the qa bridge so deliberateAndRule sees it.
  clarifyingQuestion(transcriptText: string): Promise<boolean>;
  deliberateAndRule(transcriptText: string): Promise<Ruling>;
}

interface ClarifyAction {
  action: "ask" | "none";
  target?: Party;
  question?: string;
}

export function createJudge(a: JudgeArgs): Judge {
  return {
    async clarifyingQuestion(transcriptText) {
      const out = await a.llm.complete({
        system:
          SYSTEM(a.personaPrompt, a.priorRulings, a.docketText ?? "Case docket: (not loaded)") +
          `\n\nBefore ruling you may pose ONE clarifying question to either party — only if a material fact is genuinely unclear from the transcript. Output JSON:\n` +
          `  {"action":"ask","target":"accuser"|"defendant","question":"<one question>"}\n` +
          `  {"action":"none"}\n` +
          `Prefer "none" unless a question would meaningfully change the outcome.`,
        messages: [{ role: "user", content: `Transcript so far:\n${transcriptText}\n\nDecide.` }],
        responseFormat: "json",
      });
      const act = tryParseJsonObject<ClarifyAction>(out.text);
      if (!act || act.action !== "ask" || !act.target || !act.question) return false;
      const partyAgent = a.partyAgents?.[act.target];
      if (!partyAgent) return false; // no party agent wired — skip silently
      try {
        const transcriptSoFar = a.getTranscript?.() ?? transcriptText;
        await askParty(
          {
            caseId: a.caseId.toString(),
            axl: a.axl,
            clerkPeerId: a.clerkPeerId,
            asker: a.ensName,
            askerSide: "judge",
            partyEns: a.partyEns,
            partyAddress: a.partyAddress,
            backendUrl: a.backendUrl,
            mode: a.mode,
            timeoutMs: a.qaTimeoutMs,
          },
          act.target,
          act.question,
          transcriptSoFar,
          partyAgent,
        );
        return true;
      } catch {
        return false; // failed — proceed without
      }
    },

    async deliberateAndRule(transcriptText) {
      // Up to 3 attempts: free models occasionally return malformed JSON.
      let ruling: Ruling | undefined;
      let receipt: { hash: `0x${string}`; url: string } | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const out = await a.llm.complete({
          system: SYSTEM(a.personaPrompt, a.priorRulings, a.docketText ?? "Case docket: (not loaded)"),
          messages: [
            { role: "user", content: `Trial transcript:\n${transcriptText}\n\nReturn the JSON now.` },
          ],
          responseFormat: "json",
        });
        try {
          ruling = parseRuling(out.text);
          // Only attach the receipt from the *successful* attempt — earlier
          // tries that produced malformed JSON aren't the verdict the panel
          // anchors.
          if (out.receipt) receipt = out.receipt;
          break;
        } catch (e) {
          lastError = e;
          if (attempt === 3) {
            console.error(`[judge] parse failed (attempt ${attempt}). Raw output:\n${out.text}`);
          }
        }
      }
      if (!ruling) throw lastError ?? new Error("ruling could not be parsed");
      if (receipt) ruling.receipt = receipt;
      const opinionHash = keccak256(toUtf8Bytes(ruling.opinion)) as `0x${string}`;

      await a.axl.send(a.clerkPeerId, {
        kind: "ruling",
        from: a.ensName,
        body: ruling.opinion,
        meta: {
          prevailingIsAccuser: ruling.prevailingIsAccuser,
          caseId: a.caseId.toString(),
          ...(receipt ? { receiptHash: receipt.hash, receiptUrl: receipt.url } : {}),
        },
      });
      await a.tribunal.submitRuling(a.caseId, ruling.prevailingIsAccuser, opinionHash);
      await a.tribunal.appendJudgeMemory(a.tokenId, opinionHash);
      return ruling;
    },
  };
}
