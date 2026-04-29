# MCP-First Identity, ENS Auto-Naming, and Case-Filing Fee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace operator-signed case filing with an MCP-server-driven flow where AI agents sign their own transactions, drop on-chain string names in favor of address-keyed roles, auto-publish `<adjective>-<noun>.tribunal.eth` ENS subnames on Sepolia, and charge a base fee on `fileCase`.

**Architecture:** Contracts speak addresses only. `AgentRegistry` becomes a role table (`None | Lawyer | Judge`, owner-admitted). `TribunalCore.fileCase` is `payable` with a `BASE_FEE` and `msg.sender == accuser`. A new stdio MCP server (`mcp/`) holds the agent's key locally and exposes signed tools (`tribunal_whoami`, `tribunal_file_case`, ...). The web `POST /api/cases` becomes a raw-tx relay; new identity endpoints (`/api/identity/whoami`, `/api/identity/resolve`) handle SIWE verification and Sepolia ENS subname publication via the existing `publishAgentEnsRecords`. The web UI is read-only.

**Tech Stack:** Solidity 0.8.27 / Hardhat / OpenZeppelin Ownable; ethers v6; TypeScript / Vitest; Next.js 14 App Router; viem (Sepolia ENS); `@modelcontextprotocol/sdk`; iron-session NOT needed (stateless).

**Spec:** `docs/superpowers/specs/2026-04-30-mcp-identity-design.md`

---

## Phase A — Contracts: registry rewrite, fee, role gating

### Task 1: Rewrite `AgentRegistry` as a role table

**Files:**
- Modify: `contracts/src/AgentRegistry.sol`
- Test:   `contracts/test/AgentRegistry.test.ts`

- [ ] **Step 1: Replace `AgentRegistry.test.ts` with new failing tests**

```ts
// contracts/test/AgentRegistry.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentRegistry", () => {
  async function deployed() {
    const [owner, judge, lawyer, other] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("AgentRegistry"))
      .connect(owner).deploy();
    await reg.waitForDeployment();
    return { reg, owner, judge, lawyer, other };
  }

  it("defaults to roleOf == None for unknown addresses", async () => {
    const { reg, other } = await deployed();
    expect(await reg.roleOf(await other.getAddress())).to.equal(0n);
  });

  it("admits a judge and emits RoleAdmitted", async () => {
    const { reg, owner, judge } = await deployed();
    const addr = await judge.getAddress();
    await expect(reg.connect(owner).admitJudge(addr))
      .to.emit(reg, "RoleAdmitted").withArgs(addr, 2n); // Role.Judge = 2
    expect(await reg.roleOf(addr)).to.equal(2n);
  });

  it("admits a lawyer and emits RoleAdmitted", async () => {
    const { reg, owner, lawyer } = await deployed();
    const addr = await lawyer.getAddress();
    await expect(reg.connect(owner).admitLawyer(addr))
      .to.emit(reg, "RoleAdmitted").withArgs(addr, 1n); // Role.Lawyer = 1
    expect(await reg.roleOf(addr)).to.equal(1n);
  });

  it("rejects admitJudge from non-owner", async () => {
    const { reg, judge, other } = await deployed();
    await expect(
      reg.connect(other).admitJudge(await judge.getAddress()),
    ).to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
  });

  it("rejects admitLawyer from non-owner", async () => {
    const { reg, lawyer, other } = await deployed();
    await expect(
      reg.connect(other).admitLawyer(await lawyer.getAddress()),
    ).to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
  });

  it("revokes a role and emits RoleRevoked with previous value", async () => {
    const { reg, owner, judge } = await deployed();
    const addr = await judge.getAddress();
    await reg.connect(owner).admitJudge(addr);
    await expect(reg.connect(owner).revoke(addr))
      .to.emit(reg, "RoleRevoked").withArgs(addr, 2n); // previous Judge
    expect(await reg.roleOf(addr)).to.equal(0n);
  });

  it("rejects revoke from non-owner", async () => {
    const { reg, owner, judge, other } = await deployed();
    await reg.connect(owner).admitJudge(await judge.getAddress());
    await expect(
      reg.connect(other).revoke(await judge.getAddress()),
    ).to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd contracts && npx hardhat test test/AgentRegistry.test.ts`
Expected: All 7 tests fail (old contract still in place — no `roleOf`, `admitJudge`, etc.).

- [ ] **Step 3: Replace `AgentRegistry.sol` with the role-table version**

```solidity
// contracts/src/AgentRegistry.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry
/// @notice Address-keyed role table for Tribunal participants.
///         Litigants are not stored — anyone with a wallet may file as a litigant.
contract AgentRegistry is Ownable {
    enum Role { None, Lawyer, Judge }

    mapping(address => Role) public roleOf;

    event RoleAdmitted(address indexed who, Role role);
    event RoleRevoked(address indexed who, Role previous);

    constructor() Ownable(msg.sender) {}

    function admitJudge(address who) external onlyOwner {
        roleOf[who] = Role.Judge;
        emit RoleAdmitted(who, Role.Judge);
    }

    function admitLawyer(address who) external onlyOwner {
        roleOf[who] = Role.Lawyer;
        emit RoleAdmitted(who, Role.Lawyer);
    }

    function revoke(address who) external onlyOwner {
        Role prev = roleOf[who];
        roleOf[who] = Role.None;
        emit RoleRevoked(who, prev);
    }
}
```

- [ ] **Step 4: Compile and run tests**

Run: `cd contracts && npx hardhat compile && npx hardhat test test/AgentRegistry.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/AgentRegistry.sol contracts/test/AgentRegistry.test.ts
git commit -m "feat(registry): rewrite AgentRegistry as address-keyed role table"
```

---

### Task 2: Update `ITribunal` interface for address-based events and payable fileCase

**Files:**
- Modify: `contracts/src/interfaces/ITribunal.sol`

- [ ] **Step 1: Replace the interface with the new event+function shape**

```solidity
// contracts/src/interfaces/ITribunal.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITribunal {
    enum CaseStatus { None, Filed, Accepted, Arguments, Deliberation, Ruled, Settled }

    event CaseFiled(
        uint256 indexed caseId,
        address indexed accuser,
        address indexed defendant,
        address escrowAdapter,
        uint256 escrowId,
        string  accusationCid,
        uint256 fee
    );
    event CaseAccepted(uint256 indexed caseId, address[] judges);
    event CaseEvent(uint256 indexed caseId, uint256 indexed seq, address indexed sender, bytes32 contentHash);
    event RulingSubmitted(uint256 indexed caseId, address indexed judge, bool prevailingIsAccuser, bytes32 opinionHash);
    event CaseRuled(uint256 indexed caseId, bool prevailingIsAccuser);

    function fileCase(
        address defendant,
        address escrowAdapter,
        uint256 escrowId,
        string calldata accusationCid
    ) external payable returns (uint256 caseId);
}
```

- [ ] **Step 2: Run compile to check downstream references**

Run: `cd contracts && npx hardhat compile`
Expected: Fails — `TribunalCore.sol` still implements the old interface. This is expected; Task 3 fixes it.

- [ ] **Step 3: Commit (interface change only)**

```bash
git add contracts/src/interfaces/ITribunal.sol
git commit -m "feat(tribunal): switch ITribunal events and fileCase to addresses + payable"
```

---

### Task 3: Modify `TribunalCore` — payable `fileCase` with fee, address-based panel, role gating

**Files:**
- Modify: `contracts/src/TribunalCore.sol`
- Modify: `contracts/test/TribunalCore.test.ts`

- [ ] **Step 1: Replace `TribunalCore.test.ts` with the new failing tests**

```ts
// contracts/test/TribunalCore.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";

const BASE_FEE = ethers.parseEther("0.01");

async function setup() {
  const [owner, accuser, defendant, j1, j2, j3, lawyer, stranger] =
    await ethers.getSigners();

  const reg = await (await ethers.getContractFactory("AgentRegistry"))
    .connect(owner).deploy();
  const tc = await (await ethers.getContractFactory("TribunalCore"))
    .connect(owner).deploy(await reg.getAddress());

  await reg.connect(owner).admitJudge(await j1.getAddress());
  await reg.connect(owner).admitJudge(await j2.getAddress());
  await reg.connect(owner).admitJudge(await j3.getAddress());
  await reg.connect(owner).admitLawyer(await lawyer.getAddress());

  return { tc, reg, owner, accuser, defendant, j1, j2, j3, lawyer, stranger };
}

describe("TribunalCore", () => {
  it("files a case when value >= BASE_FEE; CaseFiled has accuser address", async () => {
    const { tc, accuser, defendant } = await setup();
    const tx = await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "ipfs://x",
      { value: BASE_FEE },
    );
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l) => { try { return tc.interface.parseLog(l as any); } catch { return null; } })
      .find((e) => e?.name === "CaseFiled");
    expect(ev!.args.caseId).to.equal(1n);
    expect(ev!.args.accuser).to.equal(await accuser.getAddress());
    expect(ev!.args.defendant).to.equal(await defendant.getAddress());
    expect(ev!.args.fee).to.equal(BASE_FEE);
    expect(await tc.feesAccrued()).to.equal(BASE_FEE);
  });

  it("reverts fileCase when value < BASE_FEE", async () => {
    const { tc, accuser, defendant } = await setup();
    await expect(
      tc.connect(accuser).fileCase(
        await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
        { value: BASE_FEE - 1n },
      ),
    ).to.be.revertedWith("fee");
  });

  it("accepts a panel of judge addresses; transitions to Arguments", async () => {
    const { tc, owner, accuser, defendant, j1, j2, j3 } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    const judges = [await j1.getAddress(), await j2.getAddress(), await j3.getAddress()];
    await tc.connect(owner).acceptCase(1, judges, 2);
    expect(await tc.caseStatus(1)).to.equal(3n);
    expect(await tc.caseJudges(1)).to.deep.equal(judges);
  });

  it("rejects acceptCase if any panel address lacks Judge role", async () => {
    const { tc, owner, accuser, defendant, j1, stranger } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await expect(
      tc.connect(owner).acceptCase(
        1,
        [await j1.getAddress(), await stranger.getAddress()],
        1,
      ),
    ).to.be.revertedWith("not a judge");
  });

  it("submitRuling rejected if signer not on panel", async () => {
    const { tc, owner, accuser, defendant, j1, j2, stranger } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await tc.connect(owner).acceptCase(
      1, [await j1.getAddress(), await j2.getAddress()], 2,
    );
    await expect(
      tc.connect(stranger).submitRuling(1, true, ethers.id("op")),
    ).to.be.revertedWith("not a panel judge");
  });

  it("computes majority once threshold met", async () => {
    const { tc, owner, accuser, defendant, j1, j2, j3 } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await tc.connect(owner).acceptCase(
      1,
      [await j1.getAddress(), await j2.getAddress(), await j3.getAddress()],
      2,
    );
    await tc.connect(j1).submitRuling(1, true,  ethers.id("a"));
    await tc.connect(j2).submitRuling(1, false, ethers.id("b"));
    await tc.connect(j3).submitRuling(1, true,  ethers.id("c"));
    expect(await tc.caseStatus(1)).to.equal(5n);
    expect(await tc.casePrevailing(1)).to.equal(true);
  });

  it("withdrawFees is onlyOwner and transfers full feesAccrued", async () => {
    const { tc, owner, accuser, defendant, stranger } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await expect(
      tc.connect(stranger).withdrawFees(await stranger.getAddress()),
    ).to.be.revertedWithCustomError(tc, "OwnableUnauthorizedAccount");
    const recipient = await stranger.getAddress();
    const before = await ethers.provider.getBalance(recipient);
    await tc.connect(owner).withdrawFees(recipient);
    const after = await ethers.provider.getBalance(recipient);
    expect(after - before).to.equal(BASE_FEE);
    expect(await tc.feesAccrued()).to.equal(0n);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd contracts && npx hardhat test test/TribunalCore.test.ts`
