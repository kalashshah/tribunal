# Tribunal — Design Spec

**Date:** 2026-04-26
**Author:** kalashshah
**Status:** Draft, pending review
**Hackathon:** ETHGlobal "Open Agents" — submission in 10 days

---

## 1. One-line pitch

A decentralized, verifiable court for autonomous AI agents. When two agents transact and disagree, Tribunal lets them file a dispute, argue through agent-lawyers, and receive a ruling from a panel of agent-judges — with every prompt, argument, and verdict cryptographically anchored on-chain.

## 2. Problem

Autonomous agents are increasingly transacting with each other (escrows, bounties, swaps, service exchanges). When they disagree, there is no neutral, programmatic forum for resolution. Today the choices are: trust a centralized arbiter, fall back to a human court (slow, expensive, jurisdiction-dependent), or just walk away from the value at stake. None of these scale to a future where agents transact thousands of times per day.

Tribunal provides agent-native dispute resolution: agent-judges with persistent precedent memory, agent-lawyers who argue the case, and a fully verifiable on-chain record of the proceedings.

## 3. Goals

- **Generic** — handle any dispute between agents, not just one use case. Escrow disputes are the launch use case but the system is parameterized.
- **Verifiable** — every prompt, response, argument, and ruling is content-addressed on 0G Storage and the hash anchored on 0G Chain. Anyone can replay any case end-to-end.
- **Multi-judge** — rulings come from a panel, not a single LLM call. Majority decides; dissents are recorded.
- **Agent-native identity** — every participant has an ENS name and an ERC-8004 registry entry, linked via ENSIP-25 text records.
- **No central infrastructure** — agent-to-agent communication runs over Gensyn AXL (encrypted P2P, no broker).
- **Transferable expertise** — judges are ERC-7857 iNFTs; their persona and ruling memory are encrypted, transferable assets.

## 4. Non-goals (out of scope for this hackathon)

- Real-world legal disputes (regulatory landmine).
- Human-vs-agent disputes (humans-only as litigants is not the design target; the demo can include human-controlled agents but the framing is agent-vs-agent).
- Custom judge model training. Judges use general-purpose LLMs with role prompts and case-history memory; no fine-tuning.
- Reputation / staking systems for judges and lawyers. Worth doing later, not now.
- Lawyer agents as iNFTs. Only judges are minted as iNFTs in v1.
- Cross-chain dispute resolution. Single chain (0G) only.
- Uniswap-based settlement. Settlement is direct token transfer per ruling.

## 5. Architecture

Eight independently testable layers:

### 5.1 Agent identity layer (ENS + ERC-8004 + ENSIP-25)

- Each participating agent registers an entry in an ERC-8004 on-chain agent registry.
- Each agent owns an ENS name (subname under `tribunal.eth`, e.g., `alice.tribunal.eth`, `judge-athena.tribunal.eth`).
- The ENS name has a text record per ENSIP-25 keyed by the agent registry's interoperable address (ERC-7930) and the agent's registry ID, with value `1` to assert verifiable association.
- Other ENS text records carry: AXL peer ID, public key, role (`judge` / `lawyer` / `litigant`), and any credentials.
- This makes agent discovery and identity resolution a single ENS lookup.

### 5.2 Agent persona layer (0G iNFT — ERC-7857)

- Each judge is minted as an iNFT.
- Encrypted metadata (privacy-preserving per ERC-7857) holds: jurisprudence style prompt, ruling history, precedent memory.
- Dynamic data management: after each ruling, the judge's iNFT memory is updated (append the case hash + outcome).
- Transferable: a famous judge can be sold, hired, or delegated.
- v1 mints only judges as iNFTs. Lawyers are stateless role-prompted agents.

### 5.3 Courtroom transport (Gensyn AXL)

- Each agent runs an AXL node locally and exposes its ed25519-derived peer ID.
- All trial proceedings (filings, arguments, evidence references, rulings) are transmitted as AXL messages between peers.
- Peer ID resolution flow: ENS name → text record `axl-peer-id` → AXL `/send` to that peer.
- A "clerk" role coordinates message ordering for a given case (not a central broker — clerks are themselves agents with peer IDs; the case smart contract designates one clerk per case).

### 5.4 Verifiable record (0G Storage + 0G Chain)

- Every message in a case (filings, prompts, LLM responses, arguments, evidence, rulings) is uploaded to 0G Storage as a JSON document.
- Each upload returns a content hash.
- The Tribunal smart contract on 0G Chain stores `(caseId, sequenceNumber, contentHash)` for every event.
- Replay = fetch all hashes for a case from chain → fetch each blob from 0G Storage → reconstruct full transcript.
- This is the (a) component of our verifiability claim.

### 5.5 Judge consensus

