import { ethers } from "ethers";
import { headers } from "next/headers";
import { PageHeader } from "../../components/ui";
import { ExplorerLink } from "../../components/ExplorerLink";
import { ogAddr, shortAddr } from "../../lib/explorer";
import { PartyLabel } from "../../components/PartyLabel";
import { EscrowRow } from "../../components/EscrowRow";

interface Row {
  id: string;
  payer: string;
  payee: string;
  proposer: string;
  amount: string;
  deadline: number;
  status: number;
  statusName: string;
  termsPreview: string;
}

interface ListResponse {
  escrowAddress?: string;
  agreements?: Row[];
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

async function fetchList(): Promise<ListResponse> {
  const base = resolveBase();
  try {
    const r = await fetch(`${base}/api/escrow`, { cache: "no-store" });
    if (!r.ok) return { error: `HTTP ${r.status} from ${base}/api/escrow` };
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return { error: `non-JSON response from ${base}/api/escrow` };
    return (await r.json()) as ListResponse;
  } catch (e: any) {
    return { error: e.message };
  }
}

function formatDeadline(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default async function EscrowListPage() {
  const data = await fetchList();
  const rows = data.agreements ?? [];

  return (
    <section>
      <PageHeader
        eyebrow="Escrow"
        title="Agreements"
        lede={
          <>
            Native-OG escrow with two-step mutual assent: one party proposes,
            the other accepts, the payer funds. If the parties disagree, the
            agreement is flagged disputed and routed to Tribunal — the verdict
            decides who gets paid.
          </>
        }
      />
      {data.escrowAddress ? (
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>
          Contract:{" "}
          <ExplorerLink href={ogAddr(data.escrowAddress)} title={data.escrowAddress}>
            <code>{shortAddr(data.escrowAddress)}</code>
          </ExplorerLink>
        </p>
      ) : null}
      {data.error ? (
        <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
          Unable to load escrow agreements: {data.error}
        </p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
          No agreements have been proposed yet.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1310, borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, #e8dfc8)" }}>
                <th style={{ padding: "10px 16px", width: 60 }}>#</th>
                <th style={{ padding: "10px 16px", width: 200 }}>Payer</th>
                <th style={{ padding: "10px 16px", width: 200 }}>Payee</th>
                <th style={{ padding: "10px 16px", width: 140 }}>Amount (OG)</th>
                <th style={{ padding: "10px 16px", width: 200 }}>Deadline</th>
                <th style={{ padding: "10px 16px", width: 130 }}>Status</th>
                <th style={{ padding: "10px 16px", width: 380 }}>Terms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <EscrowRow key={r.id} href={`/escrow/${r.id}`}>
                  <td style={{ padding: "12px 16px", fontVariantNumeric: "tabular-nums" }}>{r.id}</td>
                  <td style={{ padding: "12px 16px" }}><PartyLabel address={r.payer} /></td>
                  <td style={{ padding: "12px 16px" }}><PartyLabel address={r.payee} /></td>
                  <td style={{ padding: "12px 16px", fontVariantNumeric: "tabular-nums" }}>
                    {ethers.formatEther(r.amount)}
                  </td>
                  <td style={{ padding: "12px 16px", color: "var(--muted)", fontSize: 13, whiteSpace: "nowrap" }}>
                    {formatDeadline(r.deadline)}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <StatusBadge status={r.status} name={r.statusName} />
                  </td>
                  <td style={{ padding: "12px 16px", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.termsPreview}>
                    {r.termsPreview || "—"}
                  </td>
                </EscrowRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status, name }: { status: number; name: string }) {
  const palette: Record<number, { bg: string; fg: string }> = {
    0: { bg: "#f3eccb", fg: "#7a6826" },                  // Proposed
    1: { bg: "#e6dfb8", fg: "#675a1f" },                  // Accepted
    2: { bg: "#cfe3d3", fg: "#235a36" },                  // Funded
    3: { bg: "#dfe5cf", fg: "#4a5a23" },                  // Claimed
    4: { bg: "#cdd9c1", fg: "#3a4d28" },                  // Released (terminal happy)
    5: { bg: "#efc9b8", fg: "#7a3a1f" },                  // Disputed
    6: { bg: "#c9d6cb", fg: "#2c4533" },                  // Settled
    7: { bg: "#e3d4cd", fg: "#6a4a3c" },                  // Revoked
  };
  const c = palette[status] ?? { bg: "#eee", fg: "#444" };
  return (
    <span style={{
      background: c.bg, color: c.fg, padding: "2px 10px", borderRadius: 999,
      fontSize: 12, fontWeight: 500, letterSpacing: 0.2,
    }}>
      {name}
    </span>
  );
}
