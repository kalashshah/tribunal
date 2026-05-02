# Tribunal Architecture

Tribunal is a verifiable AI court for autonomous agents — a multi-judge dispute resolution layer where agents file cases, lawyer agents argue over Gensyn AXL, and a panel of judge iNFTs rules with every event anchored on 0G Chain.

> **Note (post-MCP refactor):** `AgentRegistry` is now **address-keyed** (not ENS-keyed). Roles (`None | Lawyer | Judge`) are admitted by the contract owner via `admitJudge` / `admitLawyer`. ENS names are still used for human-readable identity (ENSIP-25 text records) but are resolved off-chain; the on-chain registry uses `address` as the primary key. Cases are filed through the `@tribunal/mcp` stdio server rather than a dispute-filing UI.

## Eight layers, all independently testable

| # | Layer                  | Implementation                                                | Purpose                                                                  |
|---|------------------------|---------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | Identity               | `agents/src/identity/ens.ts` + `AgentRegistry.sol`            | Address-keyed role registry; ENS/ENSIP-25 text records for human-readable names (off-chain resolution) |
| 2 | Persona                | `JudgeINFT.sol` (ERC-7857)                                    | Judge personas + evolving ruling memory as transferable iNFTs             |
| 3 | Courtroom transport    | `agents/src/transport/axl.ts`                                 | Encrypted P2P agent-to-agent messages over Gensyn AXL                    |
| 4 | Verifiable record      | `agents/src/storage/og-storage.ts` + `TribunalCore.recordEvent` | Every prompt/argument/ruling on 0G Storage; content hash on 0G Chain    |
| 5 | Judge consensus        | `TribunalCore.submitRuling` + threshold tally                 | Panel of N judges; majority verdict; dissents recorded                    |
| 6 | Ruling execution       | `keeper/workflows/ruling-execution.json`                      | KeeperHub releases escrow + notifies parties on `VerdictPosted`           |
| 7 | Smart contracts        | `contracts/src/*.sol`                                         | Case state machine, escrow, registry, judge iNFTs, verdict log on 0G Chain |
| 8 | Web UI                 | `web/app/**`                                                  | File a dispute, watch a live trial (SSE), see verdict + replay            |

## Sequence — single case from filing to settlement

```
[UI]
  ─ POST /api/cases ──> [.cases-queue.json] ──> picked up by [runner.ts]

[runner]
  ─ TribunalCore.fileCase ──> [TribunalCore]
                                ├── flagDisputed ──> [EscrowAdapter]
                                └── emit CaseFiled

[runner] ── acceptCase(judges, threshold) ──> [TribunalCore] (status: Arguments)

[Lawyer A] ── AXL send ──> [Clerk]
[Clerk]    ── upload ──>   [0G Storage]
[Clerk]    ── recordEvent ──> [TribunalCore] (anchors content hash)
[Clerk]    ── forward ──> [UI SSE]

(repeat: lawyer B, rebuttals, closings)

[Judge] ── deliberate via LLM ──> Ruling JSON
[Judge] ── submitRuling ──> [TribunalCore]
                              ├── tally votes
                              ├── if threshold met → status = Ruled
                              └── emit CaseRuled
[Judge] ── appendRulingMemory ──> [JudgeINFT]   (precedent grows)

[Operator] ── post(verdict) ──> [VerdictLog]    (emits VerdictPosted)
[KeeperHub] ── triggered ──>
    [EscrowAdapter.release] + [TribunalCore.markSettled] + Discord ping
```

## Why each sponsor primitive earned its place

- **0G iNFT (ERC-7857):** judges have personas + memory that evolves with every case and survives wallet transfers. Plain ERC-721 doesn't model that.
- **Gensyn AXL:** courtroom communication shouldn't pass through a central broker — that would defeat the verifiability claim. AXL is encrypted P2P with no infra to trust.
- **ENS + ENSIP-25:** agents need stable, human-readable identity that is *cryptographically* tied to their on-chain registry entry. ENSIP-25 is exactly that.
- **0G Storage + 0G Chain:** "verifiable" requires content-addressed storage + on-chain anchors. Anyone can replay any case end-to-end.
- **KeeperHub:** verdicts have to *do* something — release escrow, notify, enforce deadlines. KeeperHub is the no-code execution layer that closes the loop.

## Rulebook + chain of receipts

Judges no longer reason from a free-form persona. They consult a curated
rulebook (a UNIDROIT subset for v1) anchored on 0G Storage, with the
content `rootHash` recorded in a new `RuleBookGovernor` contract. Anyone
can fetch the bytes from 0G, hash them, and check the on-chain root —
that is the "rules on chain" guarantee.

Governance is open one-address-one-vote (a `humanityOracle` slot is
reserved for World ID / Proof of Humanity). Anyone can `propose` an
amendment by uploading text to 0G and registering its root. Once two yes
votes are recorded, anyone can `execute`, which appends the amendment to
the governor's list and rotates `currentManifestHash`.

At trial time the runner downloads the base + amendment blobs from 0G,
merges them into a single in-memory rulebook (with override semantics —
later amendments win), and hands the judge a *table of contents only*.
The judge then runs a multi-turn loop:

```
Judge:  LOOKUP: 7.4.2, 7.4.13       ← asks for two articles
System: <article bodies injected>
Judge:  RULE: {prevailingIsAccuser, opinion}
```

Each `LOOKUP` and the final `RULE` produces a verifiable REE inference
receipt. The agent assembles a linked-list **chain manifest** containing
all step receipts (plus any prior clarifying-question receipt), uploads
it to 0G, and anchors the chain `rootHash` via
`VerdictLog.attachReceipt`. The on-chain artifact is one hash; the full
reasoning trace lives off-chain at the manifest's 0G address.

Verifier flow:

```
1. Read VerdictLog.receipts[caseId] → chain rootHash + URL
2. Download chain manifest from 0G via rootHash
3. For each ChainStep: download the step's REE receipt
4. Re-run the receipt in REE → diff against the receipt's claimed output
5. Walk prevHash pointers to confirm the linked list is unbroken
```

This shifts Tribunal's verifiability story from "the verdict is signed
by an enclave" to "every reasoning step is independently re-runnable
and the chain is tamper-evident." The judge cannot cite an article it
didn't actually `LOOKUP`, because the receipt of that LOOKUP step is
part of the anchored chain.

## What it doesn't do (yet)

- Real legal disputes (regulatory landmine)
- Lawyer iNFTs (only judges in v1)
- Cross-chain disputes
- zkML proofs of judge inference
- Reputation / staking / slashing for misbehaving judges

These are explicit non-goals for v1. The architecture supports adding them later without rewriting the core.
