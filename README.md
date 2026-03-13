# Clawfarm

A testing farm for comparing AI agent memory system variants. Runs standardized evals against agents with different memory backends and collects results in a central dashboard.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design and architecture diagram.

## Quick Start

```bash
npm install

# Start the farm dashboard (port 3847)
./start.sh

# In another terminal, start an agent
cd agent-base && npx tsx src/runner.ts --config configs/example.json

# Run an eval against it
cd ../vending-bench && npx tsx src/index.ts run --mode agent --agent-url http://localhost:3900
```

## Structure

This is an npm workspace with two packages:

```
clawfarm/
  farm/          Dashboard + orchestration server (Express, port 3847)
  agent-base/    Agent runtime harness wrapping OpenClaw with pluggable memory
```

## Memory Variants

Each agent variant uses the same OpenClaw engine with a different memory backend:

- **native-0D** — flat file storage (baseline)
- **three-layer-1d** — L1/L2/L3 file-routing architecture with explicit consolidation
- **five-day-1d** — boot discipline, learnings, handover, and backend-owned recall
- **five-day-1d-cerebras-glm47** — the five-day backend on Cerebras `zai-glm-4.7`

Backend implementations live under `agent-base/src/memory/variants/`, with shared memory interfaces and factory code kept in `agent-base/src/memory/`.
OpenClaw exposes the generic memory tool surface, but prompt-time recall plus in-turn memory storage and retrieval now route through the selected Clawfarm backend over an external memory bridge.
For eval runs, agent-base now narrows OpenClaw to the eval's sim tools plus backend memory tools instead of exposing the full coding tool surface.

## Evals

Evals are external processes that communicate with agents via HTTP. Currently supported:

- [**vending-bench-clone**](https://github.com/nathanwjclark/vending-bench-clone) — 365-day vending machine business simulation
- **constraint-propagation** — scripted message-scoring eval

## Testing

```bash
# All tests
npm test

# Individual packages
npm run test:farm      # 23 tests
npm run test:agent     # 95 tests
```

## Configuration

Copy `.env.example` to `.env` and set the provider key for the agent you want to run:

```
ANTHROPIC_API_KEY=sk-ant-...
CEREBRAS_API_KEY=...
```

Useful configs:

- `agent-base/configs/example.json`
- `agent-base/configs/five-day.json`
- `agent-base/configs/five-day-cerebras-glm47.json`
