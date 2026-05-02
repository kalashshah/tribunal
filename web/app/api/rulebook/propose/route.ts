import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { namehash } from "viem";
import { RULEBOOK_RPC_URL, GOVERNOR_ADDR } from "../../../../lib/rulebook-config";

// Propose a new article for the rulebook. Caller supplies:
//   { title, articleId, chapter }
// We compute the canonical ENS namehash from articleId
// (chapter-X-Y.rulebook.tribunal.eth) and submit it on-chain. The ENS
// subname must already exist on Sepolia with at least a `description`
// text record — voters should verify before voting yes.

const ABI = [
  "function propose(string title, string articleId, bytes32 ensNode, string chapter) returns (uint256)",
];

function ensNameFor(articleId: string): string {
  return `chapter-${articleId.replace(/\./g, "-")}.rulebook.tribunal.eth`;
}

export async function POST(req: Request) {
  const { title, articleId, chapter } = (await req.json()) as {
    title: string; articleId: string; chapter: string;
  };
  if (!title || !articleId || !chapter) {
    return NextResponse.json({ error: "missing title, articleId, or chapter" }, { status: 400 });
  }
  if (!/^\d+(\.\d+)*$/.test(articleId)) {
    return NextResponse.json({ error: "articleId must be dotted digits, e.g. 9.1.5" }, { status: 400 });
  }
  if (!GOVERNOR_ADDR || /^0x0+$/i.test(GOVERNOR_ADDR)) {
    return NextResponse.json({ error: "Governor address not configured for 0G Galileo" }, { status: 500 });
  }

  const ensName = ensNameFor(articleId);
  const ensNode = namehash(ensName);

  const pk = process.env.WEB_OPERATOR_PK;
  if (!pk) {
    return NextResponse.json({ error: "WEB_OPERATOR_PK not set (need a 0G-funded key to submit)" }, { status: 500 });
  }
  const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(RULEBOOK_RPC_URL));
  const g = new ethers.Contract(GOVERNOR_ADDR, ABI, wallet);
  const tx = await g.propose(title, articleId, ensNode, chapter);
  const rc = await tx.wait();
  return NextResponse.json({ txHash: rc?.hash, articleId, ensName, ensNode, chapter });
}