- Panel size is configurable per case (default 3, MVP starts with 1, stretch goal is 3).
- Each judge receives the case file independently and rules independently.
- Smart contract collects rulings and computes majority verdict.
- Dissenting opinions are stored alongside the majority verdict.
- This is the (c) component of our verifiability claim — no single LLM call is load-bearing.

### 5.6 Ruling execution (KeeperHub)

- When a verdict is finalized, a KeeperHub workflow triggers:
  - Release escrow funds to the prevailing party.
  - Send Discord/Telegram notifications to both parties.
  - Post the verdict hash to a public verdict registry contract.
- Pre-trial KeeperHub workflows enforce procedural deadlines: if a party fails to respond within N blocks, judgment is entered by default.
- KeeperHub's MCP server is also exposed so agents can compose their own follow-up workflows from a verdict.

### 5.7 Smart contract layer (Solidity, 0G Chain)

- `TribunalCore.sol` — case state machine: `Filed → Accepted → Arguments → Deliberation → Ruled → Settled`. Stores anchor hashes per event.
- `EscrowAdapter.sol` — generic escrow holder. Disputants lock funds here; release is conditional on a verdict from `TribunalCore`.
- `AgentRegistry.sol` — minimal ERC-8004-compatible registry for participating agents.
- `JudgeINFT.sol` — ERC-7857 implementation for judges. Reuses 0G's reference contracts where available.
- `VerdictLog.sol` — append-only public log of finalized verdicts (verdict hash, case ID, parties, outcome).

### 5.8 Web UI (Next.js + WebSocket)

- **File a Dispute:** form with party ENS names, dispute description, escrow contract address, evidence references.
- **Live Trial Stream:** WebSocket relays AXL traffic for the case to the browser; arguments render as a chat-style transcript in real time.
- **Verdict View:** majority verdict, dissents, replay link, on-chain anchor proof, settlement transaction link.
- **Agent Directory:** browse registered judges and their iNFT-stored ruling history.

## 6. Data flow — single case end-to-end

1. Alice (`alice.tribunal.eth`) and Bob (`bob.tribunal.eth`) had an escrow agreement via `EscrowAdapter`. Alice claims delivered, Bob denies.
2. Alice files a dispute via UI → `TribunalCore.fileCase(escrowId, accusation)`. Pays a small dispute fee.
3. The contract assigns a clerk and selects judges (MVP: hardcoded panel; future: stake-weighted random selection).
4. Clerk announces the case over AXL. Each judge and each side's lawyer agent connects.
5. Lawyer agents exchange opening statements → evidence → cross-examination → closing arguments over AXL. Each message is uploaded to 0G Storage; clerk anchors hashes via `TribunalCore.recordEvent`.
6. Judge(s) deliberate independently. Each judge's reasoning trace is logged to 0G Storage and anchored.
7. Each judge submits a signed ruling via `TribunalCore.submitRuling(caseId, verdict, opinionHash)`.
8. Once ruling threshold is met, `TribunalCore` finalizes the verdict.
9. KeeperHub workflow detects the finalized verdict and:
   - Calls `EscrowAdapter.release(verdictId)` which pays out the prevailing party.
   - Notifies both parties off-chain.
   - Posts to `VerdictLog`.
10. Each judge's iNFT is updated with the new case hash + outcome (precedent memory grows).
11. UI shows the verdict; anyone can hit "Replay" and reconstruct the full trial from on-chain hashes + 0G Storage.

## 7. Demo scenario (3-minute video)

Title card: *"What happens when AI agents disagree?"*

1. **(0:00–0:20)** Show two agents `alice.tribunal.eth` and `bob.tribunal.eth` with an active escrow on-chain. Alice (an "AI courier" agent) claims she delivered an off-chain task. Bob refuses to release funds.
2. **(0:20–0:35)** Alice files a dispute via the Tribunal UI. The case appears in the public docket.
3. **(0:35–0:50)** Three judge iNFTs (`judge-athena`, `judge-blackstone`, `judge-coke`) accept the case (MVP: shows 1 judge; stretch: 3).
4. **(0:50–2:00)** Live trial stream: lawyer agents argue over AXL; messages stream into the UI in real time. Show network traces between AXL peer IDs.
5. **(2:00–2:30)** Judge(s) deliberate. Reasoning traces stream in. Each judge submits a signed ruling.
6. **(2:30–2:50)** Verdict is finalized; KeeperHub releases escrow; notification fires.
7. **(2:50–3:00)** Open the "Replay" view: every event reconstructed from on-chain anchors + 0G Storage. Close on tagline.

## 8. MVP scope (what ships in 10 days)

**Days 1–2 — Foundations**
- Bootstrap repo (Next.js + Hardhat + TypeScript + 0G SDK + ethers).
- Deploy minimal `AgentRegistry` and ENS subname management.
- Stand up a single AXL node locally; verify peer-to-peer message round-trip.

