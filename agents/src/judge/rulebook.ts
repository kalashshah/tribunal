import type { TocEntry, Article } from "./deliberate-loop.js";

/// Reader interface over `RuleBook.sol`. Bound at runtime to an
/// ethers.Contract pointed at the deployed registry on 0G Galileo.
export interface RuleBookReader {
  articleCount(): Promise<bigint>;
  articleAt(i: number | bigint): Promise<{
    articleId: string;
    ensNode: string;
    chapter: string;
    addedAt: bigint;
  }>;
}

/// Resolves an ENS name's namehash to its `description` + `tribunal.title`
/// text records on Sepolia. Pluggable so tests can mock without a network.
export interface EnsResolver {
  resolveText(ensNode: `0x${string}`, key: string): Promise<string | null>;
}

export interface Rulebook {
  toc: TocEntry[];
  byId: Map<string, Article>;
  /// Side-table linking each article id to its ENS namehash. Useful for
  /// the deliberation loop when the LLM cites by ENS name.
  ensByArticleId: Map<string, `0x${string}`>;
}

export interface LoadOpts {
  ruleBook: RuleBookReader;
  ens: EnsResolver;
  /// Optional concurrency cap for ENS resolution. Sepolia public RPCs
  /// don't love bursts. Default 6.
  ensConcurrency?: number;
  /// Called with `(articleId, reason)` when an article cannot be loaded
  /// from ENS (missing description, RPC error). Defaults to console.warn.
  onSkip?: (articleId: string, reason: string) => void;
}

async function mapWithConcurrency<T, U>(
  items: T[],
  fn: (item: T) => Promise<U>,
  concurrency: number,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker);
  await Promise.all(workers);
  return out;
}

export async function loadRulebook({ ruleBook, ens, ensConcurrency = 6, onSkip }: LoadOpts): Promise<Rulebook> {
  const skip = onSkip ?? ((id, why) => console.warn(`[rulebook] skipped ${id}: ${why}`));
  const n = Number(await ruleBook.articleCount());

  const entries: { articleId: string; ensNode: `0x${string}`; chapter: string }[] = [];
  for (let i = 0; i < n; i++) {
    const e = await ruleBook.articleAt(i);
    entries.push({
      articleId: e.articleId,
      ensNode: e.ensNode as `0x${string}`,
      chapter: e.chapter,
    });
  }

  const resolved = await mapWithConcurrency(
    entries,
    async (e) => {
      try {
        const [body, title] = await Promise.all([
          ens.resolveText(e.ensNode, "description"),
          ens.resolveText(e.ensNode, "tribunal.title"),
        ]);
        if (!body) {
          skip(e.articleId, `description text record missing on ENS`);
          return null;
        }
        return {
          article: { id: e.articleId, title: title ?? e.articleId, body } as Article,
          ensNode: e.ensNode,
        };
      } catch (err) {
        skip(e.articleId, `ENS resolve failed: ${(err as Error).message}`);
        return null;
      }
    },
    ensConcurrency,
  );

  const byId = new Map<string, Article>();
  const ensByArticleId = new Map<string, `0x${string}`>();
  for (const r of resolved) {
    if (!r) continue;
    byId.set(r.article.id, r.article);
    ensByArticleId.set(r.article.id, r.ensNode);
  }
  const toc: TocEntry[] = [...byId.values()].map((a) => ({ id: a.id, title: a.title }));
  return { toc, byId, ensByArticleId };
}
