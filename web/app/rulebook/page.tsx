"use client";
import { useEffect, useState } from "react";
import { ProposeForm } from "./ProposeForm";
import { ProposalRow } from "./ProposalRow";
import { ArticleList } from "./ArticleList";

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

export default function RulebookPage() {
  const [s, setS] = useState<State | null>(null);
  const refresh = async () => {
    const r = await fetch("/api/rulebook");
    setS(await r.json());
  };
  useEffect(() => { refresh(); }, []);
  if (!s) return <main className="p-8">Loading…</main>;

  return (
    <main className="max-w-4xl mx-auto p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Tribunal Rulebook</h1>
        <p className="text-sm opacity-70">
          A curated UNIDROIT subset where each rule is anchored by an ENS
          subname on Sepolia. The on-chain registry pins which namehashes
          are canonical; the article body lives in the ENS resolver's
          <code> description</code> text record. Governance is open
          one-address-one-vote (humanity-oracle slot reserved).
        </p>
      </header>

      <section>
        <h2 className="font-semibold">Registry</h2>
        <p className="text-sm">RuleBook: <code>{s.ruleBook}</code></p>
        <p className="text-sm">Governor: <code>{s.governor}</code></p>
        <p className="text-sm">{s.articleCount} article(s) on-chain · quorum {s.quorum}</p>
      </section>

      <section>
        <h2 className="font-semibold">Articles</h2>
        <ArticleList />
      </section>

      <section>
        <h2 className="font-semibold">Propose a new article</h2>
        <ProposeForm onDone={refresh} />
      </section>

      <section>
        <h2 className="font-semibold">Proposals</h2>
        {s.proposals.length === 0 && <p className="text-sm">No proposals yet.</p>}
        {s.proposals.map((p) => <ProposalRow key={p.id} p={p} quorum={s.quorum} onDone={refresh} />)}
      </section>
    </main>
  );
}
