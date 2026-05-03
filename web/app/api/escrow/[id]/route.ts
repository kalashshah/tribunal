// web/app/api/escrow/[id]/route.ts
// Single agreement: full terms + event timeline.

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

export const runtime = "nodejs";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const ESCROW_ABI = [
  "function getAgreement(uint256) view returns (address payer, address payee, address proposer, uint256 amount, uint64 deadline, uint64 claimedAt, uint8 status, string termsCid)",
  "event AgreementProposed(uint256 indexed id, address indexed proposer, address indexed payer, address payee, uint256 amount, uint64 deadline, string termsCid)",
  "event AgreementAccepted(uint256 indexed id, address indexed acceptedBy)",
  "event AgreementRevoked(uint256 indexed id)",
  "event AgreementFunded(uint256 indexed id, address indexed payer, uint256 amount)",
  "event AgreementReleased(uint256 indexed id, address indexed payee, uint256 amount, string reason)",
  "event AgreementClaimed(uint256 indexed id, address indexed payee, uint64 claimedAt)",
  "event AgreementDisputed(uint256 indexed id)",
  "event AgreementSettled(uint256 indexed id, uint256 indexed caseId, address indexed recipient, uint256 amount, bool prevailing)",
];

const TRIBUNAL_ABI = [
  "event CaseFiled(uint256 indexed caseId, address indexed accuser, address indexed defendant, address escrowAdapter, uint256 escrowId, string accusationCid, uint256 fee)",
];

const STATUS_NAMES = [
  "Proposed", "Accepted", "Funded", "Claimed",
  "Released", "Disputed", "Settled", "Revoked",
] as const;

function loadAddrs(): { escrow: string | null; tribunal: string | null } {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
    return {
      escrow: c?.TribunalEscrow ?? null,
      tribunal: c?.TribunalCore ?? null,
    };
  } catch {
    return { escrow: null, tribunal: null };
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

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const { escrow: escrowAddr, tribunal: tribunalAddr } = loadAddrs();
  if (!escrowAddr) return NextResponse.json({ error: "TribunalEscrow not in deployment" }, { status: 503 });

  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });

  let id: bigint;
  try { id = BigInt(ctx.params.id); }
  catch { return NextResponse.json({ error: "bad id" }, { status: 400 }); }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const escrow = new ethers.Contract(escrowAddr, ESCROW_ABI, provider);

  let agreement;
  try {
    agreement = await escrow.getAgreement(id);
  } catch (e: any) {
    return NextResponse.json({ error: `agreement not found: ${e.message}` }, { status: 404 });
  }
  if (agreement[0] === ethers.ZeroAddress) {
    return NextResponse.json({ error: "agreement not found" }, { status: 404 });
  }

  const status = Number(agreement[6]);

  // Walk every event topic for this id. Each query is bounded to ~5000
  // recent blocks like the runner; 0G testnet doesn't archive deep history.
  const head = await provider.getBlockNumber();
  const fromBlock = Math.max(0, head - 50000);
  const eventNames = [
    "AgreementProposed", "AgreementAccepted", "AgreementRevoked",
    "AgreementFunded", "AgreementReleased", "AgreementClaimed",
    "AgreementDisputed", "AgreementSettled",
  ];
  type Timeline = { kind: string; blockNumber: number; txHash: string; args: Record<string, any> };
  const timeline: Timeline[] = [];
  for (const name of eventNames) {
    try {
      const filter = escrow.filters[name](id);
      const logs = await escrow.queryFilter(filter, fromBlock, head);
      for (const l of logs) {
        const parsed = (l as any).args;
        const args: Record<string, any> = {};
        if (parsed) {
          for (const [k, v] of Object.entries(parsed)) {
            if (!isNaN(Number(k))) continue;
            args[k] = typeof v === "bigint" ? v.toString() : v;
          }
        }
        timeline.push({
          kind: name,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          args,
        });
      }
    } catch {}
  }
  timeline.sort((a, b) => a.blockNumber - b.blockNumber);

  // Reverse-lookup the linked caseId (if any) by scanning CaseFiled events
  // where escrowAdapter == TribunalEscrow and escrowId == this id.
  let linkedCaseId: string | null = null;
  if (tribunalAddr) {
    try {
      const tribunal = new ethers.Contract(tribunalAddr, TRIBUNAL_ABI, provider);
      const filed = await tribunal.queryFilter(
        tribunal.filters.CaseFiled(),
        fromBlock,
        head,
      );
      for (const ev of filed) {
        const a = (ev as any).args;
        if (
          a &&
          (a.escrowAdapter as string).toLowerCase() === escrowAddr.toLowerCase() &&
          (a.escrowId as bigint).toString() === id.toString()
        ) {
          linkedCaseId = (a.caseId as bigint).toString();
          break;
        }
      }
    } catch {}
  }

  return NextResponse.json({
    id: id.toString(),
    escrowAddress: escrowAddr,
    payer: agreement[0],
    payee: agreement[1],
    proposer: agreement[2],
    amount: (agreement[3] as bigint).toString(),
    deadline: Number(agreement[4]),
    claimedAt: Number(agreement[5]),
    status,
    statusName: STATUS_NAMES[status] ?? `Unknown(${status})`,
    termsCid: agreement[7],
    terms: decodeTerms(agreement[7] as string),
    linkedCaseId,
    timeline,
  });
}
