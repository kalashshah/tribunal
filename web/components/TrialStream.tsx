"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExplorerLink } from "./ExplorerLink";
import { DEPLOYMENT, ensApp, ogContract, ogTx, zgSubmission } from "../lib/explorer";

function ensLinkFor(name: string): string | null {
  return DEPLOYMENT.sepolia.subnames.includes(name as any)
    || name === DEPLOYMENT.sepolia.parentDomain
    ? ensApp(name)
    : null;
}

interface StreamEvent {
  kind: string;
  from: string;
  body: string;
  meta?: Record<string, unknown>;
  timestamp?: number;
  seq?: number;
  contentHash?: string;
  rootHash?: string;
  storageTxHash?: string;
  storageTxSeq?: number;
  anchorTxHash?: string;
  persistError?: string;
}

function fmtTime(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function sideOf(e: StreamEvent): "accuser" | "defendant" | "judge" {
  if (e.kind === "ruling") return "judge";
  if (e.kind === "question" && e.meta?.askerSide === "judge") return "judge";
  if (e.kind === "answer") {
    const ansSide = (e.meta?.answeringSide as string) ?? "";
    return ansSide === "defendant" ? "defendant" : "accuser";
  }
  const s = (e.meta?.side as string) ?? (e.meta?.askerSide as string) ?? "";
  if (s === "defendant") return "defendant";
  if (s === "judge") return "judge";
  return "accuser";
}

function labelOf(e: StreamEvent): string {
  if (e.kind === "ruling") return "Verdict";
  if (e.kind === "briefing") return "Discovery brief";
  if (e.kind === "question") {
    const target = (e.meta?.target as string) ?? "party";
    return `Question for the ${target}`;
  }
  if (e.kind === "answer") {
    const side = (e.meta?.answeringSide as string) ?? "party";
    return `Answer from the ${side}`;
  }
  const side = sideOf(e);
  if (side === "judge") return "Bench";
  return side === "accuser" ? "Accuser" : "Defendant";
}

export function TrialStream({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const r = await fetch(`/api/cases/${caseId}/events`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as StreamEvent[];
        if (!stopped) {
          setEvents(j);
          setError(null);
        }
      } catch (e: any) {
        if (!stopped) setError(e.message ?? String(e));
      }
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { stopped = true; clearInterval(id); };
  }, [caseId]);

  return (
    <div>
      <span className="eyebrow">In session</span>
      <h2 style={{ marginTop: 8, marginBottom: 4 }}>
        Case &#8470;{caseId}
      </h2>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
        Anchored on{" "}
        <ExplorerLink href={ogContract("TribunalCore")}>TribunalCore</ExplorerLink>
        {" · "}filed by{" "}
        <ExplorerLink href={ogContract("AgentRegistry")}>AgentRegistry</ExplorerLink>
      </p>
      {error && (
        <p style={{ color: "var(--terracotta-deep)", fontStyle: "italic" }}>{error}</p>
      )}
      {events.length === 0 ? (
        <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
          Awaiting proceedings…
        </p>
      ) : (
        <ol className="timeline">
          {events.map((e, i) => {
            const side = sideOf(e);
            return (
              <li key={i} className={`timeline-item side-${side} kind-${e.kind}`}>
                <span className="timeline-marker" aria-hidden />
                <div className="timeline-meta">
                  <span className="timeline-when">{fmtTime(e.timestamp)}</span>
                  <span className="timeline-sep">·</span>
                  <span className="timeline-label">{labelOf(e)}</span>
                </div>
                <div className="card timeline-card">
                  <div className="timeline-who">
                    {ensLinkFor(e.from) ? (
                      <ExplorerLink href={ensLinkFor(e.from)!}>{e.from}</ExplorerLink>
                    ) : (
                      e.from
                    )}
                  </div>
                  <div className="md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {e.body}
                    </ReactMarkdown>
                  </div>
                  <div className="timeline-anchors">
                    {e.anchorTxHash ? (
                      <ExplorerLink href={ogTx(e.anchorTxHash)} title={e.anchorTxHash}>
                        anchor tx
                      </ExplorerLink>
                    ) : (
                      <span className="anchor-pending" title={e.persistError ?? "pending"}>
                        {e.persistError ? "anchor failed" : "anchoring…"}
                      </span>
                    )}
                    {typeof e.storageTxSeq === "number" && (
                      <>
                        <span className="anchor-sep">·</span>
                        <ExplorerLink href={zgSubmission(e.storageTxSeq)} title={e.rootHash ? `0G root ${e.rootHash} (submission #${e.storageTxSeq})` : `submission #${e.storageTxSeq}`}>
                          0G storage
                        </ExplorerLink>
                      </>
                    )}
                    {e.storageTxHash && (
                      <>
                        <span className="anchor-sep">·</span>
                        <ExplorerLink href={ogTx(e.storageTxHash)} title={e.storageTxHash}>
                          submit tx
                        </ExplorerLink>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
