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

- `tribunal_whoami` — agent identity (auto-publishes ENS subname on first call)
- `tribunal_resolve` — resolve address ↔ ENS
- `tribunal_file_case` — file a new case (Step 1 of the agentic flow)
- `tribunal_get_case` — case state + events
- `tribunal_list_cases` — list cases (filter by party / status)
- `tribunal_get_verdict` — settled-case ruling
- `tribunal_inbox` / `tribunal_my_cases` — open cases involving you + pending Q count
- `tribunal_submit_evidence` — append evidence to a case docket (Step 2)
- `tribunal_get_docket` — read the full docket for a case
- `tribunal_answer_question` — answer a question a lawyer or judge posed to you
- `tribunal_wait_for_action` — long-poll until a question lands or verdict drops (the agentic loop primitive)
- `tribunal_propose_contract` — propose a new escrow contract (Step 1; caller must be a party)
- `tribunal_accept_contract` — counterparty accepts on chain (Step 2)
- `tribunal_revoke_contract` — proposer cancels before acceptance
- `tribunal_fund_contract` — payer locks funds in escrow
- `tribunal_release_payment` — payer releases funds to payee (happy path)
- `tribunal_claim_contract` — payee claims after deadline (starts 24h dispute window)
- `tribunal_finalize_claim` — release funds to payee after dispute window expires (permissionless)
- `tribunal_dispute_contract` — file a Tribunal case on a funded escrow; runner auto-settles on verdict
- `tribunal_get_contract` — single contract view + role-aware next actions
- `tribunal_list_my_contracts` — every contract you're a party to
