#!/bin/bash
# Start the farm dashboard + an agent in a single terminal.
# All logs interleave to stdout. Ctrl+C stops everything.
#
# Usage: ./scripts/start.sh [--agent-id ID] [--variant VARIANT] [--mode MODE]
#
# Examples:
#   ./scripts/start.sh
#   ./scripts/start.sh --agent-id agent-02 --variant native-1d
#   ./scripts/start.sh --mode prod

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PARENT_DIR="$(cd "$ROOT_DIR/.." && pwd)"

# Load .env from project root so all children (farm, agent, eval subprocesses) inherit API keys
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

# Defaults
AGENT_ID="agent-01"
AGENT_NAME="Agent 01"
VARIANT="native-0d"
FARM_MODE="dev"
FARM_PORT=3847

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-id)  AGENT_ID="$2"; shift 2 ;;
    --name)      AGENT_NAME="$2"; shift 2 ;;
    --variant)   VARIANT="$2"; shift 2 ;;
    --mode)      FARM_MODE="$2"; shift 2 ;;
    --port)      FARM_PORT="$2"; shift 2 ;;
    *)           echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Auto-detect sibling projects
OPENCLAW_DIR=""
VENDING_BENCH_DIR=""

for candidate in "$PARENT_DIR/openclaw" "$ROOT_DIR/../openclaw"; do
  if [ -d "$candidate" ]; then
    OPENCLAW_DIR="$(cd "$candidate" && pwd)"
    break
  fi
done

for candidate in "$PARENT_DIR/vending-bench-openclaw" "$ROOT_DIR/../vending-bench-openclaw"; do
  if [ -d "$candidate" ]; then
    VENDING_BENCH_DIR="$(cd "$candidate" && pwd)"
    break
  fi
done

# Workspace for this agent
WORKSPACE_DIR="$ROOT_DIR/.workspaces/$AGENT_ID"
mkdir -p "$WORKSPACE_DIR"

# Generate agent config
CONFIG_FILE="$WORKSPACE_DIR/config.json"

EXTERNAL_EVAL_DIRS="[]"
if [ -n "$VENDING_BENCH_DIR" ]; then
  EXTERNAL_EVAL_DIRS="[\"$VENDING_BENCH_DIR\"]"
fi

cat > "$CONFIG_FILE" <<EOF
{
  "agentId": "$AGENT_ID",
  "agentName": "$AGENT_NAME",
  "memoryVariant": "$VARIANT",
  "mode": "eval",
  "farmDashboardUrl": "http://localhost:$FARM_PORT",
  "workspaceDir": "$WORKSPACE_DIR",
  "openclawDir": "$OPENCLAW_DIR",
  "externalEvalDirs": $EXTERNAL_EVAL_DIRS,
  "port": 0
}
EOF

# Track child PIDs for cleanup
FARM_PID=""
cleanup() {
  echo ""
  echo "[start] Shutting down..."
  if [ -n "$FARM_PID" ] && kill -0 "$FARM_PID" 2>/dev/null; then
    kill "$FARM_PID" 2>/dev/null || true
    wait "$FARM_PID" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Check for required API key
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo ""
  echo "WARNING: ANTHROPIC_API_KEY is not set."
  echo "  External evals (e.g. vending-bench) need this to call the LLM."
  echo "  Add to $ROOT_DIR/.env:"
  echo "    ANTHROPIC_API_KEY=sk-ant-..."
  echo ""
fi

# Print config summary
echo "═══════════════════════════════════"
echo "  Clawfarm"
echo "═══════════════════════════════════"
echo "  Farm:          http://localhost:$FARM_PORT  [mode: $FARM_MODE]"
echo "  Agent:         $AGENT_ID ($VARIANT)"
if [ -n "$OPENCLAW_DIR" ]; then
  echo "  OpenClaw:      $OPENCLAW_DIR"
else
  echo "  OpenClaw:      (not found)"
fi
if [ -n "$VENDING_BENCH_DIR" ]; then
  echo "  Vending Bench: $VENDING_BENCH_DIR"
else
  echo "  Vending Bench: (not found)"
fi
echo "  Workspace:     $WORKSPACE_DIR"
echo "═══════════════════════════════════"
echo ""

# Start farm server in background
echo "[start] Starting farm server..."
cd "$ROOT_DIR"
npx tsx src/server.ts --mode "$FARM_MODE" &
FARM_PID=$!

# Wait for farm to be ready
echo "[start] Waiting for farm to be ready..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$FARM_PORT/api/config" > /dev/null 2>&1; then
    echo "[start] Farm is ready."
    break
  fi
  if ! kill -0 "$FARM_PID" 2>/dev/null; then
    echo "[start] Farm process died unexpectedly."
    exit 1
  fi
  sleep 0.5
done

# Verify farm is up
if ! curl -sf "http://localhost:$FARM_PORT/api/config" > /dev/null 2>&1; then
  echo "[start] Farm failed to start within 15 seconds."
  exit 1
fi

echo "[start] Starting agent $AGENT_ID..."
echo ""

# Start agent in foreground (logs go to this terminal)
cd "$ROOT_DIR/agent-base"
exec npx tsx src/runner.ts --config "$CONFIG_FILE"
