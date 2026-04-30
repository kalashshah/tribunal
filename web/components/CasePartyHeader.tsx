"use client";

import { useEffect, useState } from "react";
import { PartyLabel } from "./PartyLabel";

interface CaseInfo {
  accuser: string;
  defendant: string;
}

export function CasePartyHeader({ caseId }: { caseId: string }) {
  const [info, setInfo] = useState<CaseInfo | null>(null);

  useEffect(() => {
    fetch(`/api/cases/${caseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: CaseInfo | null) => { if (j?.accuser) setInfo(j); })
      .catch(() => {});
  }, [caseId]);

  if (!info) return null;

  return (
    <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 16px", lineHeight: 1.6 }}>
      <span style={{ fontWeight: 600, color: "var(--fg)" }}>Parties:</span>{" "}
      <PartyLabel address={info.accuser} />{" "}
      <span style={{ color: "var(--muted)" }}>vs</span>{" "}
      <PartyLabel address={info.defendant} />
    </p>
  );
}
