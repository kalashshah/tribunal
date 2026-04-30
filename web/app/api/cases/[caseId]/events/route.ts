import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";

interface MetaRow { seq: number; rootHash?: string; storageTxHash?: string; storageTxSeq?: number; anchorTxHash?: string; error?: string }

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => { try { return JSON.parse(l) as T; } catch { return null; } })
    .filter((e): e is T => e !== null);
}

export async function GET(_req: Request, ctx: { params: { caseId: string } }) {
  const eventsFile = path.resolve(process.cwd(), `../.events-${ctx.params.caseId}.jsonl`);
  const metaFile   = path.resolve(process.cwd(), `../.events-${ctx.params.caseId}.meta.jsonl`);
  const events = readJsonl<any>(eventsFile);
  const metaRows = readJsonl<MetaRow>(metaFile);
  const metaBySeq = new Map(metaRows.map((m) => [m.seq, m]));
  const merged = events.map((e) => {
    const m = metaBySeq.get(e.seq);
    return m ? { ...e, rootHash: m.rootHash, storageTxHash: m.storageTxHash, storageTxSeq: m.storageTxSeq, anchorTxHash: m.anchorTxHash, persistError: m.error } : e;
  });
  return NextResponse.json(merged);
}
