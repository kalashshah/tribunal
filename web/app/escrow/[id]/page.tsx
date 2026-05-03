import { ethers } from "ethers";
import { headers } from "next/headers";
import { PageHeader, Card } from "../../../components/ui";
import { ExplorerLink } from "../../../components/ExplorerLink";
import { PartyLabel } from "../../../components/PartyLabel";
import { ogAddr, shortAddr } from "../../../lib/explorer";

interface TimelineEntry {
  kind: string;
  blockNumber: number;
  txHash: string;
  args: Record<string, any>;
}

interface DetailResponse {
  id?: string;
  escrowAddress?: string;
  payer?: string;
  payee?: string;
  proposer?: string;
  amount?: string;
  deadline?: number;
  claimedAt?: number;
  status?: number;
  statusName?: string;
  terms?: string;
  termsCid?: string;
  linkedCaseId?: string | null;
  timeline?: TimelineEntry[];
  error?: string;
}

function resolveBase(): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  const h = headers();
  const host = h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

async function fetchDetail(id: string): Promise<DetailResponse> {
  const base = resolveBase();
  try {
    const r = await fetch(`${base}/api/escrow/${id}`, { cache: "no-store" });
    if (!r.ok) return { error: `HTTP ${r.status} from ${base}/api/escrow/${id}` };
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return { error: `non-JSON response from ${base}/api/escrow/${id}` };
    return (await r.json()) as DetailResponse;
  } catch (e: any) {
    return { error: e.message };
  }
}

function fmtTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function EscrowDetailPage({ params }: { params: { id: string } }) {
  const d = await fetchDetail(params.id);

  if (d.error || !d.payer) {
    return (
      <section>
        <PageHeader
          eyebrow="Escrow"
          title={`Agreement #${params.id}`}
          lede="Could not load this agreement."
        />
        <p style={{ color: "var(--muted)", fontStyle: "italic" }}>{d.error ?? "Not found"}</p>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow={`Agreement #${d.id}`}
        title={
          <>
            <PartyLabel address={d.payer!} /> &rarr; <PartyLabel address={d.payee!} />
          </>
        }
        lede={
          <>
            Status: <strong>{d.statusName}</strong> &middot; {ethers.formatEther(d.amount ?? "0")} OG
            {d.linkedCaseId ? <> &middot; linked to <a href={`/case/${d.linkedCaseId}`}>case #{d.linkedCaseId}</a></> : null}
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
        <Card style={{ padding: 24 }}>
          <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)", fontSize: "1.4rem" }}>Terms</h3>
          <pre style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            lineHeight: 1.6,
            margin: 0,
            background: "var(--paper-shade)",
            padding: 16,
            borderRadius: 6,
          }}>
            {d.terms || "(no terms)"}
          </pre>

        </Card>

        <Card style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>Details</h3>
          <Field label="Amount">{ethers.formatEther(d.amount ?? "0")} OG</Field>
          <Field label="Status">{d.statusName}</Field>
          <Field label="Deadline">{fmtTime(d.deadline ?? 0)}</Field>
          {d.claimedAt ? <Field label="Claimed">{fmtTime(d.claimedAt)}</Field> : null}
          <Field label="Payer"><PartyLabel address={d.payer!} /></Field>
          <Field label="Payee"><PartyLabel address={d.payee!} /></Field>
          <Field label="Proposer"><PartyLabel address={d.proposer!} /></Field>
          {d.escrowAddress ? (
            <Field label="Escrow">
              <ExplorerLink href={ogAddr(d.escrowAddress)} title={d.escrowAddress}>
                <code>{shortAddr(d.escrowAddress)}</code>
              </ExplorerLink>
            </Field>
          ) : null}
          {d.linkedCaseId ? (
            <Field label="Case">
              <a href={`/case/${d.linkedCaseId}`}>#{d.linkedCaseId}</a>
            </Field>
          ) : null}
        </Card>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border, #f0e9d6)", fontSize: 13 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{children}</span>
    </div>
  );
}
