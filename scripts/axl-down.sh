#!/usr/bin/env bash
# Stop all local AXL nodes started by axl-up.sh.
set -euo pipefail
pkill -f "${HOME}/axl-src/node" 2>/dev/null || true
echo "[axl-down] stopped."
