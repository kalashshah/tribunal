# Tribunal — Live Deployments

Deployed: **2026-04-26**

## 0G Galileo Testnet (chainId 16602)

- RPC: `https://evmrpc-testnet.0g.ai`
- Explorer: https://chainscan-galileo.0g.ai
- Deployer: `0x369db11Fbdfe58e307B35776c4b7Fca4AE7eA0C4`

| Contract         | Address                                      |
| ---------------- | -------------------------------------------- |
| AgentRegistry    | `0x1B32D545e91a1dD11efb5B8e8336369103C4Cc4C` |
| TribunalCore     | `0xC434C901a184c06Bb8911708B65267bD4e6A68a7` |
| EscrowAdapter    | `0xE673BAF7C25A7B42e62C668B1562aDA81311F93d` |
| VerdictLog       | `0xDBffDCc253Da588549C4d82167d1d5100D9a050a` |
| JudgeINFT        | `0x1Bb3C9f7315A3E7787174f9Ddd516cF45DdF08d4` |
| RuleBookGovernor | _pending next 0G redeploy_                   |

Explorer links:
- [AgentRegistry](https://chainscan-galileo.0g.ai/address/0x1B32D545e91a1dD11efb5B8e8336369103C4Cc4C)
- [TribunalCore](https://chainscan-galileo.0g.ai/address/0xC434C901a184c06Bb8911708B65267bD4e6A68a7)
- [EscrowAdapter](https://chainscan-galileo.0g.ai/address/0xE673BAF7C25A7B42e62C668B1562aDA81311F93d)
- [VerdictLog](https://chainscan-galileo.0g.ai/address/0xDBffDCc253Da588549C4d82167d1d5100D9a050a)
- [JudgeINFT](https://chainscan-galileo.0g.ai/address/0x1Bb3C9f7315A3E7787174f9Ddd516cF45DdF08d4)

### 0G Storage roots

The rulebook is content-addressed on 0G Storage. The `RuleBookGovernor`
contract anchors the base `rootHash` plus an append-only list of amendment
roots; anyone can re-derive the canonical rulebook manifest off-chain.

| Artifact                    | rootHash (memory: keccak of file bytes)                              |
| --------------------------- | -------------------------------------------------------------------- |
| `unidroit-v1.json` (base)   | `0xbab219d2d001328ce9852aec407f5c3be450502c376e5ab6461a3cc99700f7f2` |

Local-Hardhat seed records live at `docs/rulebook.json`. On a 0G redeploy,
re-run `contracts/scripts/seed-rulebook.ts` with `RULEBOOK_BACKEND=0g` to
get the real 0G `rootHash` + storagescan link.

## ENS (Sepolia)

Parent: `tribunal.eth`

| Subname                    | Role     |
| -------------------------- | -------- |
| `alice.tribunal.eth`       | accuser  |
| `bob.tribunal.eth`         | defendant|
| `judge-athena.tribunal.eth`| judge    |

Each carries an ENSIP-25 `verified-agent` text record + role + AXL peer ID + credentials.

View: https://app.ens.domains/alice.tribunal.eth

## KeeperHub

Host: https://app.keeperhub.com

| Workflow             | ID                       | Trigger                                  |
| -------------------- | ------------------------ | ---------------------------------------- |
| tribunal-ruling-watch| `rxql03zl4l7ykraznls93`  | Event: `VerdictPosted` on VerdictLog     |
| tribunal-deadline-scan| `s7y1f8xmz3g9yfbelbikk` | Schedule: `*/10 * * * *`                 |

## Notes

- JSON source of truth: `docs/deployment.json`
- Re-run `pnpm --filter @tribunal/agents tsx scripts/register-keeperhub.ts` after editing workflow nodes — the script upserts by name.
- Re-run `pnpm --filter @tribunal/agents tsx scripts/publish-ens-records.ts` after rotating AXL peer IDs.
