export interface DocketItem {
  id: string;
  caseId: string;
  submittedBy: string;
  submittedAt: string;
  kind: "evidence";
  body: string;
  url?: string;
}

export async function fetchDocket(backendUrl: string, caseId: string): Promise<DocketItem[]> {
  try {
    const res = await fetch(`${backendUrl}/api/cases/${encodeURIComponent(caseId)}/docket`);
    if (!res.ok) return [];
    const j = (await res.json()) as { items?: DocketItem[] };
    return j.items ?? [];
  } catch {
    return [];
  }
}

export function formatDocket(items: DocketItem[]): string {
  if (items.length === 0) {
    return "Case docket: (no evidence submitted by either party)";
  }
  const lines: string[] = ["Case docket (verbatim from parties — only these facts are admissible):"];
  for (const it of items) {
    lines.push(
      `  [${it.id}] from ${it.submittedBy} at ${it.submittedAt}` +
      (it.url ? ` (link: ${it.url})` : "") +
      `\n    ${it.body.replace(/\n/g, "\n    ")}`,
    );
  }
  return lines.join("\n");
}
