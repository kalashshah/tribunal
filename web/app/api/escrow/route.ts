// web/app/api/escrow/route.ts
// Read-only listing of TribunalEscrow agreements.

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

export const runtime = "nodejs";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const ESCROW_ABI = [
  "function nextId() view returns (uint256)",
  "function getAgreement(uint256) view returns (address payer, address payee, address proposer, uint256 amount, uint64 deadline, uint64 claimedAt, uint8 status, string termsCid)",
];

const STATUS_NAMES = [
  "Proposed", "Accepted", "Funded", "Claimed",
  "Released", "Disputed", "Settled", "Revoked",
] as const;

function loadEscrowAddress(): string | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return (
      j?.chains?.ogGalileo?.contracts?.TribunalEscrow ??
      j?.legacy?.TribunalEscrow ??
      j?.TribunalEscrow ??
      null
    );
  } catch {
    return null;
  }
}

function decodeTerms(cid: string): string {
  const prefix = "data:text/plain;base64,";
  if (cid.startsWith(prefix)) {
    try { return Buffer.from(cid.slice(prefix.length), "base64").toString("utf8"); }
    catch { return cid; }
  }
  return cid;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const party = url.searchParams.get("party")?.toLowerCase();
  const statusParam = url.searchParams.get("status");

  const addr = loadEscrowAddress();
  if (!addr) return NextResponse.json({ error: "TribunalEscrow not in deployment" }, { status: 503 });

  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const escrow = new ethers.Contract(addr, ESCROW_ABI, provider);

  const next = (await escrow.nextId()) as bigint;
  const ids: bigint[] = [];
  for (let i = 1n; i < next; i++) ids.push(i);

  const out: Array<Record<string, any>> = [];
  await Promise.all(ids.map(async (id) => {
    const a = await escrow.getAgreement(id);
    const status = Number(a[6]);
    if (statusParam !== null && statusParam !== undefined && status !== Number(statusParam)) return;
    const payer = (a[0] as string).toLowerCase();
    const payee = (a[1] as string).toLowerCase();
    if (party && party !== payer && party !== payee) return;
    out.push({
      id: id.toString(),
      payer: a[0],
      payee: a[1],
      proposer: a[2],
      amount: (a[3] as bigint).toString(),
      deadline: Number(a[4]),
      claimedAt: Number(a[5]),
      status,
      statusName: STATUS_NAMES[status] ?? `Unknown(${status})`,
      termsPreview: decodeTerms(a[7] as string).slice(0, 200),
    });
  }));
  out.sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
  return NextResponse.json({ escrowAddress: addr, agreements: out });
}
