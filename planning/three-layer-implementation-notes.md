# Three-Layer Backend: Implementation Notes

## What was built

The `three-layer-1d` memory variant, implementing the Reddit post's 3-layer architecture as a `MemoryBackend`. Files created:

- `agent-base/src/memory/three-layer-templates.ts` — L1 file templates + token budgets
- `agent-base/src/memory/three-layer-consolidator.ts` — Claude Haiku fact extraction + routing
- `agent-base/src/memory/three-layer-backend.ts` — Main backend class
- `agent-base/configs/three-layer.json` — Config file
- `agent-base/test/three-layer-backend.test.ts` — 26 tests

Modified `agent-base/src/memory/backend-factory.ts` to register the variant.

## Bugs found and fixed

### 1. Claude returns JSON wrapped in markdown fences

**File:** `three-layer-consolidator.ts`

Even with explicit "Respond with ONLY the JSON object. No markdown fences" in the system prompt, Claude Haiku returns:

````
```json
{"facts": [...], "trimSuggestions": [...]}
```
````

**Fix:** Strip ` ```json ``` ` fences before `JSON.parse()`:

```typescript
let jsonText = textBlock.text.trim();
const fenceMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
if (fenceMatch) {
  jsonText = fenceMatch[1].trim();
}
const parsed = JSON.parse(jsonText);
```

**Propagation needed:** Any code that asks Claude for raw JSON output and parses it directly should handle fences. This is a general pattern — consider a shared `parseClaudeJson()` utility in openclaw if this pattern recurs.

### 2. Claude returns `null` for optional fields instead of omitting them

**File:** `three-layer-consolidator.ts`

When a fact has `action: "append"` (no section needed), Claude returns `"section": null` instead of omitting the field. Zod's `z.string().optional()` rejects `null`.

**Fix:** Changed schema to `z.string().nullable().optional()`.

**Propagation needed:** Any zod schema validating Claude's JSON output should use `.nullable().optional()` instead of just `.optional()` for fields the model might set to null. This is a general Claude behavior pattern.

### 3. Eval overwrites L1 files (design issue, not a bug)

**Observed during testing:** When vending-bench runs via EvalBridge, `chatHandler.seedEvalWorkspace()` writes the eval's persona files (SOUL.md, AGENTS.md, TOOLS.md) to the workspace, overwriting the 3-layer templates. After the eval completes, the workspace has vending-bench content, not 3-layer content.

**Impact:** Consolidation during the eval runs against vending-bench persona files, not the 3-layer structure. The routing rules in the consolidation prompt reference L1 files that have different content than expected.

**Not yet fixed.** Possible approaches:
- Have the backend re-init L1 files after eval reset (but the eval *needs* its persona files during the run)
- Accept that during evals, the eval's persona takes precedence and consolidation adapts
- Store 3-layer templates separately and merge with eval persona files

This is a design tension between the eval's need to control the agent persona and the memory backend's need to control file structure. For now, consolidation still works — it just routes against whatever L1 content exists.

### 4. EvalBridge doesn't capture memory snapshot

**File:** `agent-base/src/lifecycle/eval-bridge.ts` (lines 309-314)

The EvalBridge creates an empty memory snapshot in the result:
```typescript
memorySnapshot: {
  variantId: this.config.memoryVariant,
  files: [],
  stats: { totalChunks: 0, totalFiles: 0, indexSizeBytes: 0 },
  graphState: { nodes: [], edges: [] },
},
```

It should call `backend.captureSnapshot()` before resetting. This affects all memory variants, not just three-layer.

**Not yet fixed.** The EvalBridge doesn't have a reference to the memory backend — it only has the `ChatHandler`. Would need to either pass the backend to EvalBridge or expose snapshot capture through the ChatHandler.

**Propagation needed:** This is a clawfarm issue, not openclaw. But worth fixing before running comparative evals, since memory snapshots are used for analysis.

## LLM calls in the system

| Component | API | Model | Auth | Notes |
|---|---|---|---|---|
| OpenClaw CLI (main agent) | Anthropic | `claude-sonnet-4-20250514` | `auth-profiles.json` written from `ANTHROPIC_API_KEY` env | The primary agent LLM |
| Three-layer consolidator | Anthropic (raw fetch) | `claude-haiku-4-5-20251001` | `process.env.ANTHROPIC_API_KEY` directly | Fast/cheap for structured extraction |

No OpenAI calls exist in the system. Both use `ANTHROPIC_API_KEY` from `.env`.

### API key flow

