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
- `tribunal_file_case` — file a new case
- `tribunal_get_case` — case state + events
- `tribunal_list_cases` — list cases (filter by party / status)
- `tribunal_get_verdict` — settled-case ruling
- `tribunal_inbox` / `tribunal_my_cases` — open cases involving you + pending Q count
- `tribunal_submit_evidence` — append evidence to a case docket
- `tribunal_get_docket` — read the full docket for a case
- `tribunal_answer_question` — answer a question a lawyer or judge posed to you
