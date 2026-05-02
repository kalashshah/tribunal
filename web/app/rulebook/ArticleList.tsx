"use client";
import { useEffect, useState } from "react";

interface Article {
  id: string;
  title: string;
  body: string;
  ensName: string;
  chapter: string;
}

interface Articles {
  governor: string;
  baseRoot: string;
  baseUrl: string;
  blobUrl: string;
  verified: boolean;
  localHash: string;
  articleCount: number;
  articles: Article[];
}

const ENS_APP = "https://sepolia.app.ens.domains";

export function ArticleList() {
  const [d, setD] = useState<Articles | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/rulebook/articles").then((r) => r.json()).then(setD);
  }, []);

  if (!d) return <p className="text-sm">Loading rulebook…</p>;
  if (!d.articles?.length) return <p className="text-sm">No articles loaded.</p>;

  function toggle(id: string) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
  }

  return (
    <div>
      <p className="text-sm">
        {d.articleCount} articles •{" "}
        {d.verified ? (
          <span title={`local keccak: ${d.localHash}`}>
            ✓ <em>verified against on-chain root</em>
          </span>
        ) : (
          <span style={{ color: "var(--rule-fail, #c00)" }}>
            ✗ rulebook bytes do not match the on-chain baseRoot
          </span>
        )}{" "}
        •{" "}
        <a href={d.blobUrl} target="_blank" rel="noreferrer" className="underline">
          rulebook blob
        </a>
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
            <Row key={a.id} a={a} blobUrl={d.blobUrl} isOpen={open.has(a.id)} onToggle={() => toggle(a.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  a, blobUrl, isOpen, onToggle,
}: {
  a: Article; blobUrl: string; isOpen: boolean; onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: "var(--rule, #ddd)" }}>
        <td className="pr-4 py-1 align-top"><code>{a.id}</code></td>
        <td className="pr-4 py-1 align-top">{a.title}</td>
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
          <button onClick={onToggle} className="text-xs underline opacity-70">
            {isOpen ? "hide" : "read"}
          </button>{" "}
          •{" "}
          <a
            href={blobUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline opacity-70"
          >
            blob
          </a>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={4} className="pb-3 pl-4 pr-4 text-sm opacity-80">
            {a.body}
          </td>
        </tr>
      )}
    </>
  );
}
