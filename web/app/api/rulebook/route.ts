import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

const ABI = [
  "function baseRoot() view returns (bytes32)",
  "function baseUrl() view returns (string)",
  "function amendmentCount() view returns (uint256)",
  "function amendmentAt(uint256) view returns (tuple(bytes32 cidRoot,string cidUrl,string title,uint64 appliedAt))",
  "function proposalCount() view returns (uint256)",
  "function proposalAt(uint256) view returns (tuple(address proposer,string title,bytes32 cidRoot,string cidUrl,uint32 yes,uint32 no,bool executed))",
];

function loadAddr(): string | null {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.RuleBookGovernor ?? j?.legacy?.RuleBookGovernor ?? null;
  } catch { return null; }
}

export async function GET() {
  const addr = loadAddr();
  if (!addr) return NextResponse.json({ error: "no governor address" }, { status: 500 });
  const rpc = process.env.WEB_RPC_URL ?? "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpc);
  const g = new ethers.Contract(addr, ABI, provider);

  const baseRoot = await g.baseRoot();
  const baseUrl  = await g.baseUrl();
  const amN = Number(await g.amendmentCount());
  const amendments = [];
  for (let i = 0; i < amN; i++) amendments.push(await g.amendmentAt(i));
  const pN = Number(await g.proposalCount());
  const proposals = [];
  for (let i = 0; i < pN; i++) {
    const p = await g.proposalAt(i);
    proposals.push({ id: i, ...p });
  }

  // Inline bigint serialization: amendmentAt/proposalAt views return uint64/uint32
  // fields that don't survive default JSON.stringify
  const payload = JSON.parse(
    JSON.stringify(
      { address: addr, baseRoot, baseUrl, amendments, proposals },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    ),
  );
  return NextResponse.json(payload);
}
