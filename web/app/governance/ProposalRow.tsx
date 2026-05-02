"use client";
import { useState } from "react";

interface Proposal {
  id: number;
  title: string;
  articleId: string;
  ensNode: string;
  chapter: string;
  yes: number;
  no: number;
  executed: boolean;
}

const ENS_APP = "https://sepolia.app.ens.domains";

function ensNameFor(articleId: string): string {
  return `chapter-${articleId.replace(/\./g, "-")}.rulebook.tribunal.eth`;
}

export function ProposalRow({
  p, quorum, onDone,
}: {
  p: Proposal; quorum: number; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function call(pathname: string, support?: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/rulebook/${pathname}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.id, support }),
      });
      onDone();
    } finally { setBusy(false); }
  }
  const ensName = ensNameFor(p.articleId);
  return (
    <div className="border p-2 my-2 flex items-center justify-between">
      <div>
        <div className="font-medium">#{p.id} {p.title}</div>
        <div className="text-sm opacity-70">
          Article <code>{p.articleId}</code> (ch. {p.chapter}) ·{" "}
          <a href={`${ENS_APP}/${ensName}`} target="_blank" rel="noreferrer" className="underline">
            <code>{ensName}</code>
          </a>
        </div>
        <div className="text-sm opacity-70">
          yes {p.yes} · no {p.no} {p.executed ? "· executed" : ""}
        </div>
      </div>
      <div className="flex gap-2">
        <button disabled={busy || p.executed} className="border px-2" onClick={() => call("vote", true)}>Yes</button>
        <button disabled={busy || p.executed} className="border px-2" onClick={() => call("vote", false)}>No</button>
        <button
          disabled={busy || p.executed || p.yes < quorum}
          className="border px-2"
          onClick={() => call("execute")}
        >
          Execute
        </button>
      </div>
    </div>
  );
}
