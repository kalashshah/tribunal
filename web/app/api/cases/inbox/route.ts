import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { listQuestions } from "../../../../lib/case-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const VAR_DIR = path.resolve(process.cwd(), "var");

function loadAddresses(): { TribunalCore: string } | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
    if (!c?.TribunalCore) return null;
    return { TribunalCore: c.TribunalCore };
  } catch { return null; }
}

const ABI = [
  "function nextCaseId() view returns (uint256)",
  "function caseStatus(uint256) view returns (uint8)",
  "function caseAccuser(uint256) view returns (address)",
  "function caseDefendant(uint256) view returns (address)",
];

/// GET /api/cases/inbox?address=0x...&role=defendant|accuser|any&open=1
/// Returns cases involving the address, optionally filtered by role and to
/// only-open (status<6=Settled). For each, includes pending question count.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address")?.toLowerCase();
  const role = (url.searchParams.get("role") ?? "any") as "accuser" | "defendant" | "any";
  const onlyOpen = url.searchParams.get("open") !== "0";
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: "address (0x…40) required" }, { status: 400 });
  }
  const addr = loadAddresses();
  if (!addr) return NextResponse.json({ error: "deployment not found" }, { status: 503 });
  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tribunal = new ethers.Contract(addr.TribunalCore, ABI, provider);
  const next = (await tribunal.nextCaseId()) as bigint;

  const out: Array<Record<string, any>> = [];
  for (let i = 1n; i < next; i++) {
    const [s, accuser, defendant] = await Promise.all([
      tribunal.caseStatus(i),
      tribunal.caseAccuser(i),
      tribunal.caseDefendant(i),
    ]);
    const status = Number(s);
    if (onlyOpen && status >= 6) continue;
    const accuserL = (accuser as string).toLowerCase();
    const defendantL = (defendant as string).toLowerCase();
    const involved =
      role === "accuser"   ? accuserL === address :
      role === "defendant" ? defendantL === address :
      (accuserL === address || defendantL === address);
    if (!involved) continue;
    const myRole: "accuser" | "defendant" = accuserL === address ? "accuser" : "defendant";
    const pending = listQuestions(VAR_DIR, i.toString(), { targetAddress: address, unansweredOnly: true });
    out.push({
      caseId: i.toString(),
      status,
      role: myRole,
      accuser, defendant,
      pendingQuestions: pending.length,
      pendingQuestionIds: pending.map((p) => p.id),
    });
  }
  return NextResponse.json({ address, role, cases: out });
}
