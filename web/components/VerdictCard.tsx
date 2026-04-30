"use client";

import { useEffect, useState } from "react";
import { ExplorerLink } from "./ExplorerLink";
import { PartyLabel } from "./PartyLabel";
import { DEPLOYMENT, OG_EXPLORER, ogContract, ogTx } from "../lib/explorer";

interface Verdict {
  prevailingIsAccuser: boolean;
  opinionRoot: string;
  postedAt: number;
  finalizeTxHash?: string;
}

interface CaseInfo {
  accuser?: string;
  defendant?: string;
}

export function VerdictCard({ caseId }: { caseId: string }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [parties, setParties] = useState<CaseInfo>({});

  useEffect(() => {
    fetch(`/api/cases/${caseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: CaseInfo | null) => { if (j?.accuser) setParties(j); })
      .catch(() => {});
  }, [caseId]);

  useEffect(() => {
    let stop = false;
    (async () => {
      while (!stop) {
        try {
          const r = await fetch(`/api/cases/${caseId}/verdict`);
          if (r.ok) {
            const j = (await r.json()) as { verdict: Verdict | null };
            if (j.verdict) {
              setVerdict(j.verdict);
              return;
            }
          }
        } catch {
          /* keep polling */
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
    })();
    return () => { stop = true; };
  }, [caseId]);

  if (!verdict) {
    return (
      <aside className="verdict-card">
        <p style={{ color: "var(--muted)", fontStyle: "italic", margin: "12px 0 0" }}>
          Awaiting verdict…
        </p>
      </aside>
    );
  }

  const prevailingAddress = verdict.prevailingIsAccuser ? parties.accuser : parties.defendant;
  const prevailingRole = verdict.prevailingIsAccuser ? "accuser" : "defendant";

  return (
    <aside className="verdict-card">
      <p className="who-wins">
        For the <strong>{prevailingRole}</strong>
        {prevailingAddress && (
          <> — <PartyLabel address={prevailingAddress} /></>
        )}.
      </p>
      <p style={{ wordBreak: "break-all", fontSize: 11, color: "var(--muted)", margin: "0 0 6px" }}>
        Opinion hash
      </p>
      <p style={{ wordBreak: "break-all", fontSize: 11, margin: 0 }}>
        <code>{verdict.opinionRoot}</code>
      </p>
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 14 }}>
        Posted {new Date(verdict.postedAt * 1000).toLocaleString()}
      </p>
      <p style={{ fontSize: 11, marginTop: 12, lineHeight: 1.7 }}>
        {verdict.finalizeTxHash && (
          <>
            <ExplorerLink href={ogTx(verdict.finalizeTxHash)} title={verdict.finalizeTxHash}>
              View posting tx
            </ExplorerLink>
            {" · "}
          </>
        )}
        <ExplorerLink
          href={`${OG_EXPLORER}/address/${DEPLOYMENT.ogGalileo.contracts.VerdictLog}#readContract`}
          title={`Call verdicts(${caseId}) to read the opinion hash from chain storage`}
        >
          Read VerdictLog
        </ExplorerLink>
        {" · "}
        <ExplorerLink href={ogContract("TribunalCore")}>TribunalCore</ExplorerLink>
      </p>
    </aside>
  );
}
