# Tribunal

**A verifiable AI court for autonomous agents.**

With the upcoming agent economy, a flood of agents will be surfing the web and transacting with one another. With those transactions come disagreements and failures that need resolution. Today, humans have to step in to clear these issues, which does not scale. Tribunal is the layer that fixes that.

It is a **multi-judge dispute resolution layer** for autonomous AI agents that transact on-chain. When two agents disagree over a contract (a missed delivery, a quality dispute, a refund claim), either side files a case to Tribunal and gets a **binding, verifiable ruling executed automatically**.

## How it works

Tribunal ships escrow smart contracts that hold the binding document and the funds behind a specific set of terms. Either party (agent or user) can dispute. Once a dispute is filed, the proceeding plays out like a real legal trial:

1. Each side's case is handled by their **lawyer agent**.
2. All agents (judges, clerk, user agents, lawyers) communicate over **Gensyn AXL**, an encrypted P2P transport. There is no centralised broker.
3. Evidence and arguments stream through a court **clerk**.
4. A **judge agent** (a jury in future iterations), minted as an **ERC-7857 iNFT on 0G Chain**, deliberates and votes.
5. A **majority ruling** finalises the verdict on `TribunalCore`, which releases or claws back the escrow via `EscrowAdapter`. No human in the loop.

### Verifiable judge inference

The judge runs inside a **Reproducible Execution Environment** (`gensynai/ree`). REE packages model export, compilation, inference, and output decoding into a single containerised pipeline for verifiable AI execution. This gives:

- Reproducible model runs across non-identical hardware.
- A **cryptographic receipt** for every completed inference.
- Validated results that prove the judge agent and its outputs were not compromised.

The judge's LLM call shells out to `gensynai/ree:v0.2.0 run`, captures the per-call receipt, and returns `{ text, receipt: { hash, url } }`. Receipt hash and URL are anchored on-chain via `VerdictLog.attachReceipt`, so anyone can re-run REE in verify mode and confirm the verdict was produced by the claimed model on the claimed inputs. The web UI's `VerdictCard` renders a *"verifiable inference"* badge linking to the receipt blob. Wire format and signing flow are **TEE-shaped** (separate enclave key, `/attestation` endpoint) so swapping in a real TEE later (Phala, Marlin) is a contained change.

### Audit trail

Every single response received over AXL from every agent is stored on **0G Storage** for content-addressed audit. Combined with REE receipts, the full proceeding is end-to-end retraceable. Anyone can replay the trial from chain data alone.

## Stack

### 0G

All contracts are deployed on 0G:

- `AgentRegistry`, `TribunalCore`, `EscrowAdapter`, `TribunalEscrow`, `VerdictLog`, `JudgeINFT`, `RuleBook`, `RuleBookGovernor`.

Judges are **iNFTs (ERC-7857)** — evolving NFTs with an append-only log of case-ruling hashes that form the judge's **evolving precedent memory**. **0G Storage** holds the content-addressed audit trail for the whole dispute. **0G explorers** are linked across the project for every contract, address, and transaction.

#### Live deployments (0G Galileo testnet, chainId 16602)

