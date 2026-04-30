import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

export const runtime = "nodejs";

const abi = [
  "function nextId() view returns (uint256)",
  "function metadataUri(uint256) view returns (string)",
  "function rulingHistory(uint256) view returns (bytes32[])",
];

function loadDeployment(): { JudgeINFT: string } | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const addr =
      j?.chains?.ogGalileo?.contracts?.JudgeINFT ??
      j?.legacy?.JudgeINFT ??
      j?.JudgeINFT;
    if (!addr) return null;
    return { JudgeINFT: addr };
  } catch {
    return null;
  }
}

interface Persona { name: string; persona: string }

function parsePersona(uri: string, fallbackId: number): Persona {
  if (uri.startsWith("data:application/json,")) {
    try {
      return JSON.parse(decodeURIComponent(uri.replace(/^data:application\/json,/, "")));
    } catch { /* fall through */ }
  }
  return { name: `judge#${fallbackId}`, persona: "" };
}

export async function GET() {
  const dep = loadDeployment();
  if (!dep) return NextResponse.json([], { status: 503 });

  const provider = new ethers.JsonRpcProvider(process.env.OG_RPC_URL ?? "http://127.0.0.1:8545");
  const j = new ethers.Contract(dep.JudgeINFT, abi, provider);
  try {
    const next = Number(await j.nextId());
    const out: any[] = [];
    for (let i = 1; i < next; i++) {
      const uri = await j.metadataUri(i);
      const persona = parsePersona(uri, i);
      const rulings = (await j.rulingHistory(i)) as string[];
      out.push({ tokenId: i, ...persona, rulingCount: rulings.length });
    }
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