1. `.env` at project root has `ANTHROPIC_API_KEY=sk-ant-...`
2. `runner.ts` `loadEnvFile()` reads it into `process.env` at startup
3. `chat-handler.ts` `provisionAuthProfiles()` writes it to openclaw's auth store
4. `three-layer-consolidator.ts` reads it from `process.env` directly
5. `eval-bridge.ts` passes `{ ...process.env }` to eval subprocesses

**Note:** `start.sh` has a minor inconsistency — it looks for `CLAUDE_API_KEY` in `.env` but the file has `ANTHROPIC_API_KEY`. This doesn't matter because `runner.ts` handles env loading independently, but the script should probably be updated to match.

## Test results

All 121 tests pass (16 test files), including 26 new three-layer tests covering:
- Template seeding and L1 file creation
- recall() returns ""
- Consolidation routing with mocked LLM (facts → correct files)
- Replace-section action
- API failure graceful degradation
- L1 token budget enforcement with overflow to daily notes
- Breadcrumb append and 4KB overflow archival to L3
- Snapshot capture across all 3 layers
- Reset clears L2/L3 and re-seeds L1
- generateOpenclawConfig output
- Graph extraction across layers
- Template token budget validation
- consolidateWithLLM returns empty when no API key

## Propagation analysis: openclaw

Audited the openclaw codebase for the same patterns. Key findings:

### Existing prior art: `parseJsonObjectFromText()` in openclaw

**File:** `openclaw/src/gateway/server-methods/mesh.ts:579-620`

OpenClaw already has a robust JSON-from-LLM parser in the gateway mesh module that handles all three cases:
1. Raw JSON parse
2. Strip ` ```json ``` ` fences and retry
3. Find first `{` to last `}` and retry

This is the exact same pattern we independently implemented in the consolidator. However, it's a **private function** in the gateway mesh module — not a shared utility. If any other module needs to parse LLM-generated JSON, it has to reinvent this.

**Recommendation:** Extract `parseJsonObjectFromText()` into a shared utility (e.g. `openclaw/src/utils/parse-llm-json.ts`) so it can be reused. The three-layer consolidator in clawfarm could also use it if openclaw exposes it.

### No other LLM JSON parsing found

Searched all `JSON.parse()` calls in openclaw's `src/agents/`, `src/auto-reply/`, and tool files. Every instance parses either:
- File-persisted state/config (state.json, auth-profiles.json, etc.)
- API responses from external services (Brave, Perplexity, etc.) — these return well-formed JSON
- Tool execution results (which are program-generated, not LLM-generated)
- JSONL log entries

The compaction system (`compaction.ts`) uses `generateSummary()` from `@mariozechner/pi-coding-agent` which returns **plain text summaries**, not JSON. No structured extraction happens during compaction.

**Bottom line:** The fence-stripping and null-handling bugs only affect code that asks Claude for structured JSON output. Right now that's only:
1. The gateway mesh auto-planner (`mesh.ts`) — already handles fences
2. The three-layer consolidator (`three-layer-consolidator.ts`) — now fixed

### No zod validation of LLM output in openclaw

OpenClaw uses TypeScript `as Type` assertions for LLM output, not zod runtime validation. The `.nullable().optional()` pattern only matters for zod schemas validating Claude output. Currently only the three-layer consolidator in clawfarm does this.

### What to propagate back

| Change | Where | Priority | Notes |
|---|---|---|---|
| Extract `parseJsonObjectFromText()` to shared util | openclaw | Low | Currently only used in mesh.ts; useful when more modules need it |
| Fix `start.sh` `CLAUDE_API_KEY` → `ANTHROPIC_API_KEY` | clawfarm | Low | Works fine via runner.ts; script inconsistency only |
| Pass backend to EvalBridge for snapshots | clawfarm | Medium | Needed for comparative eval analysis |
| Document Claude JSON output quirks | openclaw docs or CLAUDE.md | Low | Fences + null-for-optional are patterns any new integration will hit |

**No propagation needed right now.** The bugs found are specific to the three-layer consolidator and have been fixed there. The shared utility extraction is a nice-to-have for whenever someone next needs to parse LLM JSON in openclaw — not worth a standalone change. The main takeaway is that any future code parsing LLM-generated JSON should use the multi-strategy approach already proven in `mesh.ts`.

## First eval run

10-day vending-bench, completed successfully:
- Score: $340.02 net worth
- 11 LLM calls, 39 tool calls
- Consolidation was silently failing (bugs #1 and #2 above) — now fixed
- The eval's persona files overwrote L1 templates (issue #3)
