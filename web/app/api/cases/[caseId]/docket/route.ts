import { NextResponse } from "next/server";
import * as path from "node:path";
import { verifyTribunalAuth } from "../../../../../lib/siwe";
import {
  appendDocketItem,
  listDocketItems,
  type DocketItem,
} from "../../../../../lib/case-store";

export const runtime = "nodejs";

const VAR_DIR = path.resolve(process.cwd(), "var");

interface PostBody {
  address: string;
  message: string;
  signature: string;
  body: string;
  url?: string;
}

export async function POST(req: Request, { params }: { params: { caseId: string } }) {
  const caseId = params.caseId;
  let payload: PostBody;
  try {
    payload = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!payload.address || !payload.message || !payload.signature || !payload.body) {
    return NextResponse.json({ error: "address, message, signature, body required" }, { status: 400 });
  }
  if (!verifyTribunalAuth({ address: payload.address, message: payload.message, signature: payload.signature })) {
    return NextResponse.json({ error: "auth failed" }, { status: 401 });
  }

  const id = `evd_${caseId}_${Math.random().toString(36).slice(2, 10)}`;
  const item: DocketItem = {
    id,
    caseId,
    submittedBy: payload.address.toLowerCase(),
    submittedAt: new Date().toISOString(),
    kind: "evidence",
    body: payload.body,
    ...(payload.url ? { url: payload.url } : {}),
  };
  appendDocketItem(VAR_DIR, item);
  return NextResponse.json({ ok: true, item });
}

export async function GET(_req: Request, { params }: { params: { caseId: string } }) {
  const items = listDocketItems(VAR_DIR, params.caseId);
  return NextResponse.json({ caseId: params.caseId, items });
}
