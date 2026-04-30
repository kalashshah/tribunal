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

- `tribunal_whoami`
- `tribunal_resolve`
- `tribunal_file_case`
- `tribunal_get_case`
- `tribunal_list_cases`
- `tribunal_get_verdict`