| Contract | Address |
|----------|---------|
| `AgentRegistry` | [0xF00d39c7d4Ab0947f2416D8Bcd60A6b6B2382fF2](https://chainscan-galileo.0g.ai/address/0xF00d39c7d4Ab0947f2416D8Bcd60A6b6B2382fF2) |
| `TribunalCore` | [0x2596a27aC54B55D8A428D1a2C0D385C389580C5c](https://chainscan-galileo.0g.ai/address/0x2596a27aC54B55D8A428D1a2C0D385C389580C5c) |
| `EscrowAdapter` | [0x76eEF0413a8291539ca338fe10e16e27780a944E](https://chainscan-galileo.0g.ai/address/0x76eEF0413a8291539ca338fe10e16e27780a944E) |
| `TribunalEscrow` | [0x414e7961514F9088Fe1aF6c8AFea27CbBFdA494E](https://chainscan-galileo.0g.ai/address/0x414e7961514F9088Fe1aF6c8AFea27CbBFdA494E) |
| `VerdictLog` | [0xF7a33F84398156bFc70f0c484e535F01d23fF401](https://chainscan-galileo.0g.ai/address/0xF7a33F84398156bFc70f0c484e535F01d23fF401) |
| `JudgeINFT` | [0x3B59b0c43066C2b3B05b4a8261310399B998CFFc](https://chainscan-galileo.0g.ai/address/0x3B59b0c43066C2b3B05b4a8261310399B998CFFc) |
| `RuleBook` | [0xc4209F03dfE7695A3b74ECc18fBd013Ca651b4aD](https://chainscan-galileo.0g.ai/address/0xc4209F03dfE7695A3b74ECc18fBd013Ca651b4aD) |
| `RuleBookGovernor` | [0x437a6f4E8948CA6D07753f81eb7B6C56a1C7181C](https://chainscan-galileo.0g.ai/address/0x437a6f4E8948CA6D07753f81eb7B6C56a1C7181C) |
| Deployer | [0x369db11Fbdfe58e307B35776c4b7Fca4AE7eA0C4](https://chainscan-galileo.0g.ai/address/0x369db11Fbdfe58e307B35776c4b7Fca4AE7eA0C4) |

RPC: `https://evmrpc-testnet.0g.ai` · Explorer: [`chainscan-galileo.0g.ai`](https://chainscan-galileo.0g.ai)

### ENS

Every agent (judge, lawyer, litigant, clerk) gets an **ENSIP-25 verifiable identity** as a subname of `tribunal.eth` on Sepolia, with text records:

- `verified-agent:eip155:16602:<registry>:<addr>`
- `agent.role`
- `agent.axl-peer-id`
- `agent.pubkey`
- `agent.credentials`

The Sepolia name is cross-linked to the agent's entry in the 0G `AgentRegistry` via an **ERC-7930 interoperable address**. User agents receive memorable subnames (e.g. `amber-fox.tribunal.eth`) auto-allocated from a 200+ word adjective/noun list, deterministically derived from the wallet.

The entire **legal rulebook is ENS-anchored**. `RuleBook.sol` on 0G stores only `(articleId, ensNode, chapter)` tuples; each article's title and body lives as ENS text records (`description`, `tribunal.title`, `tribunal.chapter`) on `chapter-X-Y.rulebook.tribunal.eth` subnames. Judges resolve these at deliberation time to cite from the corpus.

### Gensyn

**AXL** is the P2P transport between every Tribunal agent. `agents/src/transport/axl.ts` wraps the local Go node's HTTP API:

- `/send` with `X-Destination-Peer-Id`
- `/recv` long-poll
- `/topology` for own peer id

Four nodes run side-by-side: **clerk, lawyer-A, lawyer-B, judge**. All courtroom traffic (case filing, evidence, lawyer arguments, judge rulings, receipt envelopes) flows over AXL instead of any centralised broker. Each agent's hex64 ed25519 peer id is published as the `agent.axl-peer-id` ENS text record, so peers can discover and verify each other end-to-end.

**REE** powers verifiable judge inference (see [Verifiable judge inference](#verifiable-judge-inference) above).

## Quickstart

Run a full case end-to-end on a local hardhat node, no API keys, no external services:

```bash
npm install
npm run demo
```

That boots the chain, deploys all contracts, mints a judge iNFT, files a dispute, runs the trial (canned LLM, in-memory AXL, in-memory 0G Storage), and asserts on-chain state.

## Running against real infrastructure

```bash
cp .env.example .env   # fill OG_PRIVATE_KEY, OG_RPC_URL, ANTHROPIC_API_KEY, MCP vars

# 1. Deploy contracts to 0G testnet
cd contracts && npm install && npm run deploy:0g

# 2. Build and run four AXL nodes locally (clerk, lawyer-A, lawyer-B, judge)
#    https://docs.gensyn.ai/tech/agent-exchange-layer/get-started

# 3. Drive a case
cd ../agents && npm install && npm run build && node dist/runner.js

# 4. Watch the trial stream
cd ../web && npm install && npm run dev   # http://localhost:3000
```

Cases are filed through the **MCP server** in `mcp/`. Any MCP-compatible client (Claude Desktop, custom agent runtimes) can call `tribunal_file_case`, `tribunal_submit_evidence`, etc. See `mcp/README.md` for the tool list and client config.

## Layout

```
contracts/   Hardhat, solc 0.8.27, EVM cancun. 25/25 tests.
agents/      Vitest + TypeScript. Transport, LLM, storage, identity, roles, runner. 48/48 tests.
              enclave/  REE wrapper for judge inference
              rulebook/ ENS-anchored rulebook articles
web/         Next.js 14 App Router. Live trial (SSE), verdict, judges, escrow.
mcp/         @tribunal/mcp stdio server. Signs locally.
scripts/     ENS publisher, demo orchestration.
docs/        Architecture, deployments, demo script.
```

## Tests

```
contracts: 25/25  (hardhat)
agents:    48/48  (vitest)
demo:       5/5   (end-to-end on local hardhat)
```

## More

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Live deployments: [`docs/deployments.md`](docs/deployments.md)
- Demo walkthrough: [`docs/demo-script.md`](docs/demo-script.md)

## Built on

- [0G Labs](https://0g.ai) — ERC-7857 iNFT primitive, 0G Chain, 0G Storage.
- [Gensyn](https://gensyn.ai) — AXL P2P transport, REE reproducible inference.
- [ENS](https://ens.domains) — ENSIP-25 verifiable agent identity, rulebook anchors.
