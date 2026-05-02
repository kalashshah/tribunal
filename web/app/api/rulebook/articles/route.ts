import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

const ABI = [
  "function baseRoot() view returns (bytes32)",
  "function baseUrl() view returns (string)",
  "function amendmentCount() view returns (uint256)",
  "function amendmentAt(uint256) view returns (tuple(bytes32 cidRoot,string cidUrl,string title,uint64 appliedAt))",
];

interface Article { id: string; title: string; body: string }

function loadGovernor(): string | null {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")).RuleBookGovernor ?? null;
  } catch { return null; }
}

function loadSeedFile(): { bytes: Uint8Array; articles: Article[] } | null {
  const p = path.resolve(process.cwd(), "../agents/enclave/rulebook/unidroit-v1.json");
  try {
    const raw = fs.readFileSync(p);
    const parsed = JSON.parse(raw.toString("utf8")) as { articles: Article[] };
    return { bytes: new Uint8Array(raw), articles: parsed.articles };
  } catch { return null; }
}

/// chapter-1-7.rulebook.tribunal.eth — slug derived from article id.
function ensNameFor(articleId: string): string {
  const slug = `chapter-${articleId.replace(/\./g, "-")}`;
  return `${slug}.rulebook.tribunal.eth`;
}

/// Build the storagescan URL (0G) or a memory: pseudo-URL for local dev.
function blobUrl(baseRoot: string, baseUrl: string): string {
  if (baseUrl.startsWith("memory:")) return `memory:${baseRoot}`;
  if (baseUrl.startsWith("0g://")) return baseUrl;
  return baseUrl; // already a storagescan link or similar
}

export async function GET() {
  const governorAddr = loadGovernor();
  if (!governorAddr) {
    return NextResponse.json({ error: "no governor address" }, { status: 500 });
  }

  // Pull the on-chain anchor (baseRoot) so the page can claim "verified".
  let onchain: { baseRoot: string; baseUrl: string };
  try {
    const provider = new ethers.JsonRpcProvider(process.env.WEB_RPC_URL ?? "http://127.0.0.1:8545");
    const g = new ethers.Contract(governorAddr, ABI, provider);
    onchain = { baseRoot: await g.baseRoot(), baseUrl: await g.baseUrl() };
  } catch (e) {
    return NextResponse.json({ error: `chain read failed: ${(e as Error).message}` }, { status: 500 });
  }

  // Load the local seed file and verify its keccak256 matches the on-chain
  // baseRoot. This is the verifiability story: the bytes you're reading match
  // what governance anchored.
  const seed = loadSeedFile();
  if (!seed) {
    return NextResponse.json({
      ...onchain,
      verified: false,
      reason: "seed file not on disk; web cannot fetch from 0G in this build",
      articles: [],
    }, { status: 200 });
  }

  const localHash = ethers.keccak256(seed.bytes);
  const verified = localHash.toLowerCase() === onchain.baseRoot.toLowerCase();

  const articles = seed.articles.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    ensName: ensNameFor(a.id),
    chapter: a.id.split(".").slice(0, 2).join("."),
  }));

  return NextResponse.json({
    governor: governorAddr,
    baseRoot: onchain.baseRoot,
    baseUrl: onchain.baseUrl,
    blobUrl: blobUrl(onchain.baseRoot, onchain.baseUrl),
    verified,
    localHash,
    articleCount: articles.length,
    articles,
  });
}
