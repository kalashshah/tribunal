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
  /// Loaded rulebook (TOC + body lookup map). Required.
  rulebook: { toc: import("../judge/deliberate-loop.js").TocEntry[]; byId: Map<string, import("../judge/deliberate-loop.js").Article> };
  /// 0G storage for chain manifest upload. Required.
  storage: import("../storage/og-storage.js").ZgStorage;
  /// Renders a chain manifest viewer URL from its rootHash.
  chainUrl: (rootHash: string) => string;
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
      const { runDeliberateLoop } = await import("../judge/deliberate-loop.js");
      const { buildChainManifest, uploadChainManifest } = await import("../judge/chain.js");

      const out = await runDeliberateLoop({
        llm: a.llm,
        systemBase: SYSTEM(a.personaPrompt, a.priorRulings, a.docketText ?? "Case docket: (not loaded)"),
        transcript: transcriptText,
        toc: a.rulebook.toc,
        lookupArticle: (id) => a.rulebook.byId.get(id) ?? null,
        maxLookups: 3,
        maxArticles: 6,
      });

      const opinionHash = keccak256(toUtf8Bytes(out.ruling.opinion)) as `0x${string}`;

      const manifest = buildChainManifest({
        caseId: a.caseId.toString(), model: a.model,
        ruling: out.ruling, chain: out.chain,
      });
      const up = await uploadChainManifest({ storage: a.storage, manifest, url: a.chainUrl });
      const ruling: Ruling = {
        prevailingIsAccuser: out.ruling.prevailingIsAccuser,
        opinion: out.ruling.opinion,
        receipt: { hash: up.rootHash, url: up.url },
      };

      await a.axl.send(a.clerkPeerId, {
        kind: "ruling", from: a.ensName, body: ruling.opinion,
        meta: {
          prevailingIsAccuser: ruling.prevailingIsAccuser,
          caseId: a.caseId.toString(),
          chainHash: up.rootHash, chainUrl: up.url,
        },
      });
      await a.tribunal.submitRuling(a.caseId, ruling.prevailingIsAccuser, opinionHash);
      await a.tribunal.appendJudgeMemory(a.tokenId, opinionHash);
      return ruling;
    },
  };
}
