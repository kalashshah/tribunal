import { NextResponse } from "next/server";
import * as path from "node:path";
import { verifyTribunalAuth } from "../../../../../../../lib/siwe";
import { recordAnswer, getQuestion } from "../../../../../../../lib/case-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VAR_DIR = path.resolve(process.cwd(), "var");

interface PostBody {
  address: string;
  message: string;
  signature: string;
  answer: string;
}

export async function POST(
  req: Request,
  { params }: { params: { caseId: string; questionId: string } },
) {
  const { caseId, questionId } = params;
  let p: PostBody;
  try { p = (await req.json()) as PostBody; }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!p.address || !p.message || !p.signature || typeof p.answer !== "string") {
    return NextResponse.json({ error: "address, message, signature, answer required" }, { status: 400 });
  }
  if (!verifyTribunalAuth({ address: p.address, message: p.message, signature: p.signature })) {
    return NextResponse.json({ error: "auth failed" }, { status: 401 });
  }
  const existing = getQuestion(VAR_DIR, caseId, questionId);
  if (!existing) return NextResponse.json({ error: "question not found" }, { status: 404 });
  if (existing.targetAddress.toLowerCase() !== p.address.toLowerCase()) {
    return NextResponse.json({ error: "only the addressed party may answer" }, { status: 403 });
  }
  const ok = recordAnswer(VAR_DIR, caseId, questionId, p.answer, new Date().toISOString());
  if (!ok) return NextResponse.json({ error: "already answered" }, { status: 409 });
  const updated = getQuestion(VAR_DIR, caseId, questionId);
  return NextResponse.json({ ok: true, question: updated });
}

export async function GET(
  _req: Request,
  { params }: { params: { caseId: string; questionId: string } },
) {
  const q = getQuestion(VAR_DIR, params.caseId, params.questionId);
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ question: q });
}
