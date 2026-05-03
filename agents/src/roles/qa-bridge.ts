export interface PostQuestionInput {
  caseId: string;
  questionId: string;
  askedBy: string;
  target: "accuser" | "defendant";
  targetAddress: string;
  body: string;
}

export async function postQuestion(backendUrl: string, q: PostQuestionInput): Promise<void> {
  const res = await fetch(`${backendUrl}/api/cases/${encodeURIComponent(q.caseId)}/questions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      questionId: q.questionId,
      askedBy: q.askedBy,
      target: q.target,
      targetAddress: q.targetAddress,
      body: q.body,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`postQuestion failed: ${res.status} ${t}`);
  }
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/// Polls GET /api/cases/:caseId/questions/:qid/answer until status==="answered"
/// or timeout. Returns the answer text on success, null on timeout. Network
/// errors are silently retried.
export async function pollAnswer(
  backendUrl: string,
  caseId: string,
  questionId: string,
  opts: PollOptions = {},
): Promise<string | null> {
  const interval = opts.intervalMs ?? 2000;
  const timeout  = opts.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeout;
  const url = `${backendUrl}/api/cases/${encodeURIComponent(caseId)}/questions/${encodeURIComponent(questionId)}/answer`;
  let iter = 0;
  const tagBase = `[pollAnswer c${caseId} q=${questionId.slice(-8)}]`;
  while (Date.now() < deadline) {
    iter++;
    const ctrl = new AbortController();
    const fetchTimeout = setTimeout(() => { console.log(`${tagBase} iter=${iter} ABORTING (10s)`); ctrl.abort(); }, 10_000);
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const t1 = Date.now();
      if (!res.ok) {
        console.log(`${tagBase} iter=${iter} fetch=${t1-t0}ms status=${res.status} (skip)`);
      } else {
        const j = (await res.json()) as { question?: { status: string; answer?: string } };
        const t2 = Date.now();
        const st = j.question?.status ?? "?";
        console.log(`${tagBase} iter=${iter} fetch=${t1-t0}ms json=${t2-t1}ms status=${st}`);
        if (j.question?.status === "answered" && typeof j.question.answer === "string") {
          return j.question.answer;
        }
      }
    } catch (e) {
      console.log(`${tagBase} iter=${iter} ERROR after ${Date.now()-t0}ms: ${(e as Error).message?.slice(0,120)}`);
    } finally {
      clearTimeout(fetchTimeout);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}
