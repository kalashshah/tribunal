# Tribunal — a verifiable AI court for autonomous agents

> **What happens when two AI agents transact and disagree?** Today, nothing.
> Tribunal is a multi-judge dispute resolution layer where agents file cases,
> lawyer agents argue over Gensyn AXL, and a panel of ERC-7857 judge iNFTs
> rules — with every prompt, argument, and verdict anchored on 0G Chain.

Hackathon project for **ETHGlobal Open Agents (April 2026)**.

```bash
npm install && npm run demo
```

That runs a full case end-to-end on a local hardhat node — boots the chain, deploys all five contracts, mints a judge iNFT, files a dispute, runs the trial (mocked LLM, in-memory AXL bus, in-memory 0G Storage), and asserts the on-chain state. **No external services or API keys required.**

- **Spec:** [`docs/superpowers/specs/2026-04-26-tribunal-design.md`](docs/superpowers/specs/2026-04-26-tribunal-design.md)
- **Implementation plan:** [`docs/superpowers/plans/2026-04-26-tribunal.md`](docs/superpowers/plans/2026-04-26-tribunal.md)
- **Architecture diagram:** [`docs/architecture.md`](docs/architecture.md)
- **Demo video script:** [`docs/demo-script.md`](docs/demo-script.md)

## Sponsor tracks targeted

| Sponsor       | Track                                          | Where it lives                                                                |
|---------------|------------------------------------------------|-------------------------------------------------------------------------------|
| **0G**        | Track B: Autonomous Agents & iNFT Innovations  | `contracts/src/JudgeINFT.sol` (ERC-7857), `agents/src/storage/og-storage.ts`  |
| **Gensyn**    | AXL                                            | `agents/src/transport/axl.ts`, `agents/src/runner.ts`                         |
| **ENS**       | Track A (Identity) + Track B (Creative)        | `agents/src/identity/ens.ts`, `scripts/publish-ens-records.ts`                |
| **KeeperHub** | Best Use of KeeperHub                          | `keeper/workflows/`                                                           |

Uniswap is intentionally not in scope — settlement is direct ERC-20 transfer; forcing a swap would be track-chasing.

## Repo layout

```
contracts/    Hardhat (solc 0.8.27, EVM cancun) — 5 contracts, 25/25 tests
agents/       Vitest + TypeScript — transport, llm, storage, identity, roles, runner; 40/40 tests
web/          Next.js 14 App Router — file dispute, live trial (SSE), verdict, judges
keeper/       KeeperHub workflow JSON
scripts/      ENS records publisher
docs/         Spec, plan, architecture, deployment.json, demo script
```

## Smart contracts

Five Solidity contracts, all on 0G Chain testnet:

1. **`AgentRegistry`** — minimal ERC-8004-style registry; ENS-keyed, role-tagged.
2. **`EscrowAdapter`** — generic dispute escrow, only the Tribunal can flag/release.
3. **`TribunalCore`** — case state machine: `Filed → Accepted → Arguments → Deliberation → Ruled → Settled`. Anchors event content hashes on `recordEvent`. Multi-judge tally on `submitRuling`. Majority threshold finalises the verdict.
4. **`VerdictLog`** — append-only public verdict log; the trigger surface for KeeperHub.
5. **`JudgeINFT`** — ERC-7857-compatible iNFT for judges. Encrypted persona via `metadataRoot`, evolving precedent memory via `appendRulingMemory`. Memory-writer role wired to the Tribunal so judges' rulings auto-update their iNFT.

```bash
cd contracts
cp ../.env.example ../.env  # then edit secrets
npm install
npm run test                 # 25 passing
npm run deploy:0g            # writes addresses to ../docs/deployment.json
```

## Agent runtime

```bash
cd agents
npm install
npm test                     # 40 passing
npm run build
node dist/runner.js          # drives a single case end-to-end
```

The runner needs four AXL nodes running locally on different ports (clerk, lawyer-A, lawyer-B, judge). Build & run AXL per https://docs.gensyn.ai/tech/agent-exchange-layer/get-started — `git clone github.com/gensyn-ai/axl && cd axl && go build -o node ./cmd/node/`.

## Web UI

```bash
cd web
npm install
npm run dev
# open http://localhost:3000
```

## Quickstart for graders

1. `cp .env.example .env` and fill `OG_PRIVATE_KEY`, `OG_RPC_URL`, `ANTHROPIC_API_KEY`.
2. `cd contracts && npm install && npm run deploy:0g` — deploys the five contracts, writes addresses to `docs/deployment.json`.
3. Build & run four AXL nodes locally (see `docs/protocols/axl-spike-notes.md` once captured, or upstream docs).
4. `cd agents && npm install && npm run build && node dist/runner.js` — runs one full case to the on-chain ruling.
5. `cd web && npm install && npm run dev` — open `http://localhost:3000`, file a dispute, watch the trial stream.

## Tests

```
contracts: 25/25     (hardhat)
agents:    48/48     (vitest)
demo:      5/5       (end-to-end against local hardhat)
```

## Acknowledgements

Built solo for ETHGlobal Open Agents in 10 days. Thanks to:

- [0G Labs](https://0g.ai) for the iNFT (ERC-7857) primitive and the storage layer.
- [Gensyn](https://gensyn.ai) for AXL — encrypted P2P that *just works* over localhost.
- [ENS](https://ens.domains) for ENSIP-25 (verifiable AI agent identity).
- [KeeperHub](https://keeperhub.com) for the no-code execution layer.
