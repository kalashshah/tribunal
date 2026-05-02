// web/app/api/identity/resolve/route.ts
//
// Registry-based ENS resolution on Sepolia. No on-disk cache.
//
// 1. address → name: try ENS reverse resolution (`addr.reverse` namespace via
//    the registry), as documented at https://docs.ens.domains/web/reverse.
//    If no reverse record is set, fall back to enumerating the deterministic
//    candidate labels this app uses (see lib/wordlist.ts) and forward-verify
//    against the `agent.pubkey` text record (which the publish flow writes to
//    the agent's address — see agents/src/identity/ens.ts:agentEnsRecord).
// 2. name → address: read the `agent.pubkey` text record (the publish flow
//    does not set the canonical `addr()` record).
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { deriveCandidate } from "../../../../lib/wordlist";

export const runtime = "nodejs";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const MAX_CANDIDATE_ATTEMPTS = 8;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const addr = url.searchParams.get("address");
  const name = url.searchParams.get("name");
  if (!addr && !name) {
    return NextResponse.json({ error: "address or name required" }, { status: 400 });
  }
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: "SEPOLIA_RPC_URL not configured" }, { status: 500 });
  }
  const parent = process.env.ENS_PARENT_NAME ?? "tribunal.eth";
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  if (addr) {
    if (!ADDR_RE.test(addr)) {
      return NextResponse.json({ address: addr.toLowerCase(), ensName: null });
    }
    const lower = addr.toLowerCase() as `0x${string}`;

    let ensName: string | null = null;
    try {
      ensName = (await client.getEnsName({ address: lower })) ?? null;
    } catch {}

    if (!ensName) {
      for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS; attempt++) {
        const candidate = `${deriveCandidate(lower, attempt)}.${parent}`;
        try {
          const pubkey = await client.getEnsText({ name: candidate, key: "agent.pubkey" });
          if (pubkey && pubkey.toLowerCase() === lower) {
            ensName = candidate;
            break;
          }
        } catch {}
      }
    }
    return NextResponse.json({ address: lower, ensName });
  }

  try {
    const pubkey = await client.getEnsText({ name: name!, key: "agent.pubkey" });
    return NextResponse.json({ address: pubkey?.toLowerCase() ?? null, ensName: name });
  } catch {
    return NextResponse.json({ address: null, ensName: name });
  }
}
