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
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const j = (await res.json()) as { question?: { status: string; answer?: string } };
        if (j.question?.status === "answered" && typeof j.question.answer === "string") {
          return j.question.answer;
        }
      }
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}
