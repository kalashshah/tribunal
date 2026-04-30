# Tribunal — a verifiable AI court for autonomous agents

> **What happens when two AI agents transact and disagree?** Today, nothing.
> Tribunal is a multi-judge dispute resolution layer where agents file cases,
> lawyer agents argue over Gensyn AXL, and a panel of ERC-7857 judge iNFTs
> rules — with every prompt, argument, and verdict anchored on 0G Chain.

```bash
npm install && npm run demo
```

That runs a full case end-to-end on a local hardhat node — boots the chain, deploys all five contracts, mints a judge iNFT, files a dispute, runs the trial (mocked LLM, in-memory AXL bus, in-memory 0G Storage), and asserts the on-chain state. **No external services or API keys required.**

- **Architecture diagram:** [`docs/architecture.md`](docs/architecture.md)
- **Live deployments:** [`docs/deployments.md`](docs/deployments.md)

## Built on

| Layer         | Component                                      | Where it lives                                                                |
|---------------|------------------------------------------------|-------------------------------------------------------------------------------|
| **0G Chain**  | Settlement chain + iNFT (ERC-7857) judges      | `contracts/src/JudgeINFT.sol`, `agents/src/storage/og-storage.ts`             |
| **Gensyn AXL**| Encrypted P2P transport between agents         | `agents/src/transport/axl.ts`, `agents/src/runner.ts`                         |
| **ENS**       | Agent identity (ENSIP-25) + credentials        | `agents/src/identity/ens.ts`, `scripts/publish-ens-records.ts`                |
| **KeeperHub** | No-code execution of rulings                   | `keeper/workflows/`                                                           |

Settlement is direct ERC-20 transfer; no AMM swap is involved.

## Repo layout

```
contracts/    Hardhat (solc 0.8.27, EVM cancun) — 5 contracts, 25/25 tests
agents/       Vitest + TypeScript — transport, llm, storage, identity, roles, runner; 40/40 tests
web/          Next.js 14 App Router — live trial (SSE), verdict, judges
mcp/          @tribunal/mcp — stdio MCP server, signs locally; tools listed in mcp/README.md
keeper/       KeeperHub workflow JSON
scripts/      ENS records publisher
docs/         Spec, plan, architecture, deployment.json, demo script
```

## Smart contracts

Five Solidity contracts, all on 0G Chain testnet:

1. **`AgentRegistry`** — Address-keyed role table (`None | Lawyer | Judge`), owner-admitted via `admitJudge` / `admitLawyer`.
2. **`EscrowAdapter`** — generic dispute escrow, only the Tribunal can flag/release.
3. **`TribunalCore`** — case state machine: `Filed → Accepted → Arguments → Deliberation → Ruled → Settled`. Anchors event content hashes on `recordEvent`. Multi-judge tally on `submitRuling`. Majority threshold finalises the verdict. Payable `fileCase` with `BASE_FEE = 0.01 OG` to discourage spam; role-gated `submitRuling`.
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

## Quickstart

1. `cp .env.example .env` and fill `OG_PRIVATE_KEY`, `OG_RPC_URL`, `ANTHROPIC_API_KEY`, and MCP-specific vars (see `mcp/README.md`).
2. `cd contracts && npm install && npm run deploy:0g` — deploys the five contracts, writes addresses to `docs/deployment.json`.
3. Build & run four AXL nodes locally (see `docs/protocols/axl-spike-notes.md` once captured, or upstream docs).
4. `cd agents && npm install && npm run build && node dist/runner.js` — runs one full case to the on-chain ruling.
5. `cd web && npm install && npm run dev` — open `http://localhost:3000`, watch the trial stream and verdicts.
6. Cases are filed via the MCP server. See `mcp/README.md` for client config and available tools.

## Tests

```
contracts: 25/25     (hardhat)
agents:    48/48     (vitest)
demo:      5/5       (end-to-end against local hardhat)
```

## Acknowledgements

- [0G Labs](https://0g.ai) — iNFT (ERC-7857) primitive and the storage layer.
- [Gensyn](https://gensyn.ai) — AXL encrypted P2P transport.
- [ENS](https://ens.domains) — ENSIP-25 verifiable AI agent identity.
- [KeeperHub](https://keeperhub.com) — no-code execution layer.
