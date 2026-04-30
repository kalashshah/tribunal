import { NextResponse } from "next/server";
import * as path from "node:path";
import {
  appendQuestion,
  listQuestions,
  type QuestionRecord,
} from "../../../../../lib/case-store";

export const runtime = "nodejs";

const VAR_DIR = path.resolve(process.cwd(), "var");

interface PostBody {
  questionId: string;
  askedBy: string;
  target: "accuser" | "defendant";
  targetAddress: string;
  body: string;
}

/// POST is unauthenticated for the agent runner — questions are written by
/// trusted backend processes only. The server is not internet-exposed in the
/// hackathon deployment. Add auth here before exposing publicly.
export async function POST(req: Request, { params }: { params: { caseId: string } }) {
  const caseId = params.caseId;
  let p: PostBody;
  try { p = (await req.json()) as PostBody; }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!p.questionId || !p.askedBy || !p.target || !p.targetAddress || !p.body) {
    return NextResponse.json({ error: "questionId, askedBy, target, targetAddress, body required" }, { status: 400 });
  }
  if (p.target !== "accuser" && p.target !== "defendant") {
    return NextResponse.json({ error: "target must be accuser|defendant" }, { status: 400 });
  }
  const q: QuestionRecord = {
    id: p.questionId,
    caseId,
    askedBy: p.askedBy,
    askedAt: new Date().toISOString(),
    target: p.target,
    targetAddress: p.targetAddress.toLowerCase(),
    body: p.body,
    status: "pending",
  };
  appendQuestion(VAR_DIR, q);
  return NextResponse.json({ ok: true, question: q });
}

export async function GET(req: Request, { params }: { params: { caseId: string } }) {
  const url = new URL(req.url);
  const targetAddress = url.searchParams.get("to") ?? undefined;
  const unansweredOnly = url.searchParams.get("unanswered") === "1";
  const got = listQuestions(VAR_DIR, params.caseId, { targetAddress, unansweredOnly });
  return NextResponse.json({ caseId: params.caseId, questions: got });
}
