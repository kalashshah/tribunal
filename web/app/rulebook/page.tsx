import { ArticleList } from "./ArticleList";

export default function RulebookPage() {
  return (
    <main className="max-w-4xl mx-auto p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Tribunal Rulebook</h1>
        <p className="text-sm opacity-70">
          A curated UNIDROIT subset where each rule is anchored by an ENS
          subname on Sepolia. The on-chain registry pins which namehashes
          are canonical; the article body lives in the ENS resolver's{" "}
          <code>description</code> text record. To add new rules, see{" "}
          <a href="/governance" className="underline">Governance</a>.
        </p>
      </header>

      <section>
        <h2 className="font-semibold">Articles</h2>
        <ArticleList />
      </section>
    </main>
  );
}
