import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

const GOVERNOR_ABI = [
  "function ruleBook() view returns (address)",
  "function quorum() view returns (uint32)",
  "function proposalCount() view returns (uint256)",
  "function proposalAt(uint256) view returns (tuple(address proposer,string title,string articleId,bytes32 ensNode,string chapter,uint32 yes,uint32 no,bool executed))",
];

const RULEBOOK_ABI = [
  "function articleCount() view returns (uint256)",
];

interface Deployment { RuleBook?: string; RuleBookGovernor?: string }

function loadDeployment(): Deployment {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

export async function GET() {
  const dep = loadDeployment();
  if (!dep.RuleBookGovernor || !dep.RuleBook) {
    return NextResponse.json({ error: "RuleBook / Governor address missing — re-run deploy" }, { status: 500 });
  }
  const rpc = process.env.WEB_RPC_URL ?? "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpc);
  const g  = new ethers.Contract(dep.RuleBookGovernor, GOVERNOR_ABI, provider);
  const rb = new ethers.Contract(dep.RuleBook, RULEBOOK_ABI, provider);

  const quorum = Number(await g.quorum());
  const articleCount = Number(await rb.articleCount());
  const pN = Number(await g.proposalCount());
  const proposals = [];
  for (let i = 0; i < pN; i++) {
    const p = await g.proposalAt(i);
    proposals.push({ id: i, ...p });
  }

  // bigint → string for JSON
  const payload = JSON.parse(
    JSON.stringify(
      {
        governor: dep.RuleBookGovernor,
        ruleBook: dep.RuleBook,
        quorum,
        articleCount,
        proposals,
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    ),
  );
  return NextResponse.json(payload);
}
