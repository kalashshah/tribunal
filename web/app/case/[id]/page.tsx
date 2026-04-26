import { TrialStream } from "../../../components/TrialStream";
import { VerdictCard } from "../../../components/VerdictCard";

export default function CasePage({ params }: { params: { id: string } }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
      <TrialStream caseId={params.id} />
      <VerdictCard caseId={params.id} />
    </div>
  );
}
