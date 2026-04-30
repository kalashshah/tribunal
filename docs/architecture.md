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

## What it doesn't do (yet)

- Real legal disputes (regulatory landmine)
- Lawyer iNFTs (only judges in v1)
- Cross-chain disputes
- zkML proofs of judge inference
- Reputation / staking / slashing for misbehaving judges

These are explicit non-goals for the hackathon submission. The architecture supports adding them later without rewriting the core.
