#!/usr/bin/env bash
# Boot four local AXL nodes (clerk + lawyer-A + lawyer-B + judge) in
# hub-and-spoke layout. Uses ~/axl-src/node binary and ~/.tribunal-axl
# config + key directory. Idempotent — kills any existing AXL nodes first.
#
# Pre-reqs (one-time):
#   1. Install Go 1.25:           brew install go@1.25
#   2. Build the AXL node:        git clone https://github.com/gensyn-ai/axl.git ~/axl-src
#                                 cd ~/axl-src && go build -o node ./cmd/node/
#   3. Install OpenSSL via brew:  brew install openssl
#
# Run:
#   ./scripts/axl-up.sh           # boots and waits in foreground
#   ./scripts/axl-up.sh --bg      # boots and exits (logs in ~/.tribunal-axl/*.log)
#
# Tails:
#   tail -f ~/.tribunal-axl/clerk.log

set -euo pipefail

NODE_BIN="${HOME}/axl-src/node"
DIR="${HOME}/.tribunal-axl"
OPENSSL=/opt/homebrew/opt/openssl/bin/openssl

if [[ ! -x "$NODE_BIN" ]]; then
  echo "[axl-up] $NODE_BIN not found. Build it first:"
  echo "         git clone https://github.com/gensyn-ai/axl.git ~/axl-src"
  echo "         cd ~/axl-src && go build -o node ./cmd/node/"
  exit 1
fi

mkdir -p "$DIR" && cd "$DIR"

# Generate keys once (idempotent).
for n in clerk lawyerA lawyerB judge; do
  if [[ ! -f "$n.pem" ]]; then
    echo "[axl-up] generating ed25519 key for $n"
    "$OPENSSL" genpkey -algorithm ed25519 -out "$n.pem"
  fi
done

# Write configs. tcp_port is shared (AXL gVisor virtual port, no host
# conflict). api_ports differ. Spokes dial the clerk's TLS hub on :9001.
cat > clerk.json   <<'EOF'
{ "PrivateKeyPath": "clerk.pem", "Peers": [], "Listen": ["tls://0.0.0.0:9001"], "api_port": 9002, "tcp_port": 7001 }
EOF
cat > lawyerA.json <<'EOF'
{ "PrivateKeyPath": "lawyerA.pem", "Peers": ["tls://127.0.0.1:9001"], "Listen": [], "api_port": 9012, "tcp_port": 7001 }
EOF
cat > lawyerB.json <<'EOF'
{ "PrivateKeyPath": "lawyerB.pem", "Peers": ["tls://127.0.0.1:9001"], "Listen": [], "api_port": 9022, "tcp_port": 7001 }
EOF
cat > judge.json   <<'EOF'
{ "PrivateKeyPath": "judge.pem", "Peers": ["tls://127.0.0.1:9001"], "Listen": [], "api_port": 9032, "tcp_port": 7001 }
EOF

# Kill any existing nodes.
pkill -f "$NODE_BIN" 2>/dev/null || true
sleep 1

# Boot.
for n in clerk lawyerA lawyerB judge; do
  echo "[axl-up] starting $n -> $DIR/$n.log"
  ( "$NODE_BIN" -config "$n.json" >"$n.log" 2>&1 ) &
done

# Wait for all four api endpoints.
for p in 9002 9012 9022 9032; do
  for i in {1..20}; do
    if curl -fs http://127.0.0.1:$p/topology >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
done

echo "[axl-up] all four nodes responding:"
for p in 9002 9012 9022 9032; do
  key=$(curl -fs http://127.0.0.1:$p/topology | python3 -c 'import sys,json; print(json.load(sys.stdin)["our_public_key"][:16])')
  echo "  :$p $key…"
done

# Wait for spanning tree to form (each spoke should see at least 2 nodes).
for i in {1..20}; do
  ok=1
  for p in 9012 9022 9032; do
    n=$(curl -fs http://127.0.0.1:$p/topology | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["tree"]))')
    [[ "$n" -lt 2 ]] && ok=0
  done
  [[ "$ok" -eq 1 ]] && break
  sleep 0.5
done

echo "[axl-up] spanning tree formed. Use AXL_USE_REAL=1 in agents/demo."
if [[ "${1:-}" != "--bg" ]]; then
  echo "[axl-up] press Ctrl+C to stop the nodes (or run './scripts/axl-down.sh')"
  trap 'pkill -f "$NODE_BIN" 2>/dev/null; exit 0' INT TERM
  wait
fi
