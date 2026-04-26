/// Thin wrapper over the deployed TribunalCore + JudgeINFT + VerdictLog
/// contracts, used by clerk and judge agents. Decouples agent logic from
/// the ethers.Contract specifics so tests can inject mocks.

export interface TxLike { wait(): Promise<unknown> }

export interface TribunalContracts {
  tribunalCore: {
    recordEvent: (caseId: bigint, contentHash: `0x${string}`) => Promise<TxLike>;
    acceptCase: (caseId: bigint, judgeIds: bigint[], threshold: bigint) => Promise<TxLike>;
    submitRuling: (
      caseId: bigint,
      prevailingIsAccuser: boolean,
      opinionHash: `0x${string}`,
    ) => Promise<TxLike>;
    markSettled: (caseId: bigint) => Promise<TxLike>;
    finalizeVerdict: (
      caseId: bigint,
      verdictLog: string,
      opinionRoot: `0x${string}`,
    ) => Promise<TxLike>;
  };
  judgeINFT: {
    appendRulingMemory: (tokenId: bigint, caseRulingHash: `0x${string}`) => Promise<TxLike>;
  };
  verdictLog?: {
    post: (
      caseId: bigint,
      prevailingIsAccuser: boolean,
      opinionRoot: `0x${string}`,
    ) => Promise<TxLike>;
  };
}

export interface TribunalClient {
  anchorEvent(caseId: bigint, contentHash: `0x${string}`): Promise<void>;
  acceptCase(caseId: bigint, judgeIds: bigint[], threshold: bigint): Promise<void>;
  submitRuling(
    caseId: bigint,
    prevailingIsAccuser: boolean,
    opinionHash: `0x${string}`,
  ): Promise<void>;
  appendJudgeMemory(judgeTokenId: bigint, caseRulingHash: `0x${string}`): Promise<void>;
  markSettled(caseId: bigint): Promise<void>;
  finalizeVerdict(
    caseId: bigint,
    verdictLogAddress: string,
    opinionRoot: `0x${string}`,
  ): Promise<void>;
  postVerdict?(
    caseId: bigint,
    prevailingIsAccuser: boolean,
    opinionRoot: `0x${string}`,
  ): Promise<void>;
}

export function createTribunalClient(deps: TribunalContracts): TribunalClient {
  return {
    async anchorEvent(caseId, h) {
      const tx = await deps.tribunalCore.recordEvent(caseId, h);
      await tx.wait();
    },
    async acceptCase(caseId, judges, threshold) {
      const tx = await deps.tribunalCore.acceptCase(caseId, judges, threshold);
      await tx.wait();
    },
    async submitRuling(caseId, prevail, op) {
      const tx = await deps.tribunalCore.submitRuling(caseId, prevail, op);
      await tx.wait();
    },
    async appendJudgeMemory(tokenId, h) {
      const tx = await deps.judgeINFT.appendRulingMemory(tokenId, h);
      await tx.wait();
    },
    async markSettled(caseId) {
      const tx = await deps.tribunalCore.markSettled(caseId);
      await tx.wait();
    },
    async finalizeVerdict(caseId, verdictLogAddress, opinionRoot) {
      const tx = await deps.tribunalCore.finalizeVerdict(caseId, verdictLogAddress, opinionRoot);
      await tx.wait();
    },
    postVerdict: deps.verdictLog
      ? async (caseId, prevail, root) => {
          const tx = await deps.verdictLog!.post(caseId, prevail, root);
          await tx.wait();
        }
      : undefined,
  };
}
