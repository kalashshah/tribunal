import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const ABI = [
  "function caseAccuser(uint256) view returns (address)",
  "function caseDefendant(uint256) view returns (address)",
  "function caseStatus(uint256) view returns (uint8)",
];

function loadTribunalAddress(): string | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return (
      j?.chains?.ogGalileo?.contracts?.TribunalCore ??
      j?.legacy?.TribunalCore ??
      j?.TribunalCore ??
      null
    );
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  ctx: { params: { caseId: string } },
) {
  const addr = loadTribunalAddress();
  if (!addr) return NextResponse.json({ error: "deployment not found" }, { status: 503 });

  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tribunal = new ethers.Contract(addr, ABI, provider);

  try {
    const id = BigInt(ctx.params.caseId);
    const [accuser, defendant, status] = await Promise.all([
      tribunal.caseAccuser(id) as Promise<string>,
      tribunal.caseDefendant(id) as Promise<string>,
      tribunal.caseStatus(id) as Promise<bigint>,
    ]);
    return NextResponse.json({
      caseId: ctx.params.caseId,
      accuser,
      defendant,
      status: Number(status),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
