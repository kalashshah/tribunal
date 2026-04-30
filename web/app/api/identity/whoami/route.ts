// web/app/api/identity/whoami/route.ts
import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

import { verifyTribunalAuth } from "../../../../lib/siwe";
import { createEnsCache } from "../../../../lib/ens-cache";
import { createEnsResolver } from "../../../../lib/ens-resolver";
import { makeSepoliaAdapter } from "../../../../lib/ens-sepolia";

export const runtime = "nodejs";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

function deploymentInteropAddress(): string {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const reg = (j?.chains?.ogGalileo?.contracts?.AgentRegistry ?? j?.AgentRegistry) as string | undefined;
  if (!reg) throw new Error("AgentRegistry not in deployment.json");
  return `eip155:16602:${reg}`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as { address?: string; message?: string; signature?: string };
  if (!body.address || !body.message || !body.signature) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!verifyTribunalAuth(body as any)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const sepoliaRpc = process.env.SEPOLIA_RPC_URL;
  const sepoliaKey = process.env.SEPOLIA_PARENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!sepoliaRpc || !sepoliaKey) {
    return NextResponse.json({ error: "sepolia creds missing" }, { status: 503 });
  }

  const cache = createEnsCache(path.resolve(process.cwd(), "var/ens-cache.json"));
  const sep = makeSepoliaAdapter({
    rpcUrl: sepoliaRpc, privateKey: sepoliaKey,
    parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
    registryInteropAddress: deploymentInteropAddress(),
  });
  const resolver = createEnsResolver({
    cache, isClaimed: sep.isClaimed, publish: sep.publish,
    parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
  });

  try {
    const ensName = await resolver.ensure(body.address, "litigant");
    return NextResponse.json({ address: body.address.toLowerCase(), ensName });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
