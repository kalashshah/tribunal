"use client";
import { useEffect, useState } from "react";
import { ProposeForm } from "./ProposeForm";
import { ProposalRow } from "./ProposalRow";

interface Amendment { cidRoot: string; cidUrl: string; title: string; appliedAt: bigint }
interface Proposal  { id: number; proposer: string; title: string; cidRoot: string; cidUrl: string; yes: number; no: number; executed: boolean }
interface State { address: string; baseRoot: string; baseUrl: string; amendments: Amendment[]; proposals: Proposal[] }

export default function RulebookPage() {
  const [s, setS] = useState<State | null>(null);
  const refresh = async () => {
    const r = await fetch("/api/rulebook");
    setS(await r.json());
  };
  useEffect(() => { refresh(); }, []);
  if (!s) return <main className="p-8">Loading…</main>;

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Tribunal Rulebook</h1>
        <p className="text-sm opacity-70">
          Demo governance — open voting, one address one vote. Future: gated via World ID / Proof of Humanity.
        </p>
      </header>

      <section>
        <h2 className="font-semibold">Current rulebook</h2>
        <p className="text-sm">Base: <code>{s.baseRoot.slice(0, 14)}…</code> ({s.baseUrl})</p>
        <p className="text-sm">{s.amendments.length} amendment(s) applied</p>
        <ul className="mt-2 list-disc ml-6">
          {s.amendments.map((a, i) => (
            <li key={i}>
              <strong>{a.title}</strong> — <code>{a.cidRoot.slice(0, 14)}…</code>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold">Propose an amendment</h2>
        <ProposeForm onDone={refresh} />
      </section>

      <section>
        <h2 className="font-semibold">Proposals</h2>
        {s.proposals.length === 0 && <p className="text-sm">No proposals yet.</p>}
        {s.proposals.map((p) => <ProposalRow key={p.id} p={p} onDone={refresh} />)}
      </section>
    </main>
  );
}
