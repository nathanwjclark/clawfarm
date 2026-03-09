#!/bin/bash
# Trigger an eval on a live agent via the farm API.
# Usage: ./scripts/run-eval.sh <agent-id> <eval-id> [--days N] [--skip-preflight]
#
# Examples:
#   ./scripts/run-eval.sh agent-01 constraint-propagation
#   ./scripts/run-eval.sh agent-01 vending-bench --days 30
#   FARM_URL=http://myserver:3847 ./scripts/run-eval.sh agent-02 vending-bench --days 365

set -euo pipefail

FARM_URL="${FARM_URL:-http://localhost:3847}"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <agent-id> <eval-id> [--days N] [--skip-preflight]"
  echo ""
  echo "Environment variables:"
  echo "  FARM_URL   Farm dashboard URL (default: http://localhost:3847)"
  exit 1
fi

AGENT_ID="$1"
EVAL_ID="$2"
shift 2

DAYS=""
SKIP_PREFLIGHT=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --days)
      DAYS="$2"
      shift 2
      ;;
    --skip-preflight)
      SKIP_PREFLIGHT=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Preflight check
if [ "$SKIP_PREFLIGHT" = false ]; then
  echo "Running preflight check..."
  PREFLIGHT=$(curl -s -X POST "$FARM_URL/api/agents/$AGENT_ID/eval/preflight" \
    -H "Content-Type: application/json" \
    -d "{\"evalId\": \"$EVAL_ID\"}" 2>&1) || true

  # Check if preflight passed
  PREFLIGHT_OK=$(echo "$PREFLIGHT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")

  if [ "$PREFLIGHT_OK" != "True" ]; then
    echo "Preflight FAILED:"
    echo "$PREFLIGHT" | python3 -m json.tool 2>/dev/null || echo "$PREFLIGHT"
    echo ""
    echo "Fix the issue above, or use --skip-preflight to bypass."
    exit 1
  fi
  echo "Preflight passed."
  echo ""
fi

# Build JSON body
if [ -n "$DAYS" ]; then
  BODY="{\"evalId\": \"$EVAL_ID\", \"clockSpeed\": \"fast\", \"days\": $DAYS}"
else
  BODY="{\"evalId\": \"$EVAL_ID\", \"clockSpeed\": \"fast\"}"
fi

echo "Starting eval '$EVAL_ID' on agent '$AGENT_ID'..."
echo ""

curl -s -X POST "$FARM_URL/api/agents/$AGENT_ID/eval/start" \
  -H "Content-Type: application/json" \
  -d "$BODY" | python3 -m json.tool 2>/dev/null || echo "(raw response above)"

echo ""
echo "Monitor at: $FARM_URL/#/matrix"
