#!/usr/bin/env bash
# demo-up.sh — boot the full Tribunal demo stack on this machine.
#
# What it starts (in order):
#   AXL ×4  → clerk + lawyerA + lawyerB + judge on :9002/:9012/:9022/:9032
#   Backend → Next.js prod on :3100
#   Runner  → subscribes to CaseFiled, drives trial + auto-settle
#   REE     → optional, only if JUDGE_LLM_PROVIDER=ree (port :9000)
#
# Flags:
#   --clean     wipe build artifacts + per-case state, then rebuild (~5 min)
#   --no-axl    skip AXL boot (useful if AXL already running and you trust it)
#   --ree       force-start the REE enclave even if env doesn't request it
#   --skip-runner  skip runner boot (lets you start it manually with extra flags)
#
# Tail logs:
#   AXL:     ~/.tribunal-axl/{clerk,lawyerA,lawyerB,judge}.log
#   Backend: $LOG_DIR/backend.log
#   Runner:  $LOG_DIR/runner.log
#   REE:     $LOG_DIR/ree.log
#
# Stop everything: ./scripts/demo-down.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/.demo-logs"
mkdir -p "$LOG_DIR"

CLEAN=0
START_AXL=1
START_REE_FLAG=0
START_RUNNER=1
for arg in "$@"; do
  case "$arg" in
    --clean)        CLEAN=1 ;;
    --no-axl)       START_AXL=0 ;;
    --ree)          START_REE_FLAG=1 ;;
    --skip-runner)  START_RUNNER=0 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *)
      echo "[demo-up] unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;36m[demo-up]\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; }

# ---------------------------------------------------------------------------
# Step 1: kill everything
# ---------------------------------------------------------------------------
log "killing existing services..."
pkill -f "agents/dist/runner.js" 2>/dev/null || true
pkill -f "next start"            2>/dev/null || true
pkill -f "next dev"              2>/dev/null || true
pkill -f "axl-src/node"          2>/dev/null || true
pkill -f "enclave/dist/server"   2>/dev/null || true
pkill -f "tsx.*enclave"          2>/dev/null || true
sleep 2
for port in 3100 9000 9002 9012 9022 9032; do
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [[ -n "$pid" ]]; then kill -9 $pid 2>/dev/null || true; fi
done
ok "all stopped"

# ---------------------------------------------------------------------------
# Step 2: optional clean rebuild
# ---------------------------------------------------------------------------
if [[ $CLEAN -eq 1 ]]; then
  log "clean: wiping build artifacts + per-case state..."
  rm -rf web/.next web/.turbo agents/dist agents/enclave/dist
  rm -rf web/var/dockets web/var/questions
  mkdir -p web/var/dockets web/var/questions
  rm -f .events-*.jsonl .verdict-*.json
  ok "cleaned"

  log "rebuilding agents..."
  ( cd agents && npx tsc -p . ) >"$LOG_DIR/build-agents.log" 2>&1 || {
    err "agents build failed; see $LOG_DIR/build-agents.log"; exit 1; }
  ok "agents built"

  log "rebuilding web (production)..."
  ( cd web && npm run build ) >"$LOG_DIR/build-web.log" 2>&1 || {
    err "web build failed; see $LOG_DIR/build-web.log"; exit 1; }
  ok "web built"

  if [[ -d agents/enclave/src ]]; then
    log "rebuilding enclave..."
    ( cd agents/enclave && npx tsc -p . ) >"$LOG_DIR/build-enclave.log" 2>&1 || {
      err "enclave build failed (continuing without REE); see $LOG_DIR/build-enclave.log"; }
    ok "enclave built"
  fi
fi

