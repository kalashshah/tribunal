import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

const ABI = ["function vote(uint256 id, bool support)"];
const loadAddr = () => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../docs/deployment.json"), "utf8")).RuleBookGovernor;

export async function POST(req: Request) {
  const { id, support } = await req.json() as { id: number; support: boolean };
  const wallet = new ethers.Wallet(process.env.WEB_VOTER_PK ?? process.env.WEB_OPERATOR_PK!,
    new ethers.JsonRpcProvider(process.env.WEB_RPC_URL ?? "http://127.0.0.1:8545"));
  const g = new ethers.Contract(loadAddr(), ABI, wallet);
  const tx = await g.vote(id, support);
  const rc = await tx.wait();
  return NextResponse.json({ txHash: rc?.hash });
}
