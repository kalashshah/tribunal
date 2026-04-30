import { describe, it, expect, vi } from "vitest";
import {
  handleProposeContract,
  handleFundContract,
  handleAcceptContract,
  handleRevokeContract,
  handleGetContract,
  handleListMyContracts,
  type ContractsCtx,
} from "./tools-contracts";

function makeCtx(overrides: Partial<ContractsCtx> = {}): ContractsCtx {
  return {
    backendUrl: "http://x",
    walletAddress: "0xWaLLet0000000000000000000000000000000003",
    resolveAddress: vi.fn(async (s: string) =>
      s.startsWith("0x") ? s : "0xPaYeR000000000000000000000000000000000001",
    ),
    signer: {} as any,
    provider: {} as any,
    escrowAddress: "0xEsCrOw000000000000000000000000000000000099",
    tribunalCoreAddress: "0xTrIbUnAlCoRe0000000000000000000000000098",
    explorerBase: "https://explorer.test",
    ...overrides,
  };
}

// Mock ethers: replace Contract + Interface with test doubles; keep pure utilities.
vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  const HALF_ETH = 500000000000000000n; // 0.5 ether in wei — defined inside factory to avoid hoisting

  // Agreement mock tuple: [payer, payee, proposer, amount, deadline, claimedAt, status, termsCid]
  const MOCK_AGREEMENT = [
    "0xPaYeR000000000000000000000000000000000001",       // payer
    "0xPaYeE000000000000000000000000000000000002",       // payee
    "0xPrOpOsEr0000000000000000000000000000000003",      // proposer (NEW)
    HALF_ETH,
    BigInt(Math.floor(Date.now() / 1000) + 86400),
    0n,
    2,                                                   // status: Funded under new enum
    "delivery terms",
  ];

  class FakeContract {
    target: string;
    constructor(addr: string, _abi: any, _runner: any) {
      this.target = addr;
    }
    async nextId() { return 3n; }
    async getAgreement(_id: any) { return MOCK_AGREEMENT; }
    async proposeAgreement(..._args: any[]) {
      return { wait: async () => ({ hash: "0xabc", logs: [{ topics: [], data: "0x" }] }) };
    }
    async acceptAgreement(..._args: any[]) {
      return { wait: async () => ({ hash: "0xaccept" }) };
    }
    async revokeProposal(..._args: any[]) {
      return { wait: async () => ({ hash: "0xrevoke" }) };
    }
    async fundAgreement(..._args: any[]) {
      return { wait: async () => ({ hash: "0xfund", logs: [] }) };
    }
    async releasePayment(..._args: any[]) {
      return { wait: async () => ({ hash: "0xrelease", logs: [] }) };
    }
    async claimAfterDeadline(..._args: any[]) {
      return { wait: async () => ({ hash: "0xclaim", logs: [] }) };
    }
    async finalizeClaim(..._args: any[]) {
      return { wait: async () => ({ hash: "0xfinalize", logs: [] }) };
    }
    async BASE_FEE() { return 10000000000000000n; }
    async fileCase(..._args: any[]) {
      return { wait: async () => ({ hash: "0xfile", logs: [] }) };
    }
  }

  // FakeInterface always returns AgreementProposed(id=7n) so handleProposeContract succeeds.
  class FakeInterface {
    constructor(_abi: any) {}
    parseLog(_log: any) {
      return { name: "AgreementProposed", args: { id: 7n } };
    }
  }

  // Build a patched ethers namespace (used as `import { ethers } from "ethers"`).
  const patchedEthers = {
    ...actual.ethers,
    Contract: FakeContract,
    Interface: FakeInterface,
  };

  return {
    ...actual,
    ethers: patchedEthers,
    // Also patch named exports in case of direct destructuring elsewhere.
    Contract: FakeContract,
    Interface: FakeInterface,
  };
});

describe("handleProposeContract", () => {
  it("returns wrapped view with txHash and nextActions for Funded state", async () => {
    const ctx = makeCtx();
    const out = await handleProposeContract(ctx, {
      payerInput: "0xPaYeR000000000000000000000000000000000001",
      payeeInput: "0xPaYeE000000000000000000000000000000000002",
      amount: "0.5",
      deadline: "in 1 day",
      terms: "delivery",
    });
    const parsed = JSON.parse(out);
    expect(parsed.result.id).toBe("7");
    expect(parsed.result.statusLabel).toBe("Funded");
    expect(parsed.result.amountOg).toBe("0.5");
    expect(parsed.result.txHash).toBe("0xabc");
    expect(parsed.result.proposer).toBe("0xPrOpOsEr0000000000000000000000000000000003");
    expect(parsed.nextActions.join(" ")).toMatch(/release|claim|dispute/i);
  });
});

describe("handleFundContract / handleGetContract / handleListMyContracts", () => {
  it("fund returns updated view", async () => {
    const ctx = makeCtx();
    const out = await handleFundContract(ctx, { contractId: "1" });
    const parsed = JSON.parse(out);
    expect(parsed.result.statusLabel).toBe("Funded");
    expect(parsed.result.txHash).toBe("0xfund");
  });
  it("get returns view", async () => {
    const ctx = makeCtx();
    const parsed = JSON.parse(await handleGetContract(ctx, { contractId: "1" }));
    expect(parsed.result.id).toBe("1");
  });
  it("list filters by my address (none, since wallet isn't a party in mock)", async () => {
    const ctx = makeCtx();
    const parsed = JSON.parse(await handleListMyContracts(ctx));
    expect(parsed.result).toEqual([]);
    expect(parsed.summary).toMatch(/0 contract/);
  });
});

describe("handleAcceptContract / handleRevokeContract", () => {
  it("accept returns updated view with txHash", async () => {
    const ctx = makeCtx();
    const out = await handleAcceptContract(ctx, { contractId: "1" });
    const parsed = JSON.parse(out);
    expect(parsed.result.id).toBe("1");
    expect(parsed.result.txHash).toBeTruthy();
  });
  it("revoke returns updated view with txHash", async () => {
    const ctx = makeCtx();
    const out = await handleRevokeContract(ctx, { contractId: "1" });
    const parsed = JSON.parse(out);
    expect(parsed.result.id).toBe("1");
    expect(parsed.result.txHash).toBeTruthy();
  });
});