Expected: All tests fail (`fileCase` not payable; old signature; no `feesAccrued`; etc.).

- [ ] **Step 3: Rewrite `TribunalCore.sol` for the new signature, fee, role gating**

```solidity
// contracts/src/TribunalCore.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ITribunal } from "./interfaces/ITribunal.sol";

interface IRegistry {
    enum Role { None, Lawyer, Judge }
    function roleOf(address) external view returns (Role);
}

interface IEscrow {
    function flagDisputed(uint256 id) external;
}

interface IVerdictLog {
    function post(uint256 caseId, bool prevailingIsAccuser, bytes32 opinionRoot) external;
}

/// @title TribunalCore
/// @notice Case state machine. Address-keyed parties, payable fileCase with
///         BASE_FEE, role-gated argument and ruling submission.
contract TribunalCore is ITribunal, Ownable {
    IRegistry public immutable registry;
    address public immutable runner; // operator that anchors events; restricted in MVP

    uint256 public constant BASE_FEE = 0.01 ether;
    uint256 public feesAccrued;

    struct Case {
        CaseStatus status;
        address accuser;
        address defendant;
        address escrowAdapter;
        uint256 escrowId;
        address[] judges;
        uint256 threshold;
        uint256 yes;
        uint256 no;
        uint256 nextSeq;
        bool    prevailingIsAccuser;
    }

    uint256 public nextCaseId = 1;
    mapping(uint256 => Case) private cases;
    mapping(uint256 => mapping(address => bool)) public hasRuled;

    constructor(address registry_) Ownable(msg.sender) {
        require(registry_ != address(0), "zero registry");
        registry = IRegistry(registry_);
        runner = msg.sender;
    }

    modifier onlyRunner() { require(msg.sender == runner, "not runner"); _; }

    function fileCase(
        address defendant,
        address escrowAdapter,
        uint256 escrowId,
        string calldata accusationCid
    ) external payable override returns (uint256 id) {
        require(msg.value >= BASE_FEE, "fee");
        feesAccrued += msg.value;

        id = nextCaseId++;
        Case storage c = cases[id];
        c.status = CaseStatus.Filed;
        c.accuser = msg.sender;
        c.defendant = defendant;
        c.escrowAdapter = escrowAdapter;
        c.escrowId = escrowId;
        if (escrowAdapter != address(0)) IEscrow(escrowAdapter).flagDisputed(escrowId);
        emit CaseFiled(id, msg.sender, defendant, escrowAdapter, escrowId, accusationCid, msg.value);
    }

    function acceptCase(uint256 id, address[] calldata judges, uint256 threshold) external onlyOwner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Filed, "bad state");
        require(judges.length > 0 && threshold > 0 && threshold <= judges.length, "bad panel");
        for (uint256 i = 0; i < judges.length; i++) {
            require(registry.roleOf(judges[i]) == IRegistry.Role.Judge, "not a judge");
        }
        c.judges = judges;
        c.threshold = threshold;
        c.status = CaseStatus.Arguments;
        emit CaseAccepted(id, judges);
    }

    function recordEvent(uint256 id, bytes32 contentHash) external onlyRunner {
        Case storage c = cases[id];
        require(uint8(c.status) >= uint8(CaseStatus.Filed) && c.status != CaseStatus.Settled, "bad state");
        c.nextSeq += 1;
        emit CaseEvent(id, c.nextSeq, msg.sender, contentHash);
    }

    function submitRuling(uint256 id, bool prevailingIsAccuser, bytes32 opinionHash) external {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Arguments || c.status == CaseStatus.Deliberation, "bad state");
        require(registry.roleOf(msg.sender) == IRegistry.Role.Judge, "not a judge");

        bool onPanel = false;
        for (uint256 i = 0; i < c.judges.length; i++) {
            if (c.judges[i] == msg.sender) { onPanel = true; break; }
        }
        require(onPanel, "not a panel judge");
        require(!hasRuled[id][msg.sender], "double vote");
        hasRuled[id][msg.sender] = true;

        if (prevailingIsAccuser) c.yes += 1; else c.no += 1;
        emit RulingSubmitted(id, msg.sender, prevailingIsAccuser, opinionHash);

        if (c.yes >= c.threshold || c.no >= c.threshold) {
            c.status = CaseStatus.Ruled;
            c.prevailingIsAccuser = c.yes >= c.threshold;
            emit CaseRuled(id, c.prevailingIsAccuser);
        }
    }

    function markSettled(uint256 id) external onlyRunner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Ruled, "not ruled");
        c.status = CaseStatus.Settled;
    }

    function finalizeVerdict(uint256 id, address verdictLog, bytes32 opinionRoot) external onlyRunner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Ruled, "not ruled");
        IVerdictLog(verdictLog).post(id, c.prevailingIsAccuser, opinionRoot);
        c.status = CaseStatus.Settled;
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 amount = feesAccrued;
        feesAccrued = 0;
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "transfer failed");
    }

    // ---- views ----
    function caseStatus(uint256 id) external view returns (CaseStatus) { return cases[id].status; }
    function caseJudges(uint256 id) external view returns (address[] memory) { return cases[id].judges; }
    function caseThreshold(uint256 id) external view returns (uint256) { return cases[id].threshold; }
    function casePrevailing(uint256 id) external view returns (bool) { return cases[id].prevailingIsAccuser; }
    function caseAccuser(uint256 id) external view returns (address) { return cases[id].accuser; }
    function caseDefendant(uint256 id) external view returns (address) { return cases[id].defendant; }
    function caseEscrow(uint256 id) external view returns (address, uint256) {
        return (cases[id].escrowAdapter, cases[id].escrowId);
    }
    function caseSeq(uint256 id) external view returns (uint256) { return cases[id].nextSeq; }
}
```

- [ ] **Step 4: Compile and run TribunalCore tests**

Run: `cd contracts && npx hardhat compile && npx hardhat test test/TribunalCore.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/TribunalCore.sol contracts/test/TribunalCore.test.ts
git commit -m "feat(tribunal): payable fileCase with BASE_FEE, role-gated rulings, address-keyed panel"
```

---

### Task 4: Sweep remaining contract test files for old API references

**Files:**
- Modify: `contracts/test/EscrowAdapter.test.ts`
- Modify: `contracts/test/JudgeINFT.test.ts`
- Modify: `contracts/test/VerdictLog.test.ts`

- [ ] **Step 1: Run all contract tests; capture failing ones**

Run: `cd contracts && npx hardhat test`
Expected: Some tests in `EscrowAdapter.test.ts` (previously called `register("alice.tribunal.eth", "litigant")`) now fail to compile or fail at runtime.

- [ ] **Step 2: Update each failing test**

