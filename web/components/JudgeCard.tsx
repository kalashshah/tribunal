interface JudgeView {
  tokenId: number;
  name: string;
  persona: string;
  rulingCount: number;
}

export function JudgeCard({ judge }: { judge: JudgeView }) {
  return (
    <div className="card">
      <h3>{judge.name}</h3>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>{judge.persona}</p>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>
        Token #{judge.tokenId} · {judge.rulingCount} ruling{judge.rulingCount === 1 ? "" : "s"}
      </p>
    </div>
  );
}
