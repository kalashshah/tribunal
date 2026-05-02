"use client";
import { useState } from "react";

export function ProposalRow({ p, onDone }: { p: { id: number; title: string; yes: number; no: number; executed: boolean }; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function call(path: string, support?: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/rulebook/${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: p.id, support }),
      });
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <div className="border p-2 my-2 flex items-center justify-between">
      <div>
        <div className="font-medium">#{p.id} {p.title}</div>
        <div className="text-sm opacity-70">yes {p.yes} · no {p.no} {p.executed ? "· executed" : ""}</div>
      </div>
      <div className="flex gap-2">
        <button disabled={busy || p.executed} className="border px-2" onClick={() => call("vote", true)}>Yes</button>
        <button disabled={busy || p.executed} className="border px-2" onClick={() => call("vote", false)}>No</button>
        <button disabled={busy || p.executed || p.yes < 2} className="border px-2" onClick={() => call("execute")}>Execute</button>
      </div>
    </div>
  );
}