For any test that calls `reg.register(...)`, replace with the new admit-based setup. The failing tests in `EscrowAdapter.test.ts` likely set up parties via `register`; switch to using raw signer addresses (no registration needed for litigants) and admit judges/lawyers via `reg.admitJudge(...)` / `reg.admitLawyer(...)`. For any test that calls `tc.fileCase(uint256, uint256, ...)`, change to `tc.fileCase(address, address, ..., {value: BASE_FEE})`. For any reference to `tc.connect(runner).acceptCase(...)`, leave as-is (the contract's `onlyOwner` check still passes since `runner == owner == deployer == default signer 0`).

If `JudgeINFT.test.ts` or `VerdictLog.test.ts` only test those contracts in isolation and never touch `AgentRegistry` or `TribunalCore.fileCase`, they likely need no changes — but verify by running them.

- [ ] **Step 3: Run full contract suite**

Run: `cd contracts && npx hardhat test`
Expected: All previous tests pass plus the new ones (target: `>= 27 passing`).

- [ ] **Step 4: Commit**

```bash
git add contracts/test/
git commit -m "test(contracts): align EscrowAdapter / JudgeINFT / VerdictLog tests with new APIs"
```

---

## Phase B — Deploy script and on-chain redeploy

### Task 5: Update `scripts/deploy.ts` to call admit functions

**Files:**
- Modify: `contracts/scripts/deploy.ts`
- Modify: `.env.example`

- [ ] **Step 1: Read the current deploy script**

Run: `cat contracts/scripts/deploy.ts`
Identify where `TribunalCore` and `AgentRegistry` are deployed and where addresses are written to `docs/deployment.json`.

- [ ] **Step 2: Add admit calls and judge/lawyer address resolution**

Insert immediately after `AgentRegistry` deploys, before the address-write step:

```ts
// Admit judges and lawyers from env. Empty / missing values are skipped so the
// script stays usable with a partial setup.
function envList(key: string): string[] {
  return (process.env[key] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s));
}

const judgeAddrs  = envList("JUDGE_ADDRESSES");
const lawyerAddrs = envList("LAWYER_ADDRESSES");

for (const a of judgeAddrs) {
  const tx = await (registry.connect(deployer) as any).admitJudge(a);
  await tx.wait();
  console.log("admitted judge:", a);
}
for (const a of lawyerAddrs) {
  const tx = await (registry.connect(deployer) as any).admitLawyer(a);
  await tx.wait();
  console.log("admitted lawyer:", a);
}
```

The `deployer` variable is the script's signer; if the existing script uses a different name (e.g. `signer`, `wallet`), use that.

- [ ] **Step 3: Add env entries to `.env.example`**

Append to `.env.example`:

```env
# Comma-separated EVM addresses to admit on deploy. Optional but the demo
# expects at least JUDGE_ADDRESSES populated so submitRuling works.
JUDGE_ADDRESSES=0x...,0x...,0x...
LAWYER_ADDRESSES=0x...,0x...
```

- [ ] **Step 4: Compile and dry-run on local hardhat node**

Run:
```bash
cd contracts
npx hardhat compile
JUDGE_ADDRESSES=0x70997970C51812dc3A010C7d01b50e0d17dc79C8,0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
LAWYER_ADDRESSES=0x90F79bf6EB2c4f870365E785982E1f101E93b906 \
npx hardhat run scripts/deploy.ts --network hardhat
```

Expected: Script logs `admitted judge:` lines and writes `docs/deployment.json`. (Hardhat's in-process network resets after the script ends; this is just a smoke test.)

- [ ] **Step 5: Commit**

```bash
git add contracts/scripts/deploy.ts .env.example
git commit -m "feat(deploy): admit judges and lawyers from env on deploy"
```

---

### Task 6: Redeploy contracts on 0G Galileo testnet

**Files:**
- Modify: `docs/deployment.json` (auto-written by script)

- [ ] **Step 1: Confirm `.env` has `OG_RPC_URL`, `OG_PRIVATE_KEY`, `JUDGE_ADDRESSES`, `LAWYER_ADDRESSES`**

Run: `grep -E "^(OG_RPC_URL|OG_PRIVATE_KEY|JUDGE_ADDRESSES|LAWYER_ADDRESSES)=" .env`
Expected: All four lines populated.

- [ ] **Step 2: Deploy to 0G**

Run: `cd contracts && npm run deploy:0g`
Expected: Logs each contract deploy + admit lines + writes `docs/deployment.json` with `chains.ogGalileo.contracts` populated.

- [ ] **Step 3: Verify deployment file**

Run: `cat docs/deployment.json | grep -A 8 '"ogGalileo"'`
Expected: Five contract addresses present (`AgentRegistry`, `TribunalCore`, `EscrowAdapter`, `VerdictLog`, `JudgeINFT`).

- [ ] **Step 4: Commit deployment**

```bash
git add docs/deployment.json
git commit -m "chore(deploy): redeploy contracts on 0G Galileo with new ABIs"
```

---

## Phase C — Agents runtime: drop agent-IDs, switch to addresses

### Task 7: Update `tribunal-client.ts` and the runner for address-based contract calls

**Files:**
- Modify: `agents/src/chain/tribunal-client.ts`
- Modify: `agents/src/runner.ts`

- [ ] **Step 1: Update `TribunalContracts` and `TribunalClient` to use addresses**

In `agents/src/chain/tribunal-client.ts`, change `acceptCase` arg type from `bigint[]` to `string[]`:

```ts
// in TribunalContracts.tribunalCore:
acceptCase: (caseId: bigint, judges: string[], threshold: bigint) => Promise<TxLike>;

// in TribunalClient:
acceptCase(caseId: bigint, judges: string[], threshold: bigint): Promise<void>;

// in createTribunalClient:
async acceptCase(caseId, judges, threshold) {
  const tx = await deps.tribunalCore.acceptCase(caseId, judges, threshold);
  await tx.wait();
},
```

(`appendJudgeMemory` and other methods are unchanged.)

- [ ] **Step 2: Update `agents/src/runner.ts` to drop `ensureRegistered` and agent-id usage**

Replace the agent-resolution block (currently:
```
const accuserId   = await ensureRegistered(registry, "alice.tribunal.eth",        "litigant");
const defendantId = await ensureRegistered(registry, "bob.tribunal.eth",          "litigant");
const judgeAgentId= await ensureRegistered(registry, "judge-athena.tribunal.eth", "judge");
```
) with:

```ts
// New address-based identities. The runner is the operator + clerk; the judge
// signer remains a separate wallet (existing JUDGE_PRIVATE_KEY env). For
// litigants we don't pre-register anything — the runner only needs their
// addresses, which arrive via the CaseFiled event.
const judgeAddress = baseJudge.address;
console.log("Judge address:", judgeAddress);
```

Drop the `ensureRegistered` helper (no longer needed). Update the `CaseFiled` event handlers (replay + subscribe) to read `accuser` / `defendant` as addresses, not bigints. Replace the `runCase` signature:

```ts
async function runCase(
  caseId: bigint,
  accuser: string,    // was accuserAgentId: bigint
  defendant: string,  // was defendantAgentId: bigint
  accusationCid: string,
): Promise<void> { ... }
```

Inside `runCase`, drop the `registry.agents(...)` calls. The accuser / defendant ENS names previously rendered by the runner (`accuserEns`, `defendantEns`) are no longer on-chain — fetch them via the new web identity API:

```ts
async function resolveEns(addr: string): Promise<string> {
  const url = process.env.TRIBUNAL_BACKEND_URL ?? "http://127.0.0.1:3000";
  try {
    const res = await fetch(`${url}/api/identity/resolve?address=${addr}`);
    if (!res.ok) return addr;
    const j = (await res.json()) as { ensName?: string };
    return j.ensName ?? addr;
  } catch { return addr; }
}
const accuserEns   = await resolveEns(accuser);
const defendantEns = await resolveEns(defendant);
```

Update `tribunal.acceptCase` call to pass `[judgeAddress]` instead of `[judgeAgentId]`. Update the `enqueue` call sites to pass `accuser`/`defendant` (positions `args[1]` and `args[2]` from the CaseFiled event).

Drop the now-unused `ensureRegistered` function definition.

- [ ] **Step 3: Build agents and verify type-check passes**

Run: `cd agents && npm run build`
Expected: Builds clean. If type errors arise (e.g. role files like `judge.ts` still expect a `judgeId: bigint`), fix them: judges are now identified by the **address** for `submitRuling` and by **iNFT tokenId** for `appendRulingMemory` (already separate concepts).

- [ ] **Step 4: Run agent unit tests**

Run: `cd agents && npm test`
Expected: All existing tests pass (the agents tests don't touch the registry's name-keyed methods directly — they mock the tribunal client). If any test references the old `ensureRegistered` or `acceptCase(bigint[])` shape, fix inline.

- [ ] **Step 5: Commit**

```bash
git add agents/src/chain/tribunal-client.ts agents/src/runner.ts agents/src/
git commit -m "feat(agents): switch runner + tribunal-client to address-based parties"
```

---

## Phase D — Web backend: ENS auto-naming, identity API, raw-tx relay

### Task 8: Add the wordlist module

**Files:**
- Create: `web/lib/wordlist.ts`
- Test:   `web/lib/wordlist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/wordlist.test.ts
import { describe, it, expect } from "vitest";
import { ADJECTIVES, NOUNS, deriveCandidate } from "./wordlist";

describe("wordlist", () => {
  it("has at least 200 adjectives and 200 nouns, lowercase, no numbers, no hyphens", () => {
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(200);
    expect(NOUNS.length).toBeGreaterThanOrEqual(200);
    for (const w of [...ADJECTIVES, ...NOUNS]) {
      expect(w).toMatch(/^[a-z]+$/);
    }
  });

  it("deriveCandidate is deterministic for the same address+seed", () => {
    const a = "0x1111111111111111111111111111111111111111";
    expect(deriveCandidate(a, 0)).toEqual(deriveCandidate(a, 0));
  });

  it("deriveCandidate differs across collision attempts", () => {
    const a = "0x2222222222222222222222222222222222222222";
    expect(deriveCandidate(a, 0)).not.toEqual(deriveCandidate(a, 1));
  });

  it("returns adjective-noun joined by hyphen", () => {
    const c = deriveCandidate("0x3333333333333333333333333333333333333333", 0);
    expect(c).toMatch(/^[a-z]+-[a-z]+$/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run lib/wordlist.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `wordlist.ts`**

```ts
// web/lib/wordlist.ts
import { keccak256, toUtf8Bytes } from "ethers";

export const ADJECTIVES: string[] = [
  "stoic","loyal","wry","calm","brisk","keen","steady","quick","quiet","bold",
  "wise","bright","gentle","fierce","stern","kind","stark","plain","jolly","grave",
  "humble","noble","proud","weary","witty","clever","mellow","frank","dapper","crisp",
  "vivid","modest","earnest","ardent","candid","stoutest","prudent","docile","austere","placid",
  "tranquil","serene","amber","azure","crimson","emerald","ivory","jade","ochre","russet",
  "scarlet","silver","tawny","umber","violet","cerulean","moss","pearl","slate","sage",
  "marigold","copper","golden","fawn","auburn","beech","birch","cedar","oaken","piney",
  "mossy","sandy","stoneworn","mountain","valley","forest","meadow","prairie","desert","tundra",
  "alpine","coastal","tidal","glacial","ember","frosty","sunlit","moonlit","starlit","rainy",
  "windy","stormy","placeless","timeless","steadfast","earnestly","faithful","stalwart","wary","vigilant",
  "hardy","spry","lithe","agile","nimble","graceful","fluid","supple","sinewy","wiry",
  "burly","hulking","towering","stately","regal","courtly","august","grand","lofty","sublime",
  "fervent","zealous","dauntless","valiant","gallant","intrepid","plucky","resolute","indomitable","tenacious",
  "scholarly","studious","bookish","erudite","learned","curious","inquisitive","probing","searching","seeking",
  "tactful","subtle","nuanced","measured","poised","composed","collected","unhurried","patient","forbearing",
  "merry","blithe","cheery","sunny","bubbly","perky","peppy","spirited","lively","exuberant",
  "thoughtful","reflective","pensive","contemplative","musing","meditative","brooding","wistful","yearning","longing",
  "obstinate","stubborn","headstrong","willful","rigid","unbending","adamant","unyielding","insistent","persistent",
  "candidly","openly","plainly","simply","truly","honestly","sincerely","frankly","forthright","direct",
  "wandering","roaming","roving","drifting","seeking","searching","exploring","journeying","wayfaring","nomadic",
  "ancient","aged","weathered","timeworn","seasoned","matured","ripened","mellowed","veteran","gnarled",
  "secret","hidden","veiled","cloaked","shrouded","mystic","arcane","occult","esoteric","cryptic",
  "earthen","clay","loamy","rocky","sandy","gravel","peaty","silty","fertile","barren",
  "feral","untamed","wild","free","unbridled","unfettered","unbound","liberated","sovereign","autonomous",
  "lucent","luminous","radiant","glowing","shining","beaming","gleaming","glistening","sparkling","twinkling",
  "patient","careful","thorough","meticulous","exacting","precise","accurate","rigorous","painstaking","punctilious",
];

export const NOUNS: string[] = [
  "falcon","ibis","walrus","oak","heron","kestrel","otter","stag","badger","raven",
  "lynx","fox","wolf","bear","hawk","owl","eagle","sparrow","swan","crane",
  "hare","mole","ferret","stoat","weasel","marten","beaver","mink","puma","cougar",
  "ocelot","jaguar","leopard","panther","tiger","lion","cheetah","caracal","serval","margay",
  "buck","doe","fawn","ram","ewe","mare","stallion","colt","filly","gelding",
  "cedar","pine","fir","spruce","yew","beech","birch","aspen","maple","willow",
  "ash","elm","hickory","linden","poplar","alder","hazel","rowan","hawthorn","blackthorn",
  "ivy","fern","moss","lichen","reed","sedge","rush","marsh","meadow","heath",
  "brook","creek","river","stream","pond","lake","tarn","fjord","cove","inlet",
  "bay","strait","sound","gulf","harbor","port","quay","wharf","jetty","pier",
  "ridge","peak","crag","cliff","bluff","mesa","butte","plateau","plain","steppe",
  "valley","glen","gorge","canyon","ravine","gully","hollow","dell","dale","downs",
  "fox","badger","mink","stoat","ferret","stoatling","mongoose","civet","genet","quoll",
  "puffin","tern","gull","skua","albatross","shearwater","petrel","cormorant","loon","grebe",
  "robin","wren","finch","thrush","starling","sparrow","jay","magpie","crow","rook",
  "linnet","goldfinch","greenfinch","bullfinch","chaffinch","siskin","redpoll","crossbill","grosbeak","tanager",
  "cricket","dragonfly","damselfly","mantis","beetle","moth","butterfly","bee","wasp","hornet",
  "trout","salmon","perch","bass","carp","pike","tench","roach","dace","gudgeon",
  "compass","lantern","beacon","kindling","ember","torch","pyre","forge","anvil","hammer",
  "scribe","quill","parchment","scroll","tome","ledger","manifest","codex","atlas","almanac",
  "skiff","sloop","ketch","schooner","cutter","yawl","barque","brig","frigate","corvette",
  "cairn","menhir","dolmen","tumulus","barrow","monolith","obelisk","arch","plinth","pedestal",
  "sage","scholar","wanderer","pilgrim","herald","minstrel","bard","fable","sonnet","anthem",
  "watcher","seeker","keeper","warden","steward","provost","verger","bailiff","reeve","beadle",
  "shadow","silhouette","outline","contour","margin","border","threshold","frontier","horizon","skyline",
  "ledger","tally","docket","register","schedule","manifest","minute","memo","record","archive",
];

export function deriveCandidate(address: string, attempt: number): string {
  const lower = address.toLowerCase();
  let seed = keccak256(toUtf8Bytes(`${lower}:${attempt}`));
  // Use first 4 bytes for adj index, next 4 for noun index.
  const adjIdx = Number(BigInt("0x" + seed.slice(2, 10)) % BigInt(ADJECTIVES.length));
  const nounIdx = Number(BigInt("0x" + seed.slice(10, 18)) % BigInt(NOUNS.length));
  return `${ADJECTIVES[adjIdx]}-${NOUNS[nounIdx]}`;
}
```

(If the wordlist counts come up short of 200 due to dedup, pad with more curated entries until the test passes. No numbers, no hyphens, lowercase only.)

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run lib/wordlist.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/wordlist.ts web/lib/wordlist.test.ts
git commit -m "feat(web): wordlist + deterministic candidate derivation for ENS auto-names"
```

---

### Task 9: ENS cache module

**Files:**
- Create: `web/lib/ens-cache.ts`
- Test:   `web/lib/ens-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/ens-cache.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createEnsCache } from "./ens-cache";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ens-cache-"));
});

describe("ens-cache", () => {
  it("returns null for unknown address; sets and returns it", async () => {
    const c = createEnsCache(path.join(dir, "ens.json"));
    expect(await c.getName("0xabc")).toBeNull();
    await c.setName("0xABC", "stoic-falcon");
    expect(await c.getName("0xabc")).toBe("stoic-falcon");
    expect(await c.getName("0xAbC")).toBe("stoic-falcon"); // case-insensitive
  });

  it("supports reverse lookup name → address", async () => {
    const c = createEnsCache(path.join(dir, "ens.json"));
    await c.setName("0xDEAD", "loyal-oak");
    expect(await c.getAddress("loyal-oak")).toBe("0xdead");
    expect(await c.getAddress("nope")).toBeNull();
  });

  it("persists to disk and reloads", async () => {
    const file = path.join(dir, "ens.json");
    const c1 = createEnsCache(file);
    await c1.setName("0xfeed", "wry-fox");
    const c2 = createEnsCache(file);
    expect(await c2.getName("0xFEED")).toBe("wry-fox");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run lib/ens-cache.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ens-cache.ts`**

```ts
// web/lib/ens-cache.ts
import * as fs from "node:fs";
import * as path from "node:path";

interface CacheData {
  byAddress: Record<string, string>; // lowercase address -> name
  byName: Record<string, string>;    // name -> lowercase address
}

export interface EnsCache {
  getName(address: string): Promise<string | null>;
  getAddress(name: string): Promise<string | null>;
  setName(address: string, name: string): Promise<void>;
}

export function createEnsCache(filePath: string): EnsCache {
  function load(): CacheData {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as CacheData;
    } catch {
      return { byAddress: {}, byName: {} };
    }
  }
  function save(d: CacheData) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
  }
  return {
    async getName(address) {
      const d = load();
      return d.byAddress[address.toLowerCase()] ?? null;
    },
    async getAddress(name) {
      const d = load();
      return d.byName[name] ?? null;
    },
    async setName(address, name) {
      const d = load();
      const lower = address.toLowerCase();
      d.byAddress[lower] = name;
      d.byName[name] = lower;
      save(d);
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run lib/ens-cache.test.ts`
Expected: All 3 pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/ens-cache.ts web/lib/ens-cache.test.ts
git commit -m "feat(web): JSON-file ENS name cache (address ↔ name)"
```

---

### Task 10: ENS resolver — uses publishAgentEnsRecords + collision retry

**Files:**
- Create: `web/lib/ens-resolver.ts`
- Test:   `web/lib/ens-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/ens-resolver.test.ts
import { describe, it, expect, vi } from "vitest";
import { createEnsResolver } from "./ens-resolver";

describe("ens-resolver", () => {
  it("returns cached name without publishing", async () => {
    const cache = {
      getName: vi.fn().mockResolvedValue("loyal-oak"),
      setName: vi.fn(),
      getAddress: vi.fn(),
    };
    const isClaimed = vi.fn();
    const publish = vi.fn();
    const r = createEnsResolver({ cache: cache as any, isClaimed, publish, parent: "tribunal.eth" });
    const name = await r.ensure("0xabc", "litigant");
    expect(name).toBe("loyal-oak");
    expect(publish).not.toHaveBeenCalled();
  });

  it("derives, finds first unclaimed candidate, publishes, caches", async () => {
    const setName = vi.fn();
    const cache = {
      getName: vi.fn().mockResolvedValue(null),
      setName,
      getAddress: vi.fn(),
    };
    let calls = 0;
    const isClaimed = vi.fn().mockImplementation(async () => {
      calls += 1;
      return calls === 1; // first candidate collides; second is free
    });
    const publish = vi.fn().mockResolvedValue(undefined);
    const r = createEnsResolver({ cache: cache as any, isClaimed, publish, parent: "tribunal.eth" });
    const name = await r.ensure("0xfeed", "lawyer");
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(isClaimed).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledOnce();
    expect(setName).toHaveBeenCalledWith("0xfeed", name);
  });

  it("throws after MAX_ATTEMPTS collisions", async () => {
    const cache = {
      getName: vi.fn().mockResolvedValue(null),
      setName: vi.fn(),
      getAddress: vi.fn(),
    };
    const isClaimed = vi.fn().mockResolvedValue(true); // always taken
    const publish = vi.fn();
    const r = createEnsResolver({ cache: cache as any, isClaimed, publish, parent: "tribunal.eth" });
    await expect(r.ensure("0xdead", "litigant")).rejects.toThrow(/collision/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run lib/ens-resolver.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ens-resolver.ts`**

```ts
// web/lib/ens-resolver.ts
import { deriveCandidate } from "./wordlist";
import type { EnsCache } from "./ens-cache";

export interface EnsResolverDeps {
  cache: EnsCache;
  isClaimed(name: string): Promise<boolean>;
  publish(name: string, address: string, role: string): Promise<void>;
  parent: string; // e.g. "tribunal.eth"
}

export interface EnsResolver {
  ensure(address: string, role: string): Promise<string>;
}

const MAX_ATTEMPTS = 8;

export function createEnsResolver(deps: EnsResolverDeps): EnsResolver {
  return {
    async ensure(address, role) {
      const cached = await deps.cache.getName(address);
      if (cached) return cached;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const candidate = deriveCandidate(address, attempt);
        const taken = await deps.isClaimed(candidate);
        if (!taken) {
          await deps.publish(candidate, address, role);
          await deps.cache.setName(address, candidate);
          return candidate;
        }
      }
      throw new Error(`ENS name collision: exhausted ${MAX_ATTEMPTS} attempts for ${address}`);
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run lib/ens-resolver.test.ts`
Expected: All 3 pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/ens-resolver.ts web/lib/ens-resolver.test.ts
git commit -m "feat(web): ENS auto-name resolver with collision retry"
```

---

### Task 11: Sepolia adapter wiring (`isClaimed` + `publish` real implementations)

**Files:**
- Create: `web/lib/ens-sepolia.ts`

- [ ] **Step 1: Implement Sepolia adapter (no test — real network)**

```ts
// web/lib/ens-sepolia.ts
import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { publishAgentEnsRecords, agentEnsRecord } from "../../agents/src/identity/ens";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const REGISTRY_ABI = [
  { name: "resolver", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

export interface SepoliaConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  parent: string; // "tribunal.eth"
  registryInteropAddress: string; // "eip155:16602:0x..."
}

export function makeSepoliaAdapter(cfg: SepoliaConfig) {
  const reader = createPublicClient({ chain: sepolia, transport: http(cfg.rpcUrl) });

  return {
    async isClaimed(label: string): Promise<boolean> {
      const node = namehash(`${label}.${cfg.parent}`);
      const resolver = await reader.readContract({
        address: ENS_REGISTRY, abi: REGISTRY_ABI, functionName: "resolver", args: [node],
      });
      return resolver !== "0x0000000000000000000000000000000000000000";
    },
    async publish(label: string, address: string, role: string): Promise<void> {
      const records = agentEnsRecord({
        registryInteropAddress: cfg.registryInteropAddress,
        agentId: address, // ENSIP-25 key now uses address instead of agent id
        role: role as any,
        axlPeerId: "",   // not yet known at registration time; can be appended later
        pubKey: address, // we have the address itself; full pubkey is optional
      });
      await publishAgentEnsRecords({
        rpcUrl: cfg.rpcUrl,
        privateKey: cfg.privateKey,
        parentName: cfg.parent,
        label,
        records,
      });
    },
  };
}
```

- [ ] **Step 2: Build to confirm types**

Run: `cd web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add web/lib/ens-sepolia.ts
git commit -m "feat(web): Sepolia adapter for ENS isClaimed + publish"
```

---

### Task 12: SIWE-style verification helper

**Files:**
- Create: `web/lib/siwe.ts`
- Test:   `web/lib/siwe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/siwe.test.ts
import { describe, it, expect } from "vitest";
import { Wallet, hashMessage } from "ethers";
import { verifyTribunalAuth } from "./siwe";

describe("verifyTribunalAuth", () => {
  it("accepts a valid signature whose address matches", async () => {
    const w = Wallet.createRandom();
    const msg = `tribunal-auth\naddress: ${w.address.toLowerCase()}\nnonce: abc123\nissued-at: 2026-04-30T00:00:00Z`;
    const sig = await w.signMessage(msg);
    const ok = verifyTribunalAuth({ address: w.address, message: msg, signature: sig });
    expect(ok).toBe(true);
  });

  it("rejects a signature from a different key", async () => {
    const w1 = Wallet.createRandom();
    const w2 = Wallet.createRandom();
    const msg = `tribunal-auth\naddress: ${w1.address.toLowerCase()}\nnonce: x\nissued-at: 2026-04-30T00:00:00Z`;
    const sig = await w2.signMessage(msg);
    const ok = verifyTribunalAuth({ address: w1.address, message: msg, signature: sig });
    expect(ok).toBe(false);
  });

  it("rejects a message that doesn't start with 'tribunal-auth'", async () => {
    const w = Wallet.createRandom();
    const msg = `bogus\naddress: ${w.address}\n`;
    const sig = await w.signMessage(msg);
    expect(verifyTribunalAuth({ address: w.address, message: msg, signature: sig })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run lib/siwe.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `siwe.ts`**

```ts
// web/lib/siwe.ts
import { verifyMessage } from "ethers";

export interface AuthInput {
  address: string;
  message: string;
  signature: string;
}

export function verifyTribunalAuth(input: AuthInput): boolean {
  if (!input.message.startsWith("tribunal-auth")) return false;
  try {
    const recovered = verifyMessage(input.message, input.signature);
    return recovered.toLowerCase() === input.address.toLowerCase();
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run lib/siwe.test.ts`
Expected: All 3 pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/siwe.ts web/lib/siwe.test.ts
git commit -m "feat(web): tribunal-auth SIWE-style signature verification helper"
```

---

### Task 13: Identity API — `POST /api/identity/whoami`

**Files:**
- Create: `web/app/api/identity/whoami/route.ts`

- [ ] **Step 1: Implement the handler**

```ts
// web/app/api/identity/whoami/route.ts
import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

import { verifyTribunalAuth } from "../../../../lib/siwe";
import { createEnsCache } from "../../../../lib/ens-cache";
import { createEnsResolver } from "../../../../lib/ens-resolver";
import { makeSepoliaAdapter } from "../../../../lib/ens-sepolia";

export const runtime = "nodejs";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

function deploymentInteropAddress(): string {
  const p = path.resolve(process.cwd(), "../docs/deployment.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const reg = j?.chains?.ogGalileo?.contracts?.AgentRegistry as string | undefined;
  if (!reg) throw new Error("AgentRegistry not in deployment.json");
  return `eip155:16602:${reg}`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as { address?: string; message?: string; signature?: string };
  if (!body.address || !body.message || !body.signature) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!verifyTribunalAuth(body as any)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const sepoliaRpc  = process.env.SEPOLIA_RPC_URL;
  const sepoliaKey  = process.env.SEPOLIA_PARENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!sepoliaRpc || !sepoliaKey) {
    return NextResponse.json({ error: "sepolia creds missing" }, { status: 503 });
  }

  const cache = createEnsCache(path.resolve(process.cwd(), "var/ens-cache.json"));
  const sep = makeSepoliaAdapter({
    rpcUrl: sepoliaRpc, privateKey: sepoliaKey,
    parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
    registryInteropAddress: deploymentInteropAddress(),
  });
  const resolver = createEnsResolver({
    cache, isClaimed: sep.isClaimed, publish: sep.publish,
    parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
  });

  const ensName = await resolver.ensure(body.address, "litigant");
  return NextResponse.json({ address: body.address.toLowerCase(), ensName });
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/identity/whoami/route.ts
git commit -m "feat(web): POST /api/identity/whoami — SIWE verify + ENS auto-name"
```

---

### Task 14: Identity API — `GET /api/identity/resolve`

**Files:**
- Create: `web/app/api/identity/resolve/route.ts`

- [ ] **Step 1: Implement the handler**

```ts
// web/app/api/identity/resolve/route.ts
import { NextResponse } from "next/server";
import * as path from "node:path";
import { createEnsCache } from "../../../../lib/ens-cache";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const addr = url.searchParams.get("address");
  const name = url.searchParams.get("name");
  if (!addr && !name) {
    return NextResponse.json({ error: "address or name required" }, { status: 400 });
  }
  const cache = createEnsCache(path.resolve(process.cwd(), "var/ens-cache.json"));

  if (addr) {
    const ensName = await cache.getName(addr);
    return NextResponse.json({ address: addr.toLowerCase(), ensName });
  }
  const resolved = await cache.getAddress(name!);
  return NextResponse.json({ address: resolved, ensName: name });
}
```

- [ ] **Step 2: Smoke test**

Run: `cd web && npm run dev` (in another terminal) then `curl 'http://localhost:3000/api/identity/resolve?address=0x0000000000000000000000000000000000000000'`
Expected: `{"address":"0x0000000000000000000000000000000000000000","ensName":null}` (cache empty).

Stop the dev server (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
git add web/app/api/identity/resolve/route.ts
git commit -m "feat(web): GET /api/identity/resolve — bidirectional ENS lookup"
```

---

### Task 15: Rewrite `POST /api/cases` as a raw-tx relay

**Files:**
- Modify: `web/app/api/cases/route.ts`

- [ ] **Step 1: Replace the route's POST handler**

```ts
// web/app/api/cases/route.ts
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";

import { createEnsCache } from "../../../lib/ens-cache";
import { createEnsResolver } from "../../../lib/ens-resolver";
import { makeSepoliaAdapter } from "../../../lib/ens-sepolia";

export const runtime = "nodejs";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

interface ContractAddresses {
  AgentRegistry: string;
  TribunalCore: string;
}

function loadAddresses(): ContractAddresses | null {
  try {
    const p = path.resolve(process.cwd(), "../docs/deployment.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
    if (!c?.AgentRegistry || !c?.TribunalCore) return null;
    return { AgentRegistry: c.AgentRegistry, TribunalCore: c.TribunalCore };
  } catch { return null; }
}

const TRIBUNAL_ABI = [
  "function fileCase(address defendant, address escrowAdapter, uint256 escrowId, string accusationCid) payable returns (uint256)",
  "function BASE_FEE() view returns (uint256)",
  "event CaseFiled(uint256 indexed caseId, address indexed accuser, address indexed defendant, address escrowAdapter, uint256 escrowId, string accusationCid, uint256 fee)",
];

export async function POST(req: Request) {
  const body = (await req.json()) as { rawTx?: string };
  if (!body.rawTx || !body.rawTx.startsWith("0x")) {
    return NextResponse.json({ error: "rawTx (hex) required" }, { status: 400 });
  }

  const addr = loadAddresses();
  if (!addr) return NextResponse.json({ error: "deployment not found" }, { status: 503 });

  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });

  // Decode the raw tx and validate it targets TribunalCore.fileCase.
  let parsed: ethers.Transaction;
  try {
    parsed = ethers.Transaction.from(body.rawTx);
  } catch (e: any) {
    return NextResponse.json({ error: `bad rawTx: ${e.message}` }, { status: 400 });
  }
  if (!parsed.to || parsed.to.toLowerCase() !== addr.TribunalCore.toLowerCase()) {
    return NextResponse.json({ error: "tx target is not TribunalCore" }, { status: 400 });
  }
  const iface = new ethers.Interface(TRIBUNAL_ABI);
  let decoded;
  try { decoded = iface.parseTransaction({ data: parsed.data, value: parsed.value }); }
  catch { return NextResponse.json({ error: "tx data is not fileCase(...)" }, { status: 400 }); }
  if (decoded?.name !== "fileCase") {
    return NextResponse.json({ error: "selector is not fileCase" }, { status: 400 });
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tribunal = new ethers.Contract(addr.TribunalCore, TRIBUNAL_ABI, provider);
  const baseFee  = (await tribunal.BASE_FEE()) as bigint;
  if (parsed.value < baseFee) {
    return NextResponse.json({ error: `value below BASE_FEE ${baseFee}` }, { status: 400 });
  }

  // Broadcast.
  let receipt: ethers.TransactionReceipt | null;
  try {
    const sent = await provider.broadcastTransaction(body.rawTx);
    receipt = await sent.wait();
  } catch (e: any) {
    return NextResponse.json({ error: `broadcast failed: ${e.message}` }, { status: 500 });
  }
  if (!receipt) return NextResponse.json({ error: "no receipt" }, { status: 500 });

  // Parse CaseFiled event.
  const event = receipt.logs
    .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "CaseFiled");
  if (!event) return NextResponse.json({ error: "CaseFiled event missing" }, { status: 500 });
  const caseId = (event.args.caseId as bigint).toString();
  const defendant = event.args.defendant as string;

  // Best-effort: ensure the defendant has an ENS name.
  try {
    const sepoliaRpc = process.env.SEPOLIA_RPC_URL;
    const sepoliaKey = process.env.SEPOLIA_PARENT_PRIVATE_KEY as `0x${string}` | undefined;
    if (sepoliaRpc && sepoliaKey) {
      const cache = createEnsCache(path.resolve(process.cwd(), "var/ens-cache.json"));
      const sep = makeSepoliaAdapter({
        rpcUrl: sepoliaRpc, privateKey: sepoliaKey,
        parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
        registryInteropAddress: `eip155:16602:${addr.AgentRegistry}`,
      });
      const resolver = createEnsResolver({
        cache, isClaimed: sep.isClaimed, publish: sep.publish,
        parent: process.env.ENS_PARENT_NAME ?? "tribunal.eth",
      });
      await resolver.ensure(defendant, "litigant");
    }
  } catch (e) {
    console.warn("[api/cases] defendant ENS publish failed (non-fatal):", e);
  }

  const explorerBase = process.env.OG_EXPLORER_BASE ?? "https://chainscan-galileo.0g.ai";
  return NextResponse.json({
    caseId,
    txHash: receipt.hash,
    explorerUrl: `${explorerBase}/tx/${receipt.hash}`,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Manual smoke test (after MCP server exists, deferred to Task 26)**

For now, validate that an obviously-bad rawTx is rejected.

Run: `cd web && npm run dev &` (background) then in another terminal:
```bash
curl -X POST http://localhost:3000/api/cases \
  -H 'content-type: application/json' \
  -d '{"rawTx":"0xdeadbeef"}'
```
Expected: 400 with a parse error. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/cases/route.ts
git commit -m "refactor(web): /api/cases POST is now a raw-tx relay (no operator key)"
```

---

### Task 16: Add `GET /api/cases` listing endpoint

**Files:**
- Modify: `web/app/api/cases/route.ts` (append GET handler)

- [ ] **Step 1: Add GET handler that reads CaseFiled events**

Append at the bottom of `web/app/api/cases/route.ts`:

```ts
export async function GET(req: Request) {
  const url = new URL(req.url);
  const party = url.searchParams.get("party")?.toLowerCase();
  const status = url.searchParams.get("status");

  const addr = loadAddresses();
  if (!addr) return NextResponse.json({ error: "deployment not found" }, { status: 503 });
  const rpcUrl = process.env.OG_RPC_URL;
  if (!rpcUrl) return NextResponse.json({ error: "OG_RPC_URL not set" }, { status: 503 });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tribunal = new ethers.Contract(
    addr.TribunalCore,
    [
      ...TRIBUNAL_ABI,
      "function caseStatus(uint256) view returns (uint8)",
      "function nextCaseId() view returns (uint256)",
    ],
    provider,
  );

  const next = (await tribunal.nextCaseId()) as bigint;
  const ids: bigint[] = [];
  for (let i = 1n; i < next; i++) ids.push(i);

  const out: Array<Record<string, any>> = [];
  for (const id of ids) {
    const [s, accuser, defendant] = await Promise.all([
      tribunal.caseStatus(id),
      tribunal.caseAccuser(id),
      tribunal.caseDefendant(id),
    ]);
    if (party && (party !== (accuser as string).toLowerCase()) && (party !== (defendant as string).toLowerCase())) continue;
    if (status !== null && status !== undefined && Number(s) !== Number(status)) continue;
    out.push({
      caseId: id.toString(),
      status: Number(s),
      accuser,
      defendant,
    });
  }
  return NextResponse.json({ cases: out });
}
```

Note: `caseAccuser` / `caseDefendant` views were added in Task 3; ensure they exist (they do, per the contract code).

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/cases/route.ts
git commit -m "feat(web): GET /api/cases — list with party/status filters"
```

---

## Phase E — Web UI: delete dispute form, render ENS names

### Task 17: Delete `DisputeForm.tsx` and `app/file/`

**Files:**
- Delete: `web/components/DisputeForm.tsx`
- Delete: `web/app/file/page.tsx`

- [ ] **Step 1: Delete files**

```bash
rm web/components/DisputeForm.tsx
rm web/app/file/page.tsx
rmdir web/app/file 2>/dev/null || true
```

- [ ] **Step 2: Find all imports/links pointing at the deleted code**

Run: `grep -rn "DisputeForm\|/file" web/app web/components`
Expected: Hits only in `web/app/page.tsx` (homepage CTA) — Task 18 fixes that.

- [ ] **Step 3: Commit**

```bash
git add -A web/components/DisputeForm.tsx web/app/file
git commit -m "chore(web): remove client-side case-filing UI (MCP is the only filing path)"
```

---

### Task 18: Update homepage with MCP install snippet

**Files:**
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Read the current homepage**

Run: `cat web/app/page.tsx`
Identify the existing "File a dispute" CTA / button block.

- [ ] **Step 2: Replace it with a "Watch live cases" + MCP snippet**

Replace the dispute-filing block with:

```tsx
<section style={{ marginTop: 40 }}>
  <Eyebrow>For agents</Eyebrow>
  <h2>File cases via MCP</h2>
  <p style={{ color: "var(--ink-soft)" }}>
    Connect Claude or any MCP-compatible client. Install the Tribunal MCP server,
    point it at your agent's key, and call <code>tribunal_file_case</code>.
  </p>
  <pre style={{
    background: "var(--paper-shade)",
    padding: 16,
    borderRadius: 6,
    overflowX: "auto",
    fontSize: 12,
  }}>
{`# Add to your MCP client config (Claude Desktop, etc.)
{
  "mcpServers": {
    "tribunal": {
      "command": "npx",
      "args": ["-y", "@tribunal/mcp"],
      "env": {
        "TRIBUNAL_AGENT_PRIVATE_KEY": "0x...",
        "TRIBUNAL_RPC_URL": "https://...",
        "TRIBUNAL_BACKEND_URL": "https://tribunal.demo"
      }
    }
  }
}`}
  </pre>
  <Button href="/case/1">Open courtroom</Button>
</section>
```

(Adjust the `Button href` to whatever the most recent case id is — or to `/judges` if no live case.) Remove the `import { DisputeForm } ...` line.

- [ ] **Step 3: Run dev server and verify the page loads**

Run: `cd web && npm run dev`
Open `http://localhost:3000` in a browser. Verify the page renders with the new section and no console errors. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat(web): replace dispute form CTA with MCP install snippet"
```

---

### Task 19: `useEnsName` hook for rendering parties

**Files:**
- Create: `web/components/useEnsName.ts`

- [ ] **Step 1: Implement the hook**

```ts
// web/components/useEnsName.ts
"use client";
import { useEffect, useState } from "react";

export function useEnsName(address: string | undefined): { name: string; loading: boolean } {
  const [name, setName] = useState<string>(address ? truncate(address) : "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/identity/resolve?address=${address}`)
      .then((r) => r.json())
      .then((j: { ensName?: string | null }) => {
        if (cancelled) return;
        if (j.ensName) setName(j.ensName);
        else setName(truncate(address));
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [address]);

  return { name, loading };
}

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
```

- [ ] **Step 2: Find party-rendering call sites**

Run: `grep -rn "accuserEns\|defendantEns\|accuser:\|defendant:" web/components web/app`
Note each component that displays a party name (likely `TrialStream.tsx`, `VerdictCard.tsx`, possibly `case/[id]/page.tsx`).

- [ ] **Step 3: Update at least the case page to use the hook**

In `web/app/case/[id]/page.tsx`, replace any direct address rendering with:

```tsx
import { useEnsName } from "../../../components/useEnsName";
// ...
function PartyLabel({ address }: { address: string }) {
  const { name } = useEnsName(address);
  return <span title={address}>{name}</span>;
}
```

Use `<PartyLabel address={accuser} />` everywhere a party shows up. Same in `TrialStream.tsx` and `VerdictCard.tsx` if they take addresses.

- [ ] **Step 4: Manual smoke test**

Run: `cd web && npm run dev`
Open a case page. Verify it renders `0x1234…abcd` initially and (if the cache has names) replaces with `<adjective>-<noun>.tribunal.eth` on resolution.

- [ ] **Step 5: Commit**

```bash
git add web/components/useEnsName.ts web/app/case web/components/TrialStream.tsx web/components/VerdictCard.tsx
git commit -m "feat(web): useEnsName hook + render auto-published names in courtroom"
```

---

## Phase F — MCP server

### Task 20: Bootstrap `mcp/` package

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/src/index.ts`
- Modify: `package.json` (root, add workspace)

- [ ] **Step 1: Create `mcp/package.json`**

```json
{
  "name": "@tribunal/mcp",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "bin": {
    "tribunal-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ethers": "^6.13.1",
    "dotenv": "^17.4.2"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `mcp/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `mcp/src/index.ts` skeleton**

```ts
#!/usr/bin/env node
// mcp/src/index.ts
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerTools, toolDefinitions } from "./tools.js";

async function main() {
  const server = new Server(
    { name: "tribunal-mcp", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return registerTools(req);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Add to root workspaces**

Read root `package.json` and add `"mcp"` to the `workspaces` array if present. If not present, add:

```json
"workspaces": ["agents", "contracts", "web", "mcp"]
```

- [ ] **Step 5: Install dependencies**

Run: `npm install` (from repo root)
Expected: `mcp/node_modules` populated (or hoisted to root).

- [ ] **Step 6: Commit (no tools yet, just scaffolding)**

```bash
git add mcp/ package.json
git commit -m "feat(mcp): bootstrap @tribunal/mcp package skeleton"
```

---

### Task 21: Config loader and signer

**Files:**
- Create: `mcp/src/config.ts`
- Create: `mcp/src/signer.ts`
- Create: `mcp/src/config.test.ts`

- [ ] **Step 1: Write the failing test for config**

```ts
// mcp/src/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("returns parsed config when env is complete", () => {
    const cfg = loadConfig({
      TRIBUNAL_AGENT_PRIVATE_KEY: "0x" + "11".repeat(32),
      TRIBUNAL_RPC_URL: "https://rpc.example",
      TRIBUNAL_BACKEND_URL: "https://api.example",
      TRIBUNAL_DEPLOYMENT_PATH: "/tmp/dep.json",
    });
    expect(cfg.privateKey.startsWith("0x")).toBe(true);
    expect(cfg.rpcUrl).toBe("https://rpc.example");
  });
  it("throws when private key is missing", () => {
    expect(() => loadConfig({
      TRIBUNAL_RPC_URL: "x", TRIBUNAL_BACKEND_URL: "y", TRIBUNAL_DEPLOYMENT_PATH: "z",
    })).toThrow(/TRIBUNAL_AGENT_PRIVATE_KEY/);
  });
  it("throws when private key is not 32-byte hex", () => {
    expect(() => loadConfig({
      TRIBUNAL_AGENT_PRIVATE_KEY: "not-hex",
      TRIBUNAL_RPC_URL: "x", TRIBUNAL_BACKEND_URL: "y", TRIBUNAL_DEPLOYMENT_PATH: "z",
    })).toThrow(/private key/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd mcp && npx vitest run src/config.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `config.ts` and `signer.ts`**

```ts
// mcp/src/config.ts
export interface MCPConfig {
  privateKey: `0x${string}`;
  rpcUrl: string;
  backendUrl: string;
  deploymentPath: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): MCPConfig {
  const pk = env.TRIBUNAL_AGENT_PRIVATE_KEY;
  if (!pk) throw new Error("TRIBUNAL_AGENT_PRIVATE_KEY not set");
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("TRIBUNAL_AGENT_PRIVATE_KEY must be 0x-prefixed 32-byte hex (private key)");
  const rpcUrl = env.TRIBUNAL_RPC_URL;
  if (!rpcUrl) throw new Error("TRIBUNAL_RPC_URL not set");
  const backendUrl = env.TRIBUNAL_BACKEND_URL;
  if (!backendUrl) throw new Error("TRIBUNAL_BACKEND_URL not set");
  const deploymentPath = env.TRIBUNAL_DEPLOYMENT_PATH;
  if (!deploymentPath) throw new Error("TRIBUNAL_DEPLOYMENT_PATH not set");
  return { privateKey: pk as `0x${string}`, rpcUrl, backendUrl, deploymentPath };
}
```

```ts
// mcp/src/signer.ts
import { ethers } from "ethers";
import * as fs from "node:fs";
import type { MCPConfig } from "./config.js";

export interface ChainContext {
  provider: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
  contracts: { AgentRegistry: string; TribunalCore: string };
}

export function createChainContext(cfg: MCPConfig): ChainContext {
  const j = JSON.parse(fs.readFileSync(cfg.deploymentPath, "utf8"));
  const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
  if (!c?.TribunalCore || !c?.AgentRegistry) throw new Error("TribunalCore/AgentRegistry missing in deployment.json");
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const wallet   = new ethers.Wallet(cfg.privateKey, provider);
  return { provider, wallet, contracts: { AgentRegistry: c.AgentRegistry, TribunalCore: c.TribunalCore } };
}
```

- [ ] **Step 4: Run tests**

Run: `cd mcp && npx vitest run src/config.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mcp/src/config.ts mcp/src/signer.ts mcp/src/config.test.ts
git commit -m "feat(mcp): config loader + chain context (provider/wallet/addresses)"
```

---

### Task 22: `tribunal_resolve` tool (no auth, public read)

**Files:**
- Create: `mcp/src/tools.ts`

- [ ] **Step 1: Implement the tools registry with `tribunal_resolve`**

```ts
// mcp/src/tools.ts
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";

export const toolDefinitions = [
  {
    name: "tribunal_resolve",
    description: "Resolve an Ethereum address or *.tribunal.eth name to {address, ensName}.",
    inputSchema: {
      type: "object",
      properties: { addressOrName: { type: "string" } },
      required: ["addressOrName"],
    },
  },
] as const;

export async function registerTools(req: CallToolRequest): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { name, arguments: args } = req.params;
  const cfg = loadConfig();

  if (name === "tribunal_resolve") {
    const input = (args as any).addressOrName as string;
    const url = /^0x[0-9a-fA-F]{40}$/.test(input)
      ? `${cfg.backendUrl}/api/identity/resolve?address=${input}`
      : `${cfg.backendUrl}/api/identity/resolve?name=${encodeURIComponent(input)}`;
    const res = await fetch(url);
    const j = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(j) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}
```

- [ ] **Step 2: Build and start the server, list tools**

Run:
```bash
cd mcp && npm run build
TRIBUNAL_AGENT_PRIVATE_KEY=0x$(printf '%064d' 1) \
TRIBUNAL_RPC_URL=http://localhost:8545 \
TRIBUNAL_BACKEND_URL=http://localhost:3000 \
TRIBUNAL_DEPLOYMENT_PATH=$PWD/../docs/deployment.json \
node dist/index.js < /dev/null &
```
Then send a `tools/list` request. (For convenience, write a quick `mcp/scripts/list-tools.sh` that pipes JSON-RPC into the server.)

Skipped here for brevity; deferred to Task 26 (integration test).

- [ ] **Step 3: Commit**

```bash
git add mcp/src/tools.ts
git commit -m "feat(mcp): tribunal_resolve tool (public read via backend)"
```

---

### Task 23: `tribunal_whoami` tool (signs SIWE message)

**Files:**
- Modify: `mcp/src/tools.ts`

- [ ] **Step 1: Add the tool to the registry and handler**

Append to `toolDefinitions`:

```ts
{
  name: "tribunal_whoami",
  description: "Returns the agent's address and ENS subname under tribunal.eth (auto-published on first call).",
  inputSchema: { type: "object", properties: {} },
},
```

In `registerTools`, add a branch:

```ts
if (name === "tribunal_whoami") {
  const { createChainContext } = await import("./signer.js");
  const ctx = createChainContext(cfg);
  const nonce = Math.random().toString(36).slice(2);
  const message =
    `tribunal-auth\n` +
    `address: ${ctx.wallet.address.toLowerCase()}\n` +
    `nonce: ${nonce}\n` +
    `issued-at: ${new Date().toISOString()}`;
  const signature = await ctx.wallet.signMessage(message);
  const res = await fetch(`${cfg.backendUrl}/api/identity/whoami`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: ctx.wallet.address, message, signature }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`whoami failed: ${res.status} ${t}`);
  }
  const j = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(j) }] };
}
```

- [ ] **Step 2: Build**

Run: `cd mcp && npm run build`
Expected: Clean.

- [ ] **Step 3: Commit**

```bash
git add mcp/src/tools.ts
git commit -m "feat(mcp): tribunal_whoami — signs auth message and triggers ENS publish"
```

---

### Task 24: `tribunal_file_case` tool (signs and submits via /api/cases)

**Files:**
- Modify: `mcp/src/tools.ts`

- [ ] **Step 1: Add the tool definition**

Append:

```ts
{
  name: "tribunal_file_case",
  description: "Signs and broadcasts TribunalCore.fileCase. defendant accepts an address or *.tribunal.eth name. Includes the BASE_FEE.",
  inputSchema: {
    type: "object",
    properties: {
      defendant:  { type: "string" },
      accusation: { type: "string" },
      escrow:     { type: "string", description: "Optional escrow contract address. Default zero address." },
      escrowId:   { type: "string", description: "Optional escrow id (uint256). Default 0." },
    },
    required: ["defendant", "accusation"],
  },
},
```

- [ ] **Step 2: Add the handler branch**

```ts
if (name === "tribunal_file_case") {
  const { ethers } = await import("ethers");
  const { createChainContext } = await import("./signer.js");
  const ctx = createChainContext(cfg);

  const a = args as any;
  const defendantInput = a.defendant as string;
  let defendant: string;
  if (/^0x[0-9a-fA-F]{40}$/.test(defendantInput)) {
    defendant = ethers.getAddress(defendantInput);
  } else {
    const r = await fetch(`${cfg.backendUrl}/api/identity/resolve?name=${encodeURIComponent(defendantInput)}`);
    const j = (await r.json()) as { address?: string | null };
    if (!j.address) throw new Error(`cannot resolve ${defendantInput}; pass an address instead`);
    defendant = ethers.getAddress(j.address);
  }
  const escrow   = a.escrow   ? ethers.getAddress(a.escrow as string) : ethers.ZeroAddress;
  const escrowId = a.escrowId ? BigInt(a.escrowId as string) : 0n;
  const accusationCid = `data:text/plain;base64,${Buffer.from(a.accusation as string, "utf8").toString("base64")}`;

  const TRIBUNAL_ABI = [
    "function fileCase(address defendant, address escrowAdapter, uint256 escrowId, string accusationCid) payable returns (uint256)",
    "function BASE_FEE() view returns (uint256)",
  ];
  const tribunal = new ethers.Contract(ctx.contracts.TribunalCore, TRIBUNAL_ABI, ctx.wallet);
  const baseFee  = (await tribunal.BASE_FEE()) as bigint;

  const populated = await tribunal.fileCase.populateTransaction(defendant, escrow, escrowId, accusationCid, { value: baseFee });
  const nonce = await ctx.provider.getTransactionCount(ctx.wallet.address);
  const fee   = await ctx.provider.getFeeData();
  const network = await ctx.provider.getNetwork();
  const signed = await ctx.wallet.signTransaction({
    ...populated,
    chainId: network.chainId,
    nonce,
    type: 2,
    maxFeePerGas: fee.maxFeePerGas ?? fee.gasPrice ?? 1n,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? fee.gasPrice ?? 1n,
    gasLimit: 500_000n,
  });

  const res = await fetch(`${cfg.backendUrl}/api/cases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rawTx: signed }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`relay failed: ${res.status} ${text}`);
  return { content: [{ type: "text", text }] };
}
```

- [ ] **Step 3: Build**

Run: `cd mcp && npm run build`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add mcp/src/tools.ts
git commit -m "feat(mcp): tribunal_file_case — sign+relay tx with BASE_FEE"
```

---

### Task 25: Read tools — `tribunal_get_case`, `tribunal_list_cases`, `tribunal_get_verdict`

**Files:**
- Modify: `mcp/src/tools.ts`

- [ ] **Step 1: Add three tool definitions**

```ts
{ name: "tribunal_get_case", description: "Fetch case state, parties, events.",
  inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] } },
{ name: "tribunal_list_cases", description: "List cases with optional filters.",
  inputSchema: { type: "object", properties: { party: { type: "string" }, status: { type: "string" } } } },
{ name: "tribunal_get_verdict", description: "Fetch ruling and reasoning for a settled case.",
  inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] } },
```

- [ ] **Step 2: Add three handler branches**

```ts
if (name === "tribunal_get_case") {
  const id = (args as any).caseId as string;
  const r = await fetch(`${cfg.backendUrl}/api/cases/${encodeURIComponent(id)}`);
  return { content: [{ type: "text", text: await r.text() }] };
}
if (name === "tribunal_list_cases") {
  const a = args as any;
  const u = new URL(`${cfg.backendUrl}/api/cases`);
  if (a.party)  u.searchParams.set("party",  a.party);
  if (a.status) u.searchParams.set("status", a.status);
  const r = await fetch(u);
  return { content: [{ type: "text", text: await r.text() }] };
}
if (name === "tribunal_get_verdict") {
  const id = (args as any).caseId as string;
  const r = await fetch(`${cfg.backendUrl}/api/cases/${encodeURIComponent(id)}/verdict`);
  return { content: [{ type: "text", text: await r.text() }] };
}
```

- [ ] **Step 3: Build**

Run: `cd mcp && npm run build`
Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add mcp/src/tools.ts
git commit -m "feat(mcp): tribunal_get_case, tribunal_list_cases, tribunal_get_verdict (read tools)"
```

---

### Task 26: MCP integration test (in-process)

**Files:**
- Create: `mcp/src/integration.test.ts`

- [ ] **Step 1: Write a test that exercises the tools registry directly**

```ts
// mcp/src/integration.test.ts
import { describe, it, expect, beforeAll, vi } from "vitest";

const BACKEND_RESPONSES: Record<string, any> = {
  "/api/identity/resolve?address=0xabc": { address: "0xabc", ensName: "stoic-falcon" },
  "/api/identity/whoami": { address: "0x1234", ensName: "loyal-oak" },
};

beforeAll(() => {
  process.env.TRIBUNAL_AGENT_PRIVATE_KEY = "0x" + "11".repeat(32);
  process.env.TRIBUNAL_RPC_URL = "http://localhost:8545";
  process.env.TRIBUNAL_BACKEND_URL = "http://test.local";
  process.env.TRIBUNAL_DEPLOYMENT_PATH = "/tmp/no-such-file.json"; // not loaded by resolve tool
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace("http://test.local", "");
    const body = BACKEND_RESPONSES[path] ?? { error: "not stubbed", path };
    return new Response(JSON.stringify(body), { status: 200 });
  });
});

describe("MCP tools (integration)", () => {
  it("tribunal_resolve returns the backend payload verbatim", async () => {
    const { registerTools, toolDefinitions } = await import("./tools");
    expect(toolDefinitions.find((t) => t.name === "tribunal_resolve")).toBeTruthy();
    const out = await registerTools({
      method: "tools/call",
      params: { name: "tribunal_resolve", arguments: { addressOrName: "0xabc" } },
    } as any);
    expect(out.content[0].text).toContain("stoic-falcon");
  });
});
```

- [ ] **Step 2: Run**

Run: `cd mcp && npx vitest run src/integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add mcp/src/integration.test.ts
git commit -m "test(mcp): integration test for tools registry with stubbed backend"
```

---

### Task 27: End-to-end demo path — file a case via MCP, watch trial run

**Files:**
- Modify: `package.json` (root) — add `demo:mcp` script
- Create: `scripts/mcp-demo.ts`

- [ ] **Step 1: Add a simple demo driver**

```ts
// scripts/mcp-demo.ts
// Minimal driver that exercises the MCP server via a child process,
// using the JSON-RPC stdio protocol. Used by `npm run demo:mcp`.
import { spawn } from "node:child_process";
import * as path from "node:path";

const proc = spawn("node", [path.resolve(__dirname, "../mcp/dist/index.js")], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"],
});

let id = 0;
function send(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = { jsonrpc: "2.0", id: ++id, ...req };
    proc.stdout!.once("data", (chunk) => {
      const line = chunk.toString().split("\n").find((l: string) => l.trim().startsWith("{"));
      if (!line) return reject(new Error("no JSON in response: " + chunk));
      resolve(JSON.parse(line));
    });
    proc.stdin!.write(JSON.stringify(payload) + "\n");
  });
}

async function main() {
  const list = await send({ method: "tools/list" });
  console.log("Tools:", list.result?.tools?.map((t: any) => t.name));

  const me = await send({
    method: "tools/call",
    params: { name: "tribunal_whoami", arguments: {} },
  });
  console.log("whoami →", me.result?.content?.[0]?.text);

  const filed = await send({
    method: "tools/call",
    params: {
      name: "tribunal_file_case",
      arguments: {
        defendant: process.env.DEMO_DEFENDANT_ADDRESS,
        accusation: "DEMO accusation: defendant breached the data-supply contract.",
      },
    },
  });
  console.log("file_case →", filed.result?.content?.[0]?.text);

  proc.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the script to root `package.json`**

In root `package.json` `"scripts"` block, add:
```json
"demo:mcp": "tsx scripts/mcp-demo.ts"
```

If `tsx` isn't already a dev dep, run `npm i -D tsx` from repo root and commit `package-lock.json` + `package.json`.

- [ ] **Step 3: Manual end-to-end check (with web + agent runner running)**

Start three processes in three terminals:

```bash
# Terminal 1 — web backend
cd web && npm run dev

# Terminal 2 — agent runner (after AXL nodes are up; see README)
cd agents && node dist/runner.js

# Terminal 3 — fire the demo
TRIBUNAL_AGENT_PRIVATE_KEY=0x$ACCUSER_PRIVATE_KEY \
TRIBUNAL_RPC_URL=$OG_RPC_URL \
TRIBUNAL_BACKEND_URL=http://localhost:3000 \
TRIBUNAL_DEPLOYMENT_PATH=$PWD/docs/deployment.json \
DEMO_DEFENDANT_ADDRESS=0x... \
npm run demo:mcp
```

Expected: `whoami` returns an `ensName`; `file_case` returns a `caseId` and `txHash`. The runner picks up the new `CaseFiled` event and logs trial progression.

- [ ] **Step 4: Commit**

```bash
git add scripts/mcp-demo.ts package.json package-lock.json
git commit -m "feat(scripts): demo:mcp — drives the MCP server end-to-end"
```

---

## Phase G — Cleanup, docs, README

### Task 28: Update README and architecture doc

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update README sections**

In `README.md`, update:
- The "Quickstart for graders" block to drop the dispute-form mention and add the MCP install snippet from Task 18.
- The "Smart contracts" enumeration: `AgentRegistry` is "address-keyed role table"; `TribunalCore.fileCase` is "payable, BASE_FEE 0.01 OG, address-keyed parties."
- Add an "MCP server" section under "Repo layout":
  ```
  mcp/          @tribunal/mcp — stdio MCP server, signs locally; tools listed in mcp/README.md
  ```

- [ ] **Step 2: Update `docs/architecture.md`**

Replace any references to agent-IDs with addresses; update the diagram to show the MCP-server arrow into `web → 0G`.

- [ ] **Step 3: Add a `mcp/README.md`**

```markdown
# @tribunal/mcp

Local MCP server for Tribunal. Holds the agent's private key in env, signs all
transactions and SIWE messages. Stateless.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `TRIBUNAL_AGENT_PRIVATE_KEY` | yes | 0x-prefixed 32-byte hex |
| `TRIBUNAL_RPC_URL`           | yes | 0G Galileo RPC |
| `TRIBUNAL_BACKEND_URL`       | yes | Web backend base URL |
| `TRIBUNAL_DEPLOYMENT_PATH`   | yes | Path to `docs/deployment.json` |

## Tools

- `tribunal_whoami`
- `tribunal_resolve`
- `tribunal_file_case`
- `tribunal_get_case`
- `tribunal_list_cases`
- `tribunal_get_verdict`
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/architecture.md mcp/README.md
git commit -m "docs: MCP-first architecture, address-based contracts"
```

---

### Task 29: Final regression sweep

- [ ] **Step 1: Run all tests**

```bash
cd contracts && npx hardhat test
cd ../agents   && npm test
cd ../web      && npx vitest run
cd ../mcp      && npm test
```

Expected: All green. If anything fails, fix before proceeding.

- [ ] **Step 2: Verify clean build**

```bash
cd contracts && npx hardhat compile
cd ../agents   && npm run build
cd ../web      && npm run build
cd ../mcp      && npm run build
```

Expected: All clean.

- [ ] **Step 3: Tag and commit any final cleanups**

If there are any straggling `git status` items (stray imports, stale variables), fix and commit:

```bash
git status
# fix anything reported
git add -A && git commit -m "chore: post-MCP cleanup"
```

---

## Summary

29 tasks across 7 phases:

- **A — Contracts (1-4):** rewrite `AgentRegistry` as role table, `TribunalCore` payable + role-gated, sweep tests.
- **B — Deploy (5-6):** admit env, redeploy 0G, write `deployment.json`.
- **C — Agents runtime (7):** drop agent-IDs, switch to addresses.
- **D — Web backend (8-16):** wordlist, ENS cache, resolver, Sepolia adapter, SIWE helper, identity endpoints, raw-tx relay, list endpoint.
- **E — Web UI (17-19):** delete dispute form, MCP snippet on home, `useEnsName` hook.
- **F — MCP (20-26):** scaffold package, config, signer, six tools, integration test.
- **G — Cleanup (27-29):** demo:mcp script, README/docs update, final regression sweep.
