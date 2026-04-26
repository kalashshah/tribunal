import { JudgeCard } from "../../components/JudgeCard";

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
      <h2>Judges</h2>
      <p style={{ color: "var(--muted)" }}>
        Judges are ERC-7857 iNFTs with encrypted personas and an evolving ruling history.
      </p>
      {judges.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          <em>No judges found. Mint some by running the runner — or check that contracts are deployed.</em>
        </p>
      ) : (
        <div className="grid-3" style={{ marginTop: 16 }}>
          {judges.map((j) => <JudgeCard key={j.tokenId} judge={j} />)}
        </div>
      )}
    </section>
  );
}
