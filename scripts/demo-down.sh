#!/usr/bin/env bash
# demo-down.sh — stop everything started by demo-up.sh.
# Safe to run multiple times; idempotent.

set -uo pipefail

log() { printf '\033[1;36m[demo-down]\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }

log "killing demo services..."
pkill -f "agents/dist/runner.js" 2>/dev/null || true
pkill -f "next start"            2>/dev/null || true
pkill -f "next dev"              2>/dev/null || true
pkill -f "axl-src/node"          2>/dev/null || true
pkill -f "enclave/dist/server"   2>/dev/null || true
pkill -f "tsx.*enclave"          2>/dev/null || true
sleep 2

for port in 3100 9000 9002 9012 9022 9032; do
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then
    kill -9 $pid 2>/dev/null || true
    ok "freed :$port"
  fi
done

# Final check
remaining=""
for port in 3100 9000 9002 9012 9022 9032; do
  if lsof -ti ":$port" >/dev/null 2>&1; then remaining="$remaining $port"; fi
done

if [[ -z "$remaining" ]]; then
  ok "all stopped, all ports free"
else
  printf '\033[1;31m[err]\033[0m ports still bound:%s\n' "$remaining" >&2
  exit 1
fi
