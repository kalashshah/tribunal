"use client";

import { useEffect, useState } from "react";

interface StreamEvent {
  kind: string;
  from: string;
  body: string;
  meta?: Record<string, unknown>;
}

export function TrialStream({ caseId }: { caseId: string }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/stream/${caseId}`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as StreamEvent;
        setEvents((prev) => [...prev, parsed]);
      } catch {
        /* skip malformed */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [caseId]);

  return (
    <div>
      <h3>
        Trial — case #{caseId}{" "}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {connected ? "● live" : "○ disconnected"}
        </span>
      </h3>
      {events.length === 0 ? (
        <p style={{ color: "var(--muted)" }}><em>Waiting for proceedings to begin…</em></p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {events.map((e, i) => (
            <div key={i} className="event">
              <span className="who">{e.from}</span>
              <span className="kind">{e.kind}</span>
              <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{e.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
