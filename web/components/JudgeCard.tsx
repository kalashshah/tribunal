import { Card } from "./ui";
import { ExplorerLink } from "./ExplorerLink";
import { DEPLOYMENT, ensApp, ogToken } from "../lib/explorer";

interface JudgeView {
  tokenId: number;
  name: string;
  persona: string;
  rulingCount: number;
}

export function JudgeCard({ judge }: { judge: JudgeView }) {
  // Make any "judge#1" fallback feel intentional in classical type.
  const displayName = judge.name.replace(/^judge[#-]?/, "Judge ");
  // The seeded judge persona is alice/bob/judge-athena.tribunal.eth on Sepolia;
  // any other persona name we don't try to link.
  const ensName = DEPLOYMENT.sepolia.subnames.find((n) =>
    n.toLowerCase().startsWith(judge.name.toLowerCase().replace(/^judge[#-]?/, "judge-")),
  );
  return (
    <Card as="article">
      <h3>{displayName}</h3>
      {judge.persona && (
        <p style={{ fontStyle: "italic", color: "var(--ink-soft)", margin: "0 0 10px" }}>
          {judge.persona}
        </p>
      )}
      <div className="meta">
        <ExplorerLink href={ogToken(DEPLOYMENT.ogGalileo.contracts.JudgeINFT, judge.tokenId)}>
          Token &#8470;{judge.tokenId}
        </ExplorerLink>
        {" "}&middot;{" "}
        {judge.rulingCount === 0
          ? "no rulings yet"
          : `${judge.rulingCount} ruling${judge.rulingCount === 1 ? "" : "s"}`}
      </div>
      {ensName && (
        <div className="meta" style={{ marginTop: 6 }}>
          ENS:{" "}
          <ExplorerLink href={ensApp(ensName)}>
            <code>{ensName}</code>
          </ExplorerLink>
        </div>
      )}
    </Card>
  );
}
