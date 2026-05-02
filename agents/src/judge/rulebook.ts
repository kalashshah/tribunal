import type { ZgStorage } from "../storage/og-storage.js";
import type { TocEntry, Article } from "./deliberate-loop.js";

export interface GovernorReader {
  baseRoot(): Promise<string>;
  amendmentCount(): Promise<bigint>;
  amendmentAt(i: number | bigint): Promise<{ cidRoot: string; cidUrl: string; title: string; appliedAt: bigint }>;
}

export interface Rulebook {
  toc: TocEntry[];
  byId: Map<string, Article>;
}

export interface LoadOpts { governor: GovernorReader; storage: ZgStorage }

interface RulebookFile {
  articles: Article[];
}

async function fetchJson(storage: ZgStorage, root: string): Promise<RulebookFile> {
  const bytes = await storage.download(root as `0x${string}`);
  return JSON.parse(new TextDecoder().decode(bytes)) as RulebookFile;
}

export async function loadRulebook({ governor, storage }: LoadOpts): Promise<Rulebook> {
  const baseRoot = await governor.baseRoot();
  const base = await fetchJson(storage, baseRoot);
  const articles: Article[] = [...base.articles];

  const n = Number(await governor.amendmentCount());
  for (let i = 0; i < n; i++) {
    const am = await governor.amendmentAt(i);
    const file = await fetchJson(storage, am.cidRoot);
    for (const a of file.articles) articles.push(a);
  }

  const byId = new Map<string, Article>();
  for (const a of articles) byId.set(a.id, a);
  const toc: TocEntry[] = articles.map((a) => ({ id: a.id, title: a.title }));
  return { toc, byId };
}
