#!/bin/bash
# Start the clawfarm dashboard + optionally a live agent process.
#
# Usage:
#   ./start.sh [--mode demo|dev|prod] [--config <path>]
#
# Modes:
#   demo  — Dashboard with mock data only. No agent process started.
#   dev   — Mock data + live agent (default). Starts both dashboard and agent.
#   prod  — Live agents only. Starts both dashboard and agent.
#
# Default config: agent-base/configs/example.json

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="dev"
CONFIG="$SCRIPT_DIR/agent-base/configs/example.json"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --config)
      CONFIG="$2"
      shift 2
      ;;
    *)
      CONFIG="$1"
      shift
      ;;
  esac
done

# Validate mode
if [[ "$MODE" != "demo" && "$MODE" != "dev" && "$MODE" != "prod" ]]; then
  echo "Error: Invalid mode '$MODE'. Use demo, dev, or prod."
  exit 1
fi

PIDS=()

cleanup() {
  echo ""
  echo "[start] Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null
  done
  echo "[start] Done."
}
trap cleanup EXIT INT TERM

# Start farm dashboard
echo "[start] Starting farm dashboard on port 3847 [mode: $MODE]..."
cd "$SCRIPT_DIR/farm"
npx tsx src/server.ts --mode "$MODE" &
PIDS+=($!)

# Wait for farm to be ready
for i in $(seq 1 10); do
  if curl -sf http://localhost:3847/api/config > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Start agent process (dev/prod only)
if [[ "$MODE" != "demo" ]]; then
  # Load API key from .env and export for openclaw
  if [ -f "$SCRIPT_DIR/.env" ]; then
    CLAUDE_KEY=$(grep '^CLAUDE_API_KEY=' "$SCRIPT_DIR/.env" | cut -d= -f2)
    if [ -n "$CLAUDE_KEY" ]; then
      export ANTHROPIC_API_KEY="$CLAUDE_KEY"
    fi
  fi

  echo "[start] Starting agent with config: $CONFIG"
  cd "$SCRIPT_DIR/agent-base"
  npx tsx src/runner.ts --config "$CONFIG" &
  PIDS+=($!)
fi

echo ""
echo "=========================================="
echo "  Farm dashboard: http://localhost:3847"
echo "  Mode:           $MODE"
if [[ "$MODE" != "demo" ]]; then
  echo "  Agent config:   $CONFIG"
fi
echo "  Press Ctrl+C to stop"
echo "=========================================="
echo ""

wait
