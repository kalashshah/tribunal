import { JudgeCard } from "../../components/JudgeCard";
import { CardGrid, PageHeader } from "../../components/ui";

interface JudgeView {
  tokenId: number;
  name: string;
  persona: string;
  rulingCount: number;
}

async function fetchJudges(): Promise<JudgeView[]> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  try {
    const r = await fetch(`${base}/api/judges`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? (j as JudgeView[]) : [];
  } catch {
    return [];
  }
}

export default async function JudgesPage() {
  const judges = await fetchJudges();
  return (
    <section>
      <PageHeader
        eyebrow="The bench"
        title="Judges"
        lede="Each judge is an ERC-7857 iNFT — its persona is encrypted, its ruling history grows on every case it hears, and ownership is transferable."
      />
      {judges.length === 0 ? (
        <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
          No judges have been minted on this network yet.
        </p>
      ) : (
        <CardGrid columns={3} minCardWidth={260}>
          {judges.map((j) => <JudgeCard key={j.tokenId} judge={j} />)}
        </CardGrid>
      )}
    </section>
  );
}
