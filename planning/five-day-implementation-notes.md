# Five-Day Backend: Implementation Notes

## What was built

The `five-day-1d` memory variant was added as a sibling of the existing `three-layer-1d` backend under `agent-base/src/memory/variants/`.

The refactor also changed the memory layout so backends now live under variant-owned folders:

- `agent-base/src/memory/variants/native/`
- `agent-base/src/memory/variants/three-layer/`
- `agent-base/src/memory/variants/five-day/`

Shared memory infrastructure remains at:

- `agent-base/src/memory/memory-backend.ts`
- `agent-base/src/memory/backend-factory.ts`
- `agent-base/src/memory/graph-extractor.ts`

## Architectural decisions

- `five-day-1d` is intentionally not a derivative of `three-layer-1d`.
- `three-layer-1d` remains the explicit consolidation architecture.
- `five-day-1d` is the disciplined-native architecture:
  - boot sequence at top of `AGENTS.md`
  - `learnings/LEARNINGS.md`
  - daily logs in `memory/YYYY-MM-DD.md`
  - handover protocol in daily logs
  - backend-owned recall that injects active memory, learnings, and recent notes
  - backend-owned `memory_search`, `memory_get`, and `memory_write`
  - memory flush and context pruning configured through generated OpenClaw config

## Important refactor

Workspace composition now belongs to the memory backend.

Before this change, `AgentProcess` and eval setup seeded generic root files outside the memory variant. That leaked policy out of the backend boundary and caused conflicts, especially for `three-layer-1d` during eval runs when persona files were overwritten.

The backend contract now includes eval workspace file composition so a variant can merge eval persona overlays without losing its own root instructions.

## Current tradeoff

The five-day variant now uses the real memory abstraction for start-of-turn recall and backend-routed in-turn memory tools. It still keeps the disciplined templates from the source architecture, but write quality during the turn still depends on the agent choosing to persist the right things.

## Cerebras model variants

Two agent configs now package the five-day backend with Cerebras-hosted models:

- `five-day-1d-cerebras-glm47`

Both use provider-aware auth provisioning in agent-base and push eval-side supplier/search LLM settings into `vending-bench` so simulated vendors can run on the same provider family.

## Live validation status

- `zai-glm-4.7` completed a 1-day `vending-bench` agent-mode run successfully and placed an order on Day 1.
