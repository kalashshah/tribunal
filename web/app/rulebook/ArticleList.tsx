"use client";
import { useEffect, useState } from "react";

interface Article {
  id: string;
  title: string;
  body: string;
  ensName: string;
  ensNode: string;
  chapter: string;
  resolved: boolean;
  reason?: string;
}

interface Articles {
  ruleBook: string;
  articleCount: number;
  resolvedCount: number;
  articles: Article[];
  cached: boolean;
}

const ENS_APP = "https://sepolia.app.ens.domains";

export function ArticleList() {
  const [d, setD] = useState<Articles | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/rulebook/articles").then((r) => r.json()).then(setD);
  }, []);

  if (!d) return <p className="text-sm">Loading rulebook (resolving ENS records on Sepolia)…</p>;
  if (!d.articles?.length) {
    return (
      <p className="text-sm opacity-70">
        Registry is empty. Run the seed script (<code>contracts/scripts/seed-rulebook.ts</code>)
        to publish ENS subnames and add articles.
      </p>
    );
  }

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
  }

  return (
    <div>
      <p className="text-sm">
        {d.articleCount} on-chain · <strong>{d.resolvedCount}</strong> resolved from ENS
        {d.resolvedCount === d.articleCount ? (
          <> · <span title="all namehashes resolved a description text record">✓ <em>fully resolved</em></span></>
        ) : (
          <> · <span style={{ color: "#c00" }}>✗ {d.articleCount - d.resolvedCount} unresolved</span></>
        )}
        {d.cached && <> · <em className="opacity-60">cached</em></>}
      </p>
      <table className="w-full mt-3 text-sm">
        <thead>
          <tr className="text-left">
            <th className="pr-4 py-1">Art.</th>
            <th className="pr-4 py-1">Title</th>
            <th className="pr-4 py-1">ENS name</th>
            <th className="py-1"></th>
          </tr>
        </thead>
        <tbody>
          {d.articles.map((a) => (
            <Row key={a.id} a={a} isOpen={open.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ a, isOpen, onToggle }: { a: Article; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: "var(--rule, #ddd)" }}>
        <td className="pr-4 py-1 align-top"><code>{a.id}</code></td>
        <td className="pr-4 py-1 align-top">
          {a.title}
          {!a.resolved && (
            <span title={a.reason} className="ml-2" style={{ color: "#c00", fontSize: "0.85em" }}>
              ⚠ unresolved
            </span>
          )}
        </td>
        <td className="pr-4 py-1 align-top">
          <a
            href={`${ENS_APP}/${a.ensName}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
            style={{ fontFamily: "monospace", fontSize: "0.85em" }}
          >
            {a.ensName}
          </a>
        </td>
        <td className="py-1 align-top">
          <button onClick={onToggle} className="text-xs underline opacity-70" disabled={!a.resolved}>
            {isOpen ? "hide" : "read"}
          </button>
        </td>
      </tr>
      {isOpen && a.resolved && (
        <tr>
          <td colSpan={4} className="pb-3 pl-4 pr-4 text-sm opacity-80">
            {a.body}
          </td>
        </tr>
      )}
    </>
  );
}
