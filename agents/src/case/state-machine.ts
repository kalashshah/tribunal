/// Off-chain mirror of the on-chain CaseStatus enum in TribunalCore.sol.
/// The numeric values intentionally match the contract enum.
export enum CaseStatus {
  Filed = 1,
  Accepted = 2,
  Arguments = 3,
  Deliberation = 4,
  Ruled = 5,
  Settled = 6,
}

export class CaseSM {
  status: CaseStatus = CaseStatus.Filed;
  judges: string[] = [];
  prevailingIsAccuser?: boolean;

  accept(judges: string[]): void {
    this.assert(CaseStatus.Filed);
    this.judges = judges;
    this.status = CaseStatus.Accepted;
  }

  openArguments(): void {
    this.assert(CaseStatus.Accepted);
    this.status = CaseStatus.Arguments;
  }

  closeArguments(): void {
    this.assert(CaseStatus.Arguments);
    this.status = CaseStatus.Deliberation;
  }

  rule(prevailingIsAccuser: boolean): void {
    this.assert(CaseStatus.Deliberation, CaseStatus.Arguments);
    this.prevailingIsAccuser = prevailingIsAccuser;
    this.status = CaseStatus.Ruled;
  }

  settle(): void {
    this.assert(CaseStatus.Ruled);
    this.status = CaseStatus.Settled;
  }

  private assert(...allowed: CaseStatus[]): void {
    if (!allowed.includes(this.status)) {
      throw new Error(
        `illegal transition from ${CaseStatus[this.status]} (allowed: ${allowed.map((s) => CaseStatus[s]).join(", ")})`,
      );
    }
  }
}