# ---------------------------------------------------------------------------
# Step 3: AXL nodes
# ---------------------------------------------------------------------------
if [[ $START_AXL -eq 1 ]]; then
  log "booting AXL ×4..."
  # axl-up.sh ends with a cosmetic 'unbound variable' warning; tolerate it.
  ./scripts/axl-up.sh --bg >>"$LOG_DIR/axl-up.log" 2>&1 || true
  sleep 2
  for p in 9002 9012 9022 9032; do
    if curl -sf "http://127.0.0.1:$p/topology" >/dev/null; then
      ok "AXL :$p"
    else
      err "AXL :$p NOT responding"; exit 1
    fi
  done
fi

# ---------------------------------------------------------------------------
# Step 4: Backend (Next.js prod on :3100)
# ---------------------------------------------------------------------------
log "booting backend on :3100..."
( cd web && nohup npm run start -- -p 3100 >"$LOG_DIR/backend.log" 2>&1 ) &
disown $! 2>/dev/null || true
DEADLINE=$(( $(date +%s) + 90 ))
until curl -sf http://localhost:3100/api/cases >/dev/null 2>&1; do
  if (( $(date +%s) > DEADLINE )); then err "backend never came up; tail $LOG_DIR/backend.log"; exit 1; fi
  sleep 1
done
ok "backend :3100"

# ---------------------------------------------------------------------------
# Step 5: REE enclave (optional)
# ---------------------------------------------------------------------------
JUDGE_LLM=${JUDGE_LLM_PROVIDER:-}
if [[ $START_REE_FLAG -eq 1 ]] || [[ "$JUDGE_LLM" == "ree" ]]; then
  if [[ ! -f agents/enclave/dist/server.js ]]; then
    err "REE requested but agents/enclave/dist/server.js missing — re-run with --clean"
    exit 1
  fi
  log "booting REE enclave on :9000..."
  ( cd agents/enclave && PORT=9000 nohup node dist/server.js >"$LOG_DIR/ree.log" 2>&1 ) &
  disown $! 2>/dev/null || true
  DEADLINE=$(( $(date +%s) + 30 ))
  until curl -sf http://localhost:9000/health >/dev/null 2>&1; do
    if (( $(date +%s) > DEADLINE )); then err "REE never came up; tail $LOG_DIR/ree.log"; exit 1; fi
    sleep 1
  done
  ok "REE :9000"
else
  log "skipping REE (set JUDGE_LLM_PROVIDER=ree or pass --ree to enable)"
fi

# ---------------------------------------------------------------------------
# Step 6: Runner
# ---------------------------------------------------------------------------
if [[ $START_RUNNER -eq 1 ]]; then
  log "booting runner..."
  TRIBUNAL_QA_TIMEOUT_MS=${TRIBUNAL_QA_TIMEOUT_MS:-1800000} \
    nohup node agents/dist/runner.js >"$LOG_DIR/runner.log" 2>&1 &
  disown $! 2>/dev/null || true
  DEADLINE=$(( $(date +%s) + 60 ))
  until grep -q "Runner ready" "$LOG_DIR/runner.log" 2>/dev/null; do
    if (( $(date +%s) > DEADLINE )); then err "runner never reached 'Runner ready'; tail $LOG_DIR/runner.log"; exit 1; fi
    sleep 2
  done
  ok "runner ready"
else
  log "skipping runner (start it manually when you want)"
fi

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
echo
log "=== stack up ==="
[[ $START_AXL -eq 1 ]]    && echo "  AXL      → :9002 :9012 :9022 :9032   (logs: ~/.tribunal-axl/*.log)"
echo                                "  backend  → http://localhost:3100   (logs: $LOG_DIR/backend.log)"
[[ $START_RUNNER -eq 1 ]] && echo   "  runner   → subscribed to CaseFiled (logs: $LOG_DIR/runner.log)"
[[ $START_REE_FLAG -eq 1 || "$JUDGE_LLM" == "ree" ]] && echo "  REE      → http://localhost:9000   (logs: $LOG_DIR/ree.log)"
echo
echo "Tail any log with: tail -F $LOG_DIR/<service>.log"
echo "Stop everything with: ./scripts/demo-down.sh"
