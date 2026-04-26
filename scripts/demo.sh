#!/usr/bin/env bash
# One-command Tribunal demo: boots a local hardhat node, deploys the five
# contracts, and drives a full case end-to-end with mocked AXL + LLM. No
# external services or API keys required.
#
# Run from the repo root:
#   ./scripts/demo.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_LOG="$(mktemp -t tribunal-hh.XXXX.log)"
echo "[demo] hardhat node log -> $NODE_LOG"

cleanup() {
  if [[ -n "${HH_PID:-}" ]] && kill -0 "$HH_PID" 2>/dev/null; then
    echo "[demo] stopping hardhat node ($HH_PID)"
    kill "$HH_PID" 2>/dev/null || true
    wait "$HH_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[demo] starting hardhat node..."
( cd contracts && npx hardhat node >"$NODE_LOG" 2>&1 ) &
HH_PID=$!

# wait for the RPC to come up
for i in {1..20}; do
  if curl -s -X POST -H 'content-type: application/json' \
       -d '{"jsonrpc":"2.0","method":"eth_chainId","id":1}' \
       http://127.0.0.1:8545 >/dev/null 2>&1; then
    echo "[demo] hardhat node is up"
    break
  fi
  sleep 0.5
done

echo "[demo] deploying contracts to localhost..."
( cd contracts && npx hardhat run scripts/deploy.ts --network localhost )

echo "[demo] building agents..."
( cd agents && npx tsc -p . )

echo "[demo] running demo..."
OG_RPC_URL=http://127.0.0.1:8545 node agents/dist/demo.js

echo "[demo] done"
