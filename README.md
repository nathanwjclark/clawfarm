# Clawfarm

A testing farm for comparing AI agent memory system variants. Runs standardized evals against agents with different memory backends and collects results in a central dashboard.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design and architecture diagram.

## Quick Start

```bash
npm install

# Start the farm dashboard (port 3847)
./start.sh

# In another terminal, start an agent
cd agent-base && npx tsx src/runner.ts --memory native-0D

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
- **graph-1D** — graph-structured entity/relationship memory
- **vector-2D** — vector-indexed semantic retrieval

## Evals

Evals are external processes that communicate with agents via HTTP. Currently supported:

- [**vending-bench**](https://github.com/nathanwjclark/vending-bench) — 365-day vending machine business simulation
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

Copy `.env.example` to `.env` and set your API key:

```
CLAUDE_API_KEY=sk-ant-...
```
