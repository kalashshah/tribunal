import { CasePartyHeader } from "../../../components/CasePartyHeader";
import { TrialStream } from "../../../components/TrialStream";
import { VerdictCard } from "../../../components/VerdictCard";

export default function CasePage({ params }: { params: { id: string } }) {
  return (
    <>
      <CasePartyHeader caseId={params.id} />
      <div className="case-grid">
        <TrialStream caseId={params.id} />
        <VerdictCard caseId={params.id} />
      </div>
    </>
  );
}
