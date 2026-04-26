"use client";

import { useEffect, useState } from "react";

interface Verdict {
  prevailingIsAccuser: boolean;
  opinionRoot: string;
  postedAt: number;
}

export function VerdictCard({ caseId }: { caseId: string }) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);

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
      <aside className="card">
        <h3>Verdict</h3>
        <p style={{ color: "var(--muted)" }}><em>Awaiting verdict…</em></p>
      </aside>
    );
  }

  return (
    <aside className="card">
      <h3>Verdict</h3>
      <p>
        Prevailing party: <strong>{verdict.prevailingIsAccuser ? "Accuser" : "Defendant"}</strong>
      </p>
      <p style={{ wordBreak: "break-all", fontSize: 12 }}>
        Opinion hash: <code>{verdict.opinionRoot}</code>
      </p>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>
        Posted at {new Date(verdict.postedAt * 1000).toLocaleString()}
      </p>
    </aside>
  );
}
