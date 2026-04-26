import { NextResponse } from "next/server";
import { enqueue } from "../../../lib/queue";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, string>;
  if (!body.accuser || !body.defendant || !body.accusation) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const c = await enqueue({
    accuser: body.accuser,
    defendant: body.defendant,
    escrow: body.escrow ?? "",
    escrowId: body.escrowId ?? "",
    accusation: body.accusation,
  });
  return NextResponse.json({ caseId: c.caseId });
}
