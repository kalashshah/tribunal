"use client";

import { useState } from "react";

interface FormState {
  accuser: string;
  defendant: string;
  escrow: string;
  escrowId: string;
  accusation: string;
}

export function DisputeForm() {
  const [form, setForm] = useState<FormState>({
    accuser: "alice.tribunal.eth",
    defendant: "bob.tribunal.eth",
    escrow: "",
    escrowId: "",
    accusation: "",
  });
  const [pending, setPending] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      const j = (await res.json()) as { caseId: string };
      setCaseId(j.caseId);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setPending(false);
    }
  }

  function update<K extends keyof FormState>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  if (caseId) {
    return (
      <div className="card">
        <p>Case <strong>#{caseId}</strong> filed.</p>
        <p><a href={`/case/${caseId}`}>Open case →</a></p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h2>File a dispute</h2>

      <label>Accuser ENS</label>
      <input value={form.accuser} onChange={(e) => update("accuser", e.target.value)} required />

      <label>Defendant ENS</label>
      <input value={form.defendant} onChange={(e) => update("defendant", e.target.value)} required />

      <label>Escrow contract (optional)</label>
      <input value={form.escrow} onChange={(e) => update("escrow", e.target.value)} placeholder="0x..." />

      <label>Escrow ID (optional)</label>
      <input value={form.escrowId} onChange={(e) => update("escrowId", e.target.value)} placeholder="1" />

      <label>Accusation</label>
      <textarea
        value={form.accusation}
        onChange={(e) => update("accusation", e.target.value)}
        required
        placeholder="What happened, in your own words..."
      />

      {error && <p style={{ color: "tomato" }}>{error}</p>}

      <button disabled={pending} type="submit">
        {pending ? "Filing…" : "File dispute"}
      </button>
    </form>
  );
}
