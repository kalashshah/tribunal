/// Thin wrapper over the deployed TribunalCore + JudgeINFT + VerdictLog
/// contracts, used by clerk and judge agents. Decouples agent logic from
/// the ethers.Contract specifics so tests can inject mocks.

export interface TxLike { hash?: string; wait(): Promise<unknown> }

export interface TribunalContracts {
  tribunalCore: {
    recordEvent: (caseId: bigint, contentHash: `0x${string}`) => Promise<TxLike>;
    acceptCase: (caseId: bigint, judges: string[], threshold: bigint) => Promise<TxLike>;
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
    finalizeVerdictWithReceipt?: (
      caseId: bigint,
      verdictLog: string,
      opinionRoot: `0x${string}`,
      receiptHash: `0x${string}`,
      receiptUrl: string,
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
  anchorEvent(caseId: bigint, contentHash: `0x${string}`): Promise<{ txHash: string }>;
  acceptCase(caseId: bigint, judges: string[], threshold: bigint): Promise<void>;
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
  ): Promise<{ txHash: string }>;
  /// Same as finalizeVerdict, plus an REE receipt attached on-chain. Falls
  /// back to plain finalizeVerdict if the contract doesn't expose the
  /// receipt-aware variant (older deployments).
  finalizeVerdictWithReceipt(
    caseId: bigint,
    verdictLogAddress: string,
    opinionRoot: `0x${string}`,
    receipt: { hash: `0x${string}`; url: string } | undefined,
  ): Promise<{ txHash: string }>;
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
      return { txHash: tx.hash ?? "" };
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
      return { txHash: tx.hash ?? "" };
    },
    async finalizeVerdictWithReceipt(caseId, verdictLogAddress, opinionRoot, receipt) {
      const fn = deps.tribunalCore.finalizeVerdictWithReceipt;
      if (fn && receipt) {
        const tx = await fn(caseId, verdictLogAddress, opinionRoot, receipt.hash, receipt.url);
        await tx.wait();
        return { txHash: tx.hash ?? "" };
      }
      // Older deployment or no receipt available — settle without it.
      const tx = await deps.tribunalCore.finalizeVerdict(caseId, verdictLogAddress, opinionRoot);
      await tx.wait();
      return { txHash: tx.hash ?? "" };
    },
    postVerdict: deps.verdictLog
      ? async (caseId, prevail, root) => {
          const tx = await deps.verdictLog!.post(caseId, prevail, root);
          await tx.wait();
        }
      : undefined,
  };
}
