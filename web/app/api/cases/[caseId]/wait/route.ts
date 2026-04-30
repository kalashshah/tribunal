import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { listQuestions } from "../../../../../lib/case-store";

export const runtime = "nodejs";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const VAR_DIR = path.resolve(process.cwd(), "var");
const TICK_MS = 1500;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 9 * 60 * 1000;

function loadAddresses(): { TribunalCore: string } | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
    if (!c?.TribunalCore) return null;
    return { TribunalCore: c.TribunalCore };
  } catch { return null; }
}

const ABI = ["function caseStatus(uint256) view returns (uint8)"];

interface QuestionEvent {
  event: "question";
  caseId: string;
  questionId: string;
  body: string;
  askedBy: string;
  askedAt: string;
  target: "accuser" | "defendant";
}
interface VerdictEvent { event: "verdict-ready"; caseId: string; status: number; }
interface IdleEvent   { event: "idle"; caseId: string; now: number; status: number; }

/// GET /api/cases/:caseId/wait?address=0x...&since=<ms>&timeoutMs=<ms>
/// Long-polls until one of:
///   - A pending question targeted at address arrives (askedAt > since)
///   - Case status reaches Ruled (5) or Settled (6)
///   - Timeout (returns event=idle so the agent can re-call)
export async function GET(req: Request, { params }: { params: { caseId: string } }) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address")?.toLowerCase();
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: "address (0x…40) required" }, { status: 400 });
  }
  const sinceParam = Number(url.searchParams.get("since") ?? "0");
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : Date.now();
  const timeoutMsRaw = Number(url.searchParams.get("timeoutMs") ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Math.min(
    Math.max(Number.isFinite(timeoutMsRaw) ? timeoutMsRaw : DEFAULT_TIMEOUT_MS, 5_000),
    MAX_TIMEOUT_MS,
  );

  const addr = loadAddresses();
  if (!addr) return NextResponse.json({ error: "deployment not found" }, { status: 503 });
  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tribunal = new ethers.Contract(addr.TribunalCore, ABI, provider);
  const caseIdBig = BigInt(params.caseId);

  const deadline = Date.now() + timeoutMs;
  let lastStatus = -1;

  while (Date.now() < deadline) {
    let status = -1;
    try {
      status = Number(await tribunal.caseStatus(caseIdBig));
    } catch {
      // chain blip — try again next tick
    }
    if (status >= 5) {
      const ev: VerdictEvent = { event: "verdict-ready", caseId: params.caseId, status };
      return NextResponse.json(ev);
    }
    lastStatus = status >= 0 ? status : lastStatus;

    const pending = listQuestions(VAR_DIR, params.caseId, {
      targetAddress: address,
      unansweredOnly: true,
    });
    const fresh = pending.find((q) => Date.parse(q.askedAt) > since);
    if (fresh) {
      const ev: QuestionEvent = {
        event: "question",
        caseId: params.caseId,
        questionId: fresh.id,
        body: fresh.body,
        askedBy: fresh.askedBy,
        askedAt: fresh.askedAt,
        target: fresh.target,
      };
      return NextResponse.json(ev);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(TICK_MS, remaining)));
  }

  const idle: IdleEvent = {
    event: "idle",
    caseId: params.caseId,
    now: Date.now(),
    status: lastStatus,
  };
  return NextResponse.json(idle);
}
