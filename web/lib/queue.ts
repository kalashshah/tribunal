// Tiny shared "queue" backed by a JSON file at the repo root. The runner
// process can poll this file to pick up new disputes filed via the UI.
// Crude but adequate for a hackathon demo.

import * as fs from "node:fs/promises";
import * as path from "node:path";

const file = path.resolve(process.cwd(), "../.cases-queue.json");

export interface QueuedCase {
  caseId: string;
  accuser: string;
  defendant: string;
  escrow: string;
  escrowId: string;
  accusation: string;
  filedAt: number;
}

export async function readQueue(): Promise<QueuedCase[]> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as QueuedCase[];
  } catch {
    return [];
  }
}

export async function writeQueue(q: QueuedCase[]): Promise<void> {
  await fs.writeFile(file, JSON.stringify(q, null, 2));
}

export async function enqueue(input: Omit<QueuedCase, "caseId" | "filedAt">): Promise<QueuedCase> {
  const q = await readQueue();
  const c: QueuedCase = {
    caseId: String(q.length + 1),
    filedAt: Date.now(),
    ...input,
  };
  q.push(c);
  await writeQueue(q);
  return c;
}
