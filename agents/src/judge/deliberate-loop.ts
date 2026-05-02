import type { Llm } from "../llm/client.js";

export interface TocEntry { id: string; title: string }
export interface Article  { id: string; title: string; body: string }

export interface ChainStep {
  index: number;
  kind: "clarify" | "lookup" | "rule";
  /// Articles requested in this step (lookup only).
  articleIds?: string[];
  /// Receipt produced by the LLM call for this step. Falsy for non-REE
  /// backends; the chain still records the step but with hash = "" (the
  /// caller may decide to anchor a chain root only when receipts exist).
  receiptHash: string;
  receiptUrl:  string;
  /// Hash of the previous step's receipt (linked-list pointer). null for step 0.
  prevHash: string | null;
}

export interface Ruling {
  prevailingIsAccuser: boolean;
  opinion: string;
}

export interface DeliberateInput {
  llm: Llm;
  systemBase: string;
  transcript: string;
  toc: TocEntry[];
  lookupArticle: (id: string) => Article | null;
  /// Max LOOKUP iterations before failure. Includes re-prompts on malformed.
  maxLookups: number;
  /// Hard cap on total articles fetched across the loop.
  maxArticles: number;
  /// Optional clarifying-question receipt (judge.ts may produce one before
  /// calling this loop). Recorded as chain step 0 if present.
  priorClarify?: { receiptHash: string; receiptUrl: string };
}

export interface DeliberateOutput {
  ruling: Ruling;
  chain: ChainStep[];
}

export type ParsedStep =
  | { kind: "lookup"; ids: string[] }
  | { kind: "rule";   ruling: Ruling }
  | { kind: "malformed"; raw: string };

export function parseStep(text: string): ParsedStep {
  const stripped = text.trim().replace(/^```(?:[a-z]+)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const lookupMatch = stripped.match(/^LOOKUP:\s*([^\n]+)/im);
  if (lookupMatch) {
    const ids = lookupMatch[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    return { kind: "lookup", ids };
  }
  const ruleIdx = stripped.search(/^RULE:/im);
  if (ruleIdx !== -1) {
    const after = stripped.slice(ruleIdx + 5).trim();
    const obj = extractFirstJsonObject(after);
    try {
      const j = JSON.parse(obj);
      if (typeof j.prevailingIsAccuser === "boolean" && typeof j.opinion === "string") {
        return { kind: "rule", ruling: { prevailingIsAccuser: j.prevailingIsAccuser, opinion: j.opinion } };
      }
    } catch { /* fall through */ }
  }
  return { kind: "malformed", raw: stripped };
}

function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

const PROTOCOL = `
You will deliberate in a loop. Each turn output exactly ONE of:
  LOOKUP: <comma-separated article ids>     — fetch full article bodies
  RULE: {"prevailingIsAccuser": <bool>, "opinion": "<reasoning, max 250 words, must cite article ids you have looked up>"}

Rules:
- You MUST output a single line starting with LOOKUP: or RULE:. No prose around it.
- Cite at least one article id in the opinion that you actually looked up.
- If you have enough material, emit RULE. Do not look up more than necessary.
`.trim();

function tocText(toc: TocEntry[]): string {
  return toc.map((e) => `  ${e.id} — ${e.title}`).join("\n");
}

export async function runDeliberateLoop(input: DeliberateInput): Promise<DeliberateOutput> {
  const { llm, systemBase, transcript, toc, lookupArticle, maxLookups, maxArticles, priorClarify } = input;

  const chain: ChainStep[] = [];
  if (priorClarify) {
    chain.push({
      index: 0, kind: "clarify",
      receiptHash: priorClarify.receiptHash,
      receiptUrl:  priorClarify.receiptUrl,
      prevHash: null,
    });
  }
  let prevHash: string | null = chain.length ? chain[chain.length - 1]!.receiptHash : null;

  const conversation: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: `Transcript:\n${transcript}\n\nRulebook table of contents:\n${tocText(toc)}\n\nBegin deliberation.` },
  ];

  let lookupsUsed = 0;
  let articlesFetched = 0;
  let malformedRetries = 0;

  while (lookupsUsed <= maxLookups) {
    const out = await llm.complete({
      system: `${systemBase}\n\n${PROTOCOL}`,
      messages: conversation,
      responseFormat: "json",
    });
    const parsed = parseStep(out.text);

    if (parsed.kind === "rule") {
      chain.push({
        index: chain.length, kind: "rule",
        receiptHash: out.receipt?.hash ?? "",
        receiptUrl:  out.receipt?.url  ?? "",
        prevHash,
      });
      return { ruling: parsed.ruling, chain };
    }

    if (parsed.kind === "lookup") {
      lookupsUsed += 1;
      const knownIds = new Set(toc.map((e) => e.id));
      const valid   = parsed.ids.filter((id) => knownIds.has(id));
      const unknown = parsed.ids.filter((id) => !knownIds.has(id));
      const room    = Math.max(0, maxArticles - articlesFetched);
      const taken   = valid.slice(0, room);
      articlesFetched += taken.length;

      const articles = taken.map((id) => lookupArticle(id)).filter((a): a is Article => !!a);
      const stepIdx = chain.length;
      chain.push({
        index: stepIdx, kind: "lookup",
        articleIds: taken,
        receiptHash: out.receipt?.hash ?? "",
        receiptUrl:  out.receipt?.url  ?? "",
        prevHash,
      });
      prevHash = chain[stepIdx]!.receiptHash;

      conversation.push({ role: "assistant", content: out.text });
      const body = [
        unknown.length > 0 ? `Unknown ids ignored: ${unknown.join(", ")}.` : "",
        articles.length > 0
          ? `Articles:\n${articles.map((a) => `[${a.id}] ${a.title}\n${a.body}`).join("\n\n")}`
          : "(no valid ids returned — pick from the table of contents)",
      ].filter(Boolean).join("\n\n");
      conversation.push({ role: "user", content: body });
      continue;
    }

    // malformed: re-prompt. After 3 consecutive malformeds, abort.
    malformedRetries += 1;
    if (malformedRetries > 2) throw new Error("malformed output 3 times in a row");
    conversation.push({ role: "assistant", content: out.text });
    conversation.push({ role: "user", content:
      "Your previous response did not start with LOOKUP: or RULE:. Re-emit a valid line." });
  }

  throw new Error(`exceeded max lookups (${maxLookups}) without RULE`);
}