**Days 3–4 — Smart contracts**
- `TribunalCore.sol`, `EscrowAdapter.sol`, `VerdictLog.sol`. Deploy to 0G Chain testnet.
- Hardhat tests for case state machine and escrow release.

**Days 5–6 — Agent runtime**
- Lawyer agent (LLM with role prompt + case context).
- Judge agent (LLM with role prompt + iNFT-loaded precedent memory).
- AXL transport wrapper (TS module) — abstracts `localhost:9002` API.
- 0G Storage upload + hash anchoring helper.

**Day 7 — End-to-end happy path**
- Run a full case from filing to verdict on testnet.
- Wire up `JudgeINFT.sol` (ERC-7857) and mint one judge iNFT with persona.

**Days 8–9 — UI & polish**
- File-dispute form, live trial WebSocket stream, verdict view, replay.
- KeeperHub workflow for ruling execution + deadlines.
- ENS Track B polish: agents with credentials in text records.
- Stretch: 3-judge panel.

**Day 10 — Submission**
- Demo video (under 3 minutes).
- README, architecture diagram, deployment addresses.
- Required submission artifacts for each prize track.
- `FEEDBACK.md` (only if we end up integrating Uniswap; default skipped).

## 9. Prize track mapping

| Sponsor | Track | Strength | Rationale | Realistic |
|---|---|---|---|---|
| 0G | Track B: Autonomous Agents, Swarms & iNFT Innovations | Strong | Judges as iNFTs with evolving precedent memory; agents communicate over P2P; deployed on 0G | $1.5K |
| Gensyn | AXL | Strong, deep | All trial communication on AXL; peer ID identity; no central broker | $1K-$2.5K |
| ENS | Track A: Best ENS Integration | Strong | ENSIP-25 text-record verification linking agents to ERC-8004 registry | $500-$1.25K |
| ENS | Track B: Most Creative Use of ENS | Strong | Subnames-as-roles, text records as agent credentials and AXL peer-ID directory | $500-$1.25K |
| KeeperHub | Best Use of KeeperHub | Medium | Ruling execution + procedural deadlines + MCP server for agent-composed workflows | $500-$2.5K |
| Uniswap | Skip | — | Forced fit; settlement is direct ERC-20 transfer | — |

**Realistic ceiling: ~$8-15K. Mid-floor: ~$3-4K.**

## 10. Risks and mitigations

- **R1: AXL integration unfamiliar.** Mitigation: spike on day 1, fall back to a thin WebSocket relay if AXL turns out to be unstable. The agent-runtime code calls a single helper method, so the transport is swappable.
- **R2: ERC-7857 reference implementation is new.** Mitigation: study the 0G integration guide on day 1; if the reference contracts are blocked, fall back to a minimal ERC-721 with encrypted metadata stored on 0G Storage and document the deviation.
- **R3: Multi-judge panel is too much for solo timeline.** Mitigation: ship single-judge MVP; flip to panel as a configuration change on day 8 if foundations are solid.
- **R4: Demo agents look too scripted.** Mitigation: pick a non-obvious dispute (e.g., ambiguous deliverable spec) so the LLM reasoning is non-trivial. Show real LLM responses, not canned text.
- **R5: 0G testnet instability or unfamiliar SDK quirks.** Mitigation: keep a local Hardhat fallback and only switch to 0G Chain once the contract layer is proven locally.
- **R6: Time blowout on UI polish.** Mitigation: UI is layer 8 on purpose; if days 8-9 slip, ship a minimal CLI demo and record the video against that.

## 11. Open questions (resolve during implementation)

- Q1: Does 0G Chain have a testnet faucet that supports our test volume? (Verify on day 1.)
- Q2: Best way to expose AXL traffic to the browser for the live trial stream — proxy via the clerk node, or have the UI run its own AXL node? Likely proxy.
- Q3: Where does the "AI court reads previous precedent" loop terminate? Need a strict cap on context size per case to keep cost predictable.
- Q4: ENS subname strategy — register one parent name (`tribunal.eth`) and use a custom resolver to issue subnames cheaply, or use an existing offchain CCIP-read resolver?

## 12. Success criteria

The submission is successful if, by day 10:
- A dispute can be filed and resolved end-to-end against deployed contracts on 0G Chain testnet.
- A 3-minute demo video is recorded showing the full flow.
- At least one judge iNFT exists on 0G with persona + at least one ruling in its memory.
- The submission meets the artifact requirements for at least three prize tracks (0G iNFT, Gensyn AXL, ENS Track A).
- Stretch: meets requirements for ENS Track B and KeeperHub as well.

---

*Next step after this spec is approved: invoke `superpowers:writing-plans` to produce a step-by-step implementation plan.*
