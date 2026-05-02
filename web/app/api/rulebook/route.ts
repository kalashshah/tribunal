import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { RULEBOOK_RPC_URL, RULEBOOK_ADDR, GOVERNOR_ADDR } from "../../../lib/rulebook-config";

const GOVERNOR_ABI = [
  "function ruleBook() view returns (address)",
  "function quorum() view returns (uint32)",
  "function proposalCount() view returns (uint256)",
  "function proposalAt(uint256) view returns (tuple(address proposer,string title,string articleId,bytes32 ensNode,string chapter,uint32 yes,uint32 no,bool executed))",
];

const RULEBOOK_ABI = [
  "function articleCount() view returns (uint256)",
];

export async function GET() {
  if (!GOVERNOR_ADDR || !RULEBOOK_ADDR || /^0x0+$/i.test(GOVERNOR_ADDR)) {
    return NextResponse.json({ error: "RuleBook / Governor address not configured for 0G Galileo" }, { status: 500 });
  }
  const provider = new ethers.JsonRpcProvider(RULEBOOK_RPC_URL);
  const g  = new ethers.Contract(GOVERNOR_ADDR, GOVERNOR_ABI, provider);
  const rb = new ethers.Contract(RULEBOOK_ADDR, RULEBOOK_ABI, provider);

  const quorum = Number(await g.quorum());
  const articleCount = Number(await rb.articleCount());
  const pN = Number(await g.proposalCount());
  const proposals = [];
  for (let i = 0; i < pN; i++) {
    const p = await g.proposalAt(i);
    proposals.push({ id: i, ...p });
  }

  const payload = JSON.parse(
    JSON.stringify(
      {
        governor: GOVERNOR_ADDR,
        ruleBook: RULEBOOK_ADDR,
        quorum,
        articleCount,
        proposals,
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    ),
  );
  return NextResponse.json(payload);
}
