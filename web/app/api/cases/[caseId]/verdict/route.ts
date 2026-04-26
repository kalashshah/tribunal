import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";

const abi = [
  "function verdicts(uint256) view returns (bool exists, bool prevailingIsAccuser, bytes32 opinionRoot, uint64 postedAt)",
];

function loadDeployment(): { VerdictLog: string } | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export async function GET(_req: Request, ctx: { params: { caseId: string } }) {
  const dep = loadDeployment();
  if (!dep) return NextResponse.json({ verdict: null, error: "no deployment" }, { status: 503 });

  const provider = new ethers.JsonRpcProvider(process.env.OG_RPC_URL ?? "http://127.0.0.1:8545");
  const log = new ethers.Contract(dep.VerdictLog, abi, provider);
  try {
    const v = await log.verdicts(BigInt(ctx.params.caseId));
    if (!v.exists) return NextResponse.json({ verdict: null });
    return NextResponse.json({
      verdict: {
        prevailingIsAccuser: v.prevailingIsAccuser,
        opinionRoot: v.opinionRoot,
        postedAt: Number(v.postedAt),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ verdict: null, error: e.message }, { status: 500 });
  }
}
