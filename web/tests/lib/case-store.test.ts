import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendDocketItem,
  listDocketItems,
  appendQuestion,
  listQuestions,
  recordAnswer,
  type DocketItem,
  type QuestionRecord,
} from "../../lib/case-store";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "case-store-"));
});

describe("case-store dockets", () => {
  it("appends and lists items in order", () => {
    const item: DocketItem = {
      id: "evd_1_a", caseId: "1", submittedBy: "0xabc",
      submittedAt: "2026-04-30T00:00:00.000Z",
      kind: "evidence", body: "I have the contract",
    };
    appendDocketItem(tmp, item);
    appendDocketItem(tmp, { ...item, id: "evd_1_b", body: "tx hash 0xdead" });
    const got = listDocketItems(tmp, "1");
    expect(got.map((x) => x.id)).toEqual(["evd_1_a", "evd_1_b"]);
  });

  it("returns [] when no docket file exists", () => {
    expect(listDocketItems(tmp, "999")).toEqual([]);
  });
});

describe("case-store questions", () => {
  const q: QuestionRecord = {
    id: "q_1_x", caseId: "1", askedBy: "alice.tribunal.eth",
    askedAt: "2026-04-30T00:00:01.000Z",
    target: "defendant", targetAddress: "0xdef",
    body: "Did you sign the contract?", status: "pending",
  };

  it("appends pending question and lists it", () => {
    appendQuestion(tmp, q);
    const got = listQuestions(tmp, "1");
    expect(got).toEqual([q]);
  });

  it("filters by targetAddress (case-insensitive)", () => {
    appendQuestion(tmp, q);
    appendQuestion(tmp, { ...q, id: "q_1_y", targetAddress: "0xOTHER" });
    const got = listQuestions(tmp, "1", { targetAddress: "0xDEF" });
    expect(got.map((x) => x.id)).toEqual(["q_1_x"]);
  });

  it("filters by unanswered", () => {
    appendQuestion(tmp, q);
    recordAnswer(tmp, "1", "q_1_x", "yes I did", "2026-04-30T00:00:05.000Z");
    appendQuestion(tmp, { ...q, id: "q_1_z" });
    const got = listQuestions(tmp, "1", { unansweredOnly: true });
    expect(got.map((x) => x.id)).toEqual(["q_1_z"]);
  });

  it("recordAnswer flips status to answered and sets answer", () => {
    appendQuestion(tmp, q);
    recordAnswer(tmp, "1", "q_1_x", "the contract was signed", "2026-04-30T00:00:10.000Z");
    const [got] = listQuestions(tmp, "1");
    expect(got.status).toBe("answered");
    expect(got.answer).toBe("the contract was signed");
    expect(got.answeredAt).toBe("2026-04-30T00:00:10.000Z");
  });

  it("recordAnswer is idempotent on already-answered question (returns false, no overwrite)", () => {
    appendQuestion(tmp, q);
    recordAnswer(tmp, "1", "q_1_x", "first", "2026-04-30T00:00:10.000Z");
    const second = recordAnswer(tmp, "1", "q_1_x", "second", "2026-04-30T00:00:11.000Z");
    expect(second).toBe(false);
    const [got] = listQuestions(tmp, "1");
    expect(got.answer).toBe("first");
  });
});
