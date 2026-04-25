import { describe, expect, it } from "vitest";
import { CaseSM, CaseStatus } from "./state-machine";

describe("CaseSM", () => {
  it("walks Filed -> Accepted -> Arguments -> Deliberation -> Ruled -> Settled", () => {
    const sm = new CaseSM();
    expect(sm.status).toBe(CaseStatus.Filed);
    sm.accept(["j1", "j2", "j3"]);
    expect(sm.status).toBe(CaseStatus.Accepted);
    sm.openArguments();
    expect(sm.status).toBe(CaseStatus.Arguments);
    sm.closeArguments();
    expect(sm.status).toBe(CaseStatus.Deliberation);
    sm.rule(true);
    expect(sm.status).toBe(CaseStatus.Ruled);
    expect(sm.prevailingIsAccuser).toBe(true);
    sm.settle();
    expect(sm.status).toBe(CaseStatus.Settled);
  });

  it("allows ruling directly from Arguments (skipping the explicit Deliberation step)", () => {
    const sm = new CaseSM();
    sm.accept(["j1"]);
    sm.openArguments();
    sm.rule(false);
    expect(sm.status).toBe(CaseStatus.Ruled);
    expect(sm.prevailingIsAccuser).toBe(false);
  });

  it("rejects illegal transitions", () => {
    const sm = new CaseSM();
    expect(() => sm.rule(true)).toThrow(/illegal transition from Filed/);
    expect(() => sm.settle()).toThrow(/illegal transition from Filed/);
  });
});
