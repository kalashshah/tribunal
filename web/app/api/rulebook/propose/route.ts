import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

const ABI = ["function propose(string title, bytes32 cidRoot, string cidUrl) returns (uint256)"];

function loadAddr(): string {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).RuleBookGovernor;
}

export async function POST(req: Request) {
  const { title, articles } = await req.json() as { title: string; articles: { id: string; title: string; body: string }[] };
  if (!title || !Array.isArray(articles) || articles.length === 0) {
    return NextResponse.json({ error: "missing title or articles" }, { status: 400 });
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ articles }));
  const cidRoot = ethers.keccak256(bytes);
  const cidUrl  = `memory:amend-${cidRoot.slice(2, 10)}`;
  // NOTE: in 0G mode, swap the line above for an Indexer.upload call. The
  // memory path keeps the demo working on local Hardhat without 0G infra.

  const rpc  = process.env.WEB_RPC_URL  ?? "http://127.0.0.1:8545";
  const pk   = process.env.WEB_OPERATOR_PK!;
  const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpc));
  const g = new ethers.Contract(loadAddr(), ABI, wallet);
  const tx = await g.propose(title, cidRoot, cidUrl);
  const rc = await tx.wait();
  return NextResponse.json({ txHash: rc?.hash, cidRoot, cidUrl });
}
