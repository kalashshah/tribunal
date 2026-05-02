"use client";
import { useState } from "react";

export function ProposeForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody]   = useState('[\n  {"id":"9.1","title":"AML compliance","body":"follow AML"}\n]');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const articles = JSON.parse(body);
      const r = await fetch("/api/rulebook/propose", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, articles }),
      });
      if (!r.ok) throw new Error(await r.text());
      onDone();
      setTitle(""); setBody("[]");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 mt-2">
      <input className="border px-2 py-1 w-full" placeholder="Amendment title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="border px-2 py-1 w-full font-mono text-xs h-32" value={body} onChange={(e) => setBody(e.target.value)} />
      <button disabled={busy || !title.trim()} className="border px-3 py-1">
        {busy ? "Submitting…" : "Propose"}
      </button>
      {err && <p className="text-red-600 text-sm">{err}</p>}
    </form>
  );
}
