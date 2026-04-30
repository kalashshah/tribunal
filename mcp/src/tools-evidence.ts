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
  return text;
}

export async function handleGetDocket(ctx: EvidenceCtx, args: { caseId: string }): Promise<string> {
  const res = await fetch(`${ctx.backendUrl}/api/cases/${encodeURIComponent(args.caseId)}/docket`);
  if (!res.ok) throw new Error(`get_docket failed: ${res.status}`);
  return res.text();
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
  return text;
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
