import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { namehash } from "viem";
import * as fs from "node:fs";
import * as path from "node:path";

// Propose a new article for the rulebook. Caller supplies:
//   { title, articleId, chapter }
// We compute the canonical ENS namehash from articleId
// (chapter-X-Y.rulebook.tribunal.eth) and submit it on-chain. The ENS
// subname must already exist on Sepolia with at least a `description`
// text record — voters should verify before voting yes.

const ABI = [
  "function propose(string title, string articleId, bytes32 ensNode, string chapter) returns (uint256)",
];

function loadAddr(): string {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).RuleBookGovernor;
}

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

  const ensName = ensNameFor(articleId);
  const ensNode = namehash(ensName);

  const rpc  = process.env.WEB_RPC_URL  ?? "http://127.0.0.1:8545";
  const pk   = process.env.WEB_OPERATOR_PK!;
  const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpc));
  const g = new ethers.Contract(loadAddr(), ABI, wallet);
  const tx = await g.propose(title, articleId, ensNode, chapter);
  const rc = await tx.wait();
  return NextResponse.json({ txHash: rc?.hash, articleId, ensName, ensNode, chapter });
}
