import * as fs from "node:fs";
import * as path from "node:path";

export interface DocketItem {
  id: string;
  caseId: string;
  submittedBy: string;
  submittedAt: string;
  kind: "evidence";
  body: string;
  url?: string;
}

export interface QuestionRecord {
  id: string;
  caseId: string;
  askedBy: string;
  askedAt: string;
  target: "accuser" | "defendant";
  targetAddress: string;
  body: string;
  status: "pending" | "answered" | "timeout";
  answer?: string;
  answeredAt?: string;
}

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

function docketPath(varDir: string, caseId: string): string {
  return path.join(varDir, "dockets", `${caseId}.jsonl`);
}
function questionsPath(varDir: string, caseId: string): string {
  return path.join(varDir, "questions", `${caseId}.jsonl`);
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T);
}

function writeJsonl<T>(file: string, rows: T[]): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function appendDocketItem(varDir: string, item: DocketItem): void {
  const file = docketPath(varDir, item.caseId);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(item) + "\n");
}

export function listDocketItems(varDir: string, caseId: string): DocketItem[] {
  return readJsonl<DocketItem>(docketPath(varDir, caseId));
}

export function appendQuestion(varDir: string, q: QuestionRecord): void {
  const file = questionsPath(varDir, q.caseId);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(q) + "\n");
}

export interface ListQuestionFilters {
  targetAddress?: string;
  unansweredOnly?: boolean;
}

export function listQuestions(
  varDir: string,
  caseId: string,
  filters: ListQuestionFilters = {},
): QuestionRecord[] {
  const all = readJsonl<QuestionRecord>(questionsPath(varDir, caseId));
  return all.filter((q) => {
    if (filters.targetAddress && q.targetAddress.toLowerCase() !== filters.targetAddress.toLowerCase()) return false;
    if (filters.unansweredOnly && q.status !== "pending") return false;
    return true;
  });
}

/// Returns true if the answer was recorded; false if the question was already answered.
export function recordAnswer(
  varDir: string,
  caseId: string,
  questionId: string,
  answer: string,
  answeredAt: string,
): boolean {
  const file = questionsPath(varDir, caseId);
  const rows = readJsonl<QuestionRecord>(file);
  const ix = rows.findIndex((r) => r.id === questionId);
  if (ix === -1) throw new Error(`question ${questionId} not found in case ${caseId}`);
  if (rows[ix].status !== "pending") return false;
  rows[ix] = { ...rows[ix], status: "answered", answer, answeredAt };
  writeJsonl(file, rows);
  return true;
}

export function getQuestion(varDir: string, caseId: string, questionId: string): QuestionRecord | null {
  return readJsonl<QuestionRecord>(questionsPath(varDir, caseId)).find((r) => r.id === questionId) ?? null;
}
