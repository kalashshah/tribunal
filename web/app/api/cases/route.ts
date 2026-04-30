// web/app/api/cases/route.ts
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

import { createEnsCache } from "../../../lib/ens-cache";
import { createEnsResolver } from "../../../lib/ens-resolver";
import { makeSepoliaAdapter } from "../../../lib/ens-sepolia";

export const runtime = "nodejs";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

interface ContractAddresses {
  AgentRegistry: string;
  TribunalCore: string;
}

function loadAddresses(): ContractAddresses | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
    if (!c?.AgentRegistry || !c?.TribunalCore) return null;
    return { AgentRegistry: c.AgentRegistry, TribunalCore: c.TribunalCore };
  } catch { return null; }
}

const TRIBUNAL_ABI = [
  "function fileCase(address defendant, address escrowAdapter, uint256 escrowId, string accusationCid) payable returns (uint256)",
  "function BASE_FEE() view returns (uint256)",
  "event CaseFiled(uint256 indexed caseId, address indexed accuser, address indexed defendant, address escrowAdapter, uint256 escrowId, string accusationCid, uint256 fee)",
];

export async function POST(req: Request) {
  const body = (await req.json()) as { rawTx?: string };
  if (!body.rawTx || !body.rawTx.startsWith("0x")) {
    return NextResponse.json({ error: "rawTx (hex) required" }, { status: 400 });
  }

  const addr = loadAddresses();
  if (!addr) return NextResponse.json({ error: "deployment not found" }, { status: 503 });

  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });

  // Decode the raw tx and validate it targets TribunalCore.fileCase.
  let parsed: ethers.Transaction;
  try {
    parsed = ethers.Transaction.from(body.rawTx);
  } catch (e: any) {
    return NextResponse.json({ error: `bad rawTx: ${e.message}` }, { status: 400 });
  }
  if (!parsed.to || parsed.to.toLowerCase() !== addr.TribunalCore.toLowerCase()) {
    return NextResponse.json({ error: "tx target is not TribunalCore" }, { status: 400 });
  }
  const iface = new ethers.Interface(TRIBUNAL_ABI);
  let decoded;
  try { decoded = iface.parseTransaction({ data: parsed.data, value: parsed.value }); }
  catch { return NextResponse.json({ error: "tx data is not fileCase(...)" }, { status: 400 }); }
  if (decoded?.name !== "fileCase") {
    return NextResponse.json({ error: "selector is not fileCase" }, { status: 400 });
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tribunal = new ethers.Contract(addr.TribunalCore, TRIBUNAL_ABI, provider);
  const baseFee  = (await tribunal.BASE_FEE()) as bigint;
  if (parsed.value < baseFee) {
    return NextResponse.json({ error: `value below BASE_FEE ${baseFee}` }, { status: 400 });
  }

  // Broadcast.
  let receipt: ethers.TransactionReceipt | null;
  try {
    const sent = await provider.broadcastTransaction(body.rawTx);
    receipt = await sent.wait();
  } catch (e: any) {
    return NextResponse.json({ error: `broadcast failed: ${e.message}` }, { status: 500 });
  }
  if (!receipt) return NextResponse.json({ error: "no receipt" }, { status: 500 });

  // Parse CaseFiled event.
  const event = receipt.logs
    .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "CaseFiled");
  if (!event) return NextResponse.json({ error: "CaseFiled event missing" }, { status: 500 });
  const caseId = (event.args.caseId as bigint).toString();
  const defendant = event.args.defendant as string;

  // Best-effort: ensure the defendant has an ENS name.
  try {
    const sepoliaRpc = process.env.SEPOLIA_RPC_URL;
    const sepoliaKey = process.env.SEPOLIA_PARENT_PRIVATE_KEY as `0x${string}` | undefined;
    if (sepoliaRpc && sepoliaKey) {
      const cache = createEnsCache(path.resolve(process.cwd(), "var/ens-cache.json"));
      const sep = makeSepoliaAdapter({
        rpcUrl: sepoliaRpc, privateKey: sepoliaKey,
        parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
        registryInteropAddress: `eip155:16602:${addr.AgentRegistry}`,
      });
      const resolver = createEnsResolver({
        cache, isClaimed: sep.isClaimed, publish: sep.publish,
        parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
      });
      await resolver.ensure(defendant, "litigant");
    }
  } catch (e) {
    console.warn("[api/cases] defendant ENS publish failed (non-fatal):", e);
  }

  const explorerBase = process.env.OG_EXPLORER_BASE ?? "https://chainscan-galileo.0g.ai";
  return NextResponse.json({
    caseId,
    txHash: receipt.hash,
    explorerUrl: `${explorerBase}/tx/${receipt.hash}`,
  });
}
