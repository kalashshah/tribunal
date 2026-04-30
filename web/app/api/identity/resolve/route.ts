// web/app/api/identity/resolve/route.ts
import { NextResponse } from "next/server";
import * as path from "node:path";
import { createEnsCache } from "../../../../lib/ens-cache";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const addr = url.searchParams.get("address");
  const name = url.searchParams.get("name");
  if (!addr && !name) {
    return NextResponse.json({ error: "address or name required" }, { status: 400 });
  }
  const cache = createEnsCache(path.resolve(process.cwd(), "var/ens-cache.json"));

  if (addr) {
    const ensName = await cache.getName(addr);
    return NextResponse.json({ address: addr.toLowerCase(), ensName });
  }
  const resolved = await cache.getAddress(name!);
  return NextResponse.json({ address: resolved, ensName: name });
}
