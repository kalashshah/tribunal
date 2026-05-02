import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

// Reads the RuleBook registry on 0G + resolves each article's ENS namehash
// on Sepolia to fetch its description (body) and tribunal.title (title)
// text records. Articles are the source of truth: the registry says
// which namehashes are canonical, and ENS supplies the content.

const RULEBOOK_ABI = [
  "function articleCount() view returns (uint256)",
  "function articleAt(uint256) view returns (tuple(string articleId,bytes32 ensNode,string chapter,uint64 addedAt))",
];

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const ENS_REGISTRY_ABI = [
  "function resolver(bytes32 node) view returns (address)",
];
const RESOLVER_ABI = [
  "function text(bytes32 node, string key) view returns (string)",
];

interface Deployment { RuleBook?: string }

function loadDeployment(): Deployment {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function ensNameFor(articleId: string): string {
  return `chapter-${articleId.replace(/\./g, "-")}.rulebook.tribunal.eth`;
}

// 5-minute server-side cache for resolved articles (and their resolvers).
// ENS records change rarely; recomputing on every page load is wasteful.
let cache: { at: number; data: any } | null = null;
const CACHE_TTL = 5 * 60_000;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json({ ...cache.data, cached: true });
  }
  const dep = loadDeployment();
  if (!dep.RuleBook) {
    return NextResponse.json({ error: "RuleBook address missing — re-run deploy" }, { status: 500 });
  }
  const ogRpc = process.env.WEB_RPC_URL ?? "http://127.0.0.1:8545";
  const ensRpc = process.env.WEB_ENS_RPC_URL ?? process.env.ENS_RPC_URL;
  if (!ensRpc) {
    return NextResponse.json({ error: "WEB_ENS_RPC_URL (or ENS_RPC_URL) not set" }, { status: 500 });
  }

  const ogProvider = new ethers.JsonRpcProvider(ogRpc);
  const ensProvider = new ethers.JsonRpcProvider(ensRpc);
  const rb = new ethers.Contract(dep.RuleBook, RULEBOOK_ABI, ogProvider);

  const n = Number(await rb.articleCount());
  const entries: { articleId: string; ensNode: string; chapter: string }[] = [];
  for (let i = 0; i < n; i++) {
    const e = await rb.articleAt(i);
    entries.push({ articleId: e.articleId, ensNode: e.ensNode, chapter: e.chapter });
  }

  // Resolve text records on Sepolia. Cache resolver per ENS node.
  const ensRegistry = new ethers.Contract(ENS_REGISTRY, ENS_REGISTRY_ABI, ensProvider);
  const resolverByNode = new Map<string, string>();

  async function getResolver(node: string): Promise<string | null> {
    const cached = resolverByNode.get(node);
    if (cached) return cached;
    const r = (await ensRegistry.resolver(node)) as string;
    if (r === "0x0000000000000000000000000000000000000000") return null;
    resolverByNode.set(node, r);
    return r;
  }
  async function readText(node: string, key: string): Promise<string | null> {
    const r = await getResolver(node);
    if (!r) return null;
    const resolver = new ethers.Contract(r, RESOLVER_ABI, ensProvider);
    const v = (await resolver.text(node, key)) as string;
    return v === "" ? null : v;
  }

  const articles = await Promise.all(entries.map(async (e) => {
    let body: string | null = null;
    let title: string | null = null;
    let resolved = true;
    let reason: string | undefined;
    try {
      [body, title] = await Promise.all([
        readText(e.ensNode, "description"),
        readText(e.ensNode, "tribunal.title"),
      ]);
      if (!body) { resolved = false; reason = "no description text record"; }
    } catch (err) {
      resolved = false;
      reason = (err as Error).message;
    }
    return {
      id: e.articleId,
      title: title ?? e.articleId,
      body: body ?? "",
      ensName: ensNameFor(e.articleId),
      ensNode: e.ensNode,
      chapter: e.chapter,
      resolved,
      ...(reason ? { reason } : {}),
    };
  }));

  const data = {
    ruleBook: dep.RuleBook,
    articleCount: n,
    resolvedCount: articles.filter((a) => a.resolved).length,
    articles,
    cached: false,
  };
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
