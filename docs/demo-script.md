# Demo script (under 3 minutes)

Goal: tell the story end-to-end with real on-chain state changes visible.
Practice the full run twice before hitting record.

## Pre-flight checklist

- [ ] Contracts deployed to 0G testnet, addresses present in `docs/deployment.json`
- [ ] At least one judge iNFT minted (run the runner once, or `seed-judges.ts`)
- [ ] AXL nodes running on ports 9002/9012/9022/9032 (clerk/lawyer-A/lawyer-B/judge)
- [ ] `.env` filled with `OG_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, AXL ports
- [ ] `cd web && npm run dev` running, browser open at `localhost:3000`
- [ ] KeeperHub workflow registered (optional for the demo — fall back to manual `EscrowAdapter.release` if not)
- [ ] One terminal tailing `agents/dist/runner.js` so the trial can be triggered live

## Beats

| t      | What's on screen                                                                | What you say                                                                                                                                                |
|--------|---------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0:00   | Title card "Tribunal — a verifiable AI court for autonomous agents"             | "When two AI agents transact and disagree, today there's no court. We built one."                                                                          |
| 0:08   | Landing page (`/`)                                                              | "Tribunal lets agents file disputes, lawyer agents argue over Gensyn AXL, and a panel of judge iNFTs rules — every event anchored on 0G Chain."             |
| 0:25   | `/judges` showing three judge cards from the iNFTs                              | "Judges are ERC-7857 iNFTs. Their persona is encrypted on 0G Storage. Their ruling history is on-chain memory that grows with every case."                  |
| 0:45   | Click "File a dispute"; fill the form (Alice vs Bob over a research-report escrow) | "Alice claims she delivered the report. Bob claims he never received it. They locked $100 in an EscrowAdapter. Alice files."                                |
| 1:05   | Trigger `node agents/dist/runner.js` in the side terminal                       | "The runner pulls the case off the queue, registers the agents, accepts the case. Three judges from the panel pick it up."                                  |
| 1:20   | Switch to `/case/1` — live trial stream filling in                              | "Lawyer Quinn opens for Alice. Lawyer Rivers opens for Bob. They rebut. They close. Every line streams in real time over Server-Sent Events."               |
| 2:10   | Each event's content hash being anchored on `TribunalCore.recordEvent`          | "Each message is uploaded to 0G Storage and its hash anchored on 0G Chain. The whole trial is replayable from on-chain data alone."                          |
| 2:25   | Judge agent ruling — verdict card flips to "Prevailing: Accuser"                | "Each judge deliberates independently. Once the threshold is met, the contract finalises by majority. The ruling is on-chain."                              |
| 2:40   | KeeperHub Discord ping; on-chain `EscrowReleased` event in the explorer          | "KeeperHub picks up the VerdictPosted event, releases escrow to Alice, marks the case settled, pings the parties. No human in the loop."                    |
| 2:55   | Tagline "A court for autonomous agents. Verifiable. Multi-judge. On-chain."     | "All sponsors used naturally — 0G for iNFTs and storage, Gensyn for transport, ENS for identity, KeeperHub for execution. Tribunal."                         |

## Recording tips

- Use Loom (browser tab + voice) for one-take recording; trim only.
- Pre-fill the dispute form so on-screen typing isn't slow.
- Resize terminal to be readable in a small inset window.
- Don't show RPC keys or `.env` contents.
