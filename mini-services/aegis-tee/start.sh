#!/bin/bash
# Start the Aegis FCC extension TEE daemon.
#
# Publishes real solvency proofs to the SolvencyRoot contract on Flare Coston2
# by running the Go extension's OnChainPublisher. This is the quickest way to
# run the on-chain solvency publisher during local development without needing
# the full Docker Compose stack.
#
# Usage:
#   export AEGIS_VERIFIER_PRIVATE_KEY=0x...   # verifier key (must hold VERIFIER role)
#   ./mini-services/aegis-tee/start.sh
#
# All paths are resolved relative to this script, so it works from any clone.
set -euo pipefail

# ─── Resolve paths relative to this script ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXT_DIR="$REPO_ROOT/extension"
LOG_FILE="$REPO_ROOT/extension-tee.log"
BIN_PATH="$EXT_DIR/bin/aegis-extension"

# ─── Ensure Go is on PATH ───────────────────────────────────────────────────
export PATH="$PATH:$HOME/go/bin:/usr/local/go/bin"

if ! command -v go >/dev/null 2>&1; then
  echo "ERROR: Go is not installed or not on PATH." >&2
  echo "Install from https://go.dev/dl/ and re-run." >&2
  exit 1
fi

# ─── Validate required env var ──────────────────────────────────────────────
if [ -z "${AEGIS_VERIFIER_PRIVATE_KEY:-}" ]; then
  echo "ERROR: AEGIS_VERIFIER_PRIVATE_KEY is not set." >&2
  echo "Set it to the verifier key that holds the VERIFIER role on VerifierRole." >&2
  exit 1
fi

# ─── Build the extension (always rebuild so code fixes take effect) ─────────
echo "Building Aegis extension in $EXT_DIR ..."
(
  cd "$EXT_DIR"
  go build -o "$BIN_PATH" ./cmd/main.go
)

# ─── Kill any existing instance ─────────────────────────────────────────────
pkill -f aegis-extension 2>/dev/null || true
sleep 1

# ─── Start the daemon with Coston2 defaults (override via env) ──────────────
cd "$EXT_DIR"
AEGIS_SOLVENCY_ROOT_ADDRESS="${AEGIS_SOLVENCY_ROOT_ADDRESS:-0xf52c1fd632d853ee46a48a82064d3f5d390f057d}" \
AEGIS_VAULT_CORE_ADDRESS="${AEGIS_VAULT_CORE_ADDRESS:-0xcb08be1cc86d3f94c54c64682372e32f669134bc}" \
AEGIS_RPC_URL="${AEGIS_RPC_URL:-https://coston2-api.flare.network/ext/C/rpc}" \
AEGIS_VAULT_SCAN_FROM_BLOCK="${AEGIS_VAULT_SCAN_FROM_BLOCK:-33647000}" \
setsid nohup "$BIN_PATH" > "$LOG_FILE" 2>&1 < /dev/null &

DAEMON_PID=$!
disown "$DAEMON_PID" 2>/dev/null || true

echo "Started Aegis TEE daemon PID=$DAEMON_PID"
echo "Log:            $LOG_FILE"
echo "State endpoint: http://localhost:8080/state"
