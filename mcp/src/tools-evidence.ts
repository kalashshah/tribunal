export interface EvidenceCtx {
  backendUrl: string;
  walletAddress: string;
  signMessage(message: string): Promise<string>;
}

function buildAuthMessage(address: string): { address: string; message: string; nonce: string } {
  const nonce = Math.random().toString(36).slice(2);
  const message =
    `tribunal-auth\n` +
    `address: ${address.toLowerCase()}\n` +
    `nonce: ${nonce}\n` +
    `issued-at: ${new Date().toISOString()}`;
  return { address, message, nonce };
}

export interface GuidanceShape {
  result: unknown;
  phase: "evidence-gathering" | "trial-running" | "ruled" | "unknown";
  docketItemCount: number;
  pendingQuestionCount: number;
  nextActions: string[];
}

async function fetchPhase(
  ctx: EvidenceCtx,
  caseId: string,
): Promise<{ phase: GuidanceShape["phase"]; docketItemCount: number; pendingQuestionCount: number; status: number }> {
  let docketItemCount = 0;
  let pendingQuestionCount = 0;
  let status = -1;
  try {
    const dr = await fetch(`${ctx.backendUrl}/api/cases/${encodeURIComponent(caseId)}/docket`);
    if (dr.ok) {
      const j = (await dr.json()) as { items?: unknown[] };
      docketItemCount = j.items?.length ?? 0;
    }
  } catch { /* ignore */ }
  try {
    const ir = await fetch(`${ctx.backendUrl}/api/cases/inbox?address=${ctx.walletAddress.toLowerCase()}`);
    if (ir.ok) {
      const j = (await ir.json()) as { cases?: Array<{ caseId: string; status: number; pendingQuestions: number }> };
      const me = j.cases?.find((c) => c.caseId === caseId);
      if (me) {
        status = me.status;
        pendingQuestionCount = me.pendingQuestions ?? 0;
      }
    }
  } catch { /* ignore */ }
  let phase: GuidanceShape["phase"] = "unknown";
  if (status >= 5) phase = "ruled";
  else if (status >= 1 && status <= 4) phase = docketItemCount === 0 ? "evidence-gathering" : "trial-running";
  else if (status === -1) phase = docketItemCount === 0 ? "evidence-gathering" : "trial-running";
  return { phase, docketItemCount, pendingQuestionCount, status };
}

function buildNextActions(args: {
  caseId: string;
  phase: GuidanceShape["phase"];
  docketItemCount: number;
  pendingQuestionCount: number;
}): string[] {
  const a: string[] = [];
  if (args.phase === "ruled") {
    a.push(`Case ${args.caseId} has been ruled. Call tribunal_get_verdict({caseId:"${args.caseId}"}) and surface the opinion (it will cite evd_ ids).`);
    return a;
  }
  if (args.docketItemCount === 0) {
    a.push(
      `URGENT: docket has 0 evidence items. Lawyers and judges are forbidden from inventing facts — without evidence the case will lose. ` +
      `Ask the user for concrete sources (emails, transaction hashes, contract clauses, screenshots, calendar invites). ` +
      `Use any connected MCP (Gmail, Drive, Calendar, blockchain explorer) to retrieve them.`,
    );
    a.push(`Then call tribunal_submit_evidence({caseId:"${args.caseId}", body:"<fact>", url:"<source link>"}) for EACH artifact.`);
  } else {
    a.push(`Docket has ${args.docketItemCount} item(s). Add more if material facts are still missing — better coverage = stronger case.`);
  }
  if (args.pendingQuestionCount > 0) {
    a.push(
      `${args.pendingQuestionCount} question(s) are waiting for you. Call tribunal_inbox to list them, then for each: ` +
      `(1) search connected MCPs for supporting data, (2) call tribunal_submit_evidence with what you find, ` +
      `(3) call tribunal_answer_question citing the evd_ ids. Never answer from imagination.`,
    );
  }
  a.push(
    `When ready, call tribunal_wait_for_action({caseId:"${args.caseId}"}) to long-poll. ` +
    `It blocks up to 5 min and returns the moment a question or verdict arrives. Stay in this loop until event="verdict-ready".`,
  );
  return a;
}

/// Wraps a result with a phase tag + nextActions guidance so the calling LLM
/// knows what to do next. Pass the parsed object — we re-stringify.
export async function withGuidance(
  ctx: EvidenceCtx,
  caseId: string,
  result: unknown,
): Promise<string> {
  const { phase, docketItemCount, pendingQuestionCount } = await fetchPhase(ctx, caseId);
  const out: GuidanceShape = {
    result,
    phase,
    docketItemCount,
    pendingQuestionCount,
    nextActions: buildNextActions({ caseId, phase, docketItemCount, pendingQuestionCount }),
  };
  return JSON.stringify(out);
}

export async function handleSubmitEvidence(
  ctx: EvidenceCtx,
  args: { caseId: string; body: string; url?: string },
): Promise<string> {
  const { address, message } = buildAuthMessage(ctx.walletAddress);
  const signature = await ctx.signMessage(message);
  const res = await fetch(`${ctx.backendUrl}/api/cases/${encodeURIComponent(args.caseId)}/docket`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, message, signature, body: args.body, ...(args.url ? { url: args.url } : {}) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`submit_evidence failed: ${res.status} ${text}`);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return withGuidance(ctx, args.caseId, parsed);
}

export async function handleGetDocket(ctx: EvidenceCtx, args: { caseId: string }): Promise<string> {
  const res = await fetch(`${ctx.backendUrl}/api/cases/${encodeURIComponent(args.caseId)}/docket`);
  if (!res.ok) throw new Error(`get_docket failed: ${res.status}`);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return withGuidance(ctx, args.caseId, parsed);
}

export async function handleAnswerQuestion(
  ctx: EvidenceCtx,
  args: { caseId: string; questionId: string; answer: string },
): Promise<string> {
  const { address, message } = buildAuthMessage(ctx.walletAddress);
  const signature = await ctx.signMessage(message);
  const url = `${ctx.backendUrl}/api/cases/${encodeURIComponent(args.caseId)}/questions/${encodeURIComponent(args.questionId)}/answer`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, message, signature, answer: args.answer }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`answer_question failed: ${res.status} ${text}`);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return withGuidance(ctx, args.caseId, parsed);
}

export async function handleInbox(
  ctx: EvidenceCtx,
  args: { role?: "accuser" | "defendant" | "any" } = {},
): Promise<string> {
  const role = args.role ?? "any";
  const res = await fetch(`${ctx.backendUrl}/api/cases/inbox?address=${ctx.walletAddress.toLowerCase()}&role=${role}`);
  if (!res.ok) throw new Error(`inbox failed: ${res.status}`);
  return res.text();
}

export async function handleMyCases(ctx: EvidenceCtx): Promise<string> {
  return handleInbox(ctx, { role: "any" });
}

export async function handleWaitForAction(
  ctx: EvidenceCtx,
  args: { caseId: string; sinceMs?: number; timeoutMs?: number },
): Promise<string> {
  const params = new URLSearchParams({ address: ctx.walletAddress.toLowerCase() });
  if (typeof args.sinceMs === "number") params.set("since", String(args.sinceMs));
  if (typeof args.timeoutMs === "number") params.set("timeoutMs", String(args.timeoutMs));
  const url = `${ctx.backendUrl}/api/cases/${encodeURIComponent(args.caseId)}/wait?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`wait_for_action failed: ${res.status} ${t}`);
  }
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return withGuidance(ctx, args.caseId, parsed);
}
