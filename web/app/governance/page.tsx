"use client";
import { useEffect, useState } from "react";
import { ProposeForm } from "./ProposeForm";
import { ProposalRow } from "./ProposalRow";

interface Proposal {
  id: number;
  proposer: string;
  title: string;
  articleId: string;
  ensNode: string;
  chapter: string;
  yes: number;
  no: number;
  executed: boolean;
}
interface State {
  governor: string;
  ruleBook: string;
  quorum: number;
  articleCount: number;
  proposals: Proposal[];
}

export default function GovernancePage() {
  const [s, setS] = useState<State | null>(null);
  const refresh = async () => {
    const r = await fetch("/api/rulebook");
    setS(await r.json());
  };
  useEffect(() => { refresh(); }, []);
  if (!s) return <main className="p-8">Loading…</main>;

  const open = s.proposals.filter((p) => !p.executed);
  const executed = s.proposals.filter((p) => p.executed);

  return (
    <main className="max-w-4xl mx-auto p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Rulebook Governance</h1>
        <p className="text-sm opacity-70">
          Anyone can propose a new article (an article id + chapter; the
          ENS subname must already exist on Sepolia with a{" "}
          <code>description</code> text record). One address, one vote.
          When yes-votes reach the quorum threshold, anyone can execute the
          proposal — that calls <code>RuleBook.addArticle</code> on-chain
          and the article becomes part of the canonical rulebook. The{" "}
          <code>humanityOracle</code> slot is reserved for World ID /
          Proof of Humanity gating.
        </p>
      </header>

      <section>
        <h2 className="font-semibold">Propose a new article</h2>
        <ProposeForm onDone={refresh} />
      </section>

      <section>
        <h2 className="font-semibold">Open proposals</h2>
        {open.length === 0 && <p className="text-sm opacity-70">No open proposals.</p>}
        {open.map((p) => <ProposalRow key={p.id} p={p} quorum={s.quorum} onDone={refresh} />)}
      </section>

      {executed.length > 0 && (
        <section>
          <h2 className="font-semibold">Executed</h2>
          {executed.map((p) => <ProposalRow key={p.id} p={p} quorum={s.quorum} onDone={refresh} />)}
        </section>
      )}
    </main>
  );
}
