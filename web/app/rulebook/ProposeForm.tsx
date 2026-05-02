"use client";
import { useState } from "react";

// Propose a new article for the rulebook. The ENS subname for the article
// (chapter-X-Y.rulebook.tribunal.eth) must already be published on Sepolia
// with at least a `description` text record before voters approve.

export function ProposeForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [articleId, setArticleId] = useState("");
  const [chapter, setChapter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<{ articleId: string; ensName: string } | null>(null);

  const ensPreview = articleId.match(/^\d+(\.\d+)*$/)
    ? `chapter-${articleId.replace(/\./g, "-")}.rulebook.tribunal.eth`
    : "(enter a valid articleId like 9.1.5)";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setOk(null);
    try {
      const r = await fetch("/api/rulebook/propose", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, articleId, chapter }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setOk({ articleId: j.articleId, ensName: j.ensName });
      onDone();
      setTitle(""); setArticleId(""); setChapter("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 mt-2">
      <input
        className="border px-2 py-1 w-full"
        placeholder="Title (e.g. Add UNIDROIT Art. 9.1.5)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="flex gap-2">
        <input
          className="border px-2 py-1 flex-1"
          placeholder="Article id (e.g. 9.1.5)"
          value={articleId}
          onChange={(e) => setArticleId(e.target.value)}
        />
        <input
          className="border px-2 py-1 flex-1"
          placeholder="Chapter (e.g. 9.1)"
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
        />
      </div>
      <p className="text-xs opacity-70">
        ENS subname (must exist on Sepolia with a <code>description</code> record):
        {" "}<code>{ensPreview}</code>
      </p>
      <button disabled={busy || !title.trim() || !articleId.trim() || !chapter.trim()} className="border px-3 py-1">
        {busy ? "Submitting…" : "Propose"}
      </button>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {ok && (
        <p className="text-sm text-green-700">
          Proposed <code>{ok.articleId}</code> · ENS <code>{ok.ensName}</code>
        </p>
      )}
    </form>
  );
}
