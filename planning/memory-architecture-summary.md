# OpenClaw Memory Architecture: Current State & Approaches

## Purpose of This Document

This document summarizes OpenClaw's native memory system, the community's plugin ecosystem, and the academic literature on agent memory -- providing a foundation for designing and testing variant memory storage systems in the clawfarm project.

---

## OpenClaw's Native Memory Architecture (0D in MemoryArena terms)

OpenClaw's memory is **file-first**: plain Markdown on disk in the agent workspace (`~/.openclaw/workspace/`). The LLM only "remembers" what gets written to files. There is no hidden state or opaque embedding database.

### Three-Tier File Structure

1. **MEMORY.md** (always loaded): Curated long-term memory injected into the system prompt at every session start. Think of this as the agent's persistent identity and knowledge. Users and/or the agent maintain it manually.

2. **memory/YYYY-MM-DD.md** (daily context): Append-only daily logs. Today's and yesterday's are auto-loaded. Everything else is accessible via search. Created by the pre-compaction flush mechanism or the session-memory hook on `/new`.

3. **memory/*.md topic files** (deep knowledge): Topical files (e.g., `memory/projects.md`, `memory/people.md`) that are searchable but not auto-loaded. These are evergreen (no temporal decay).

### Hybrid Search (BM25 + Vector)

The retrieval system uses a **hybrid approach** stored in per-agent SQLite databases:

- **Vector search** (70% weight default): Cosine similarity over embedded chunks (~400 tokens, 80-token overlap). Supports OpenAI, Gemini, Voyage, and local (node-llama-cpp) embedding providers. Extensions stored in `sqlite-vec`.
- **BM25 keyword search** (30% weight default): FTS5 full-text search catching exact tokens (IDs, code symbols, env variables) that embedding similarity misses.
- **Merging**: `mergeHybridResults()` combines by weighted sum. 4x candidate pool for better recall.
- **Post-processing**: Optional MMR re-ranking for diversity (default: off) and temporal decay for dated files (exponential, 30-day half-life, default: off).

### Write Policy Problem (the core weakness)

The agent decides what to write. Two tools: `memory_search` (semantic recall) and `memory_get` (targeted file read). Both are **tool-based, not hook-based** -- the LLM must decide to invoke them. This is the fundamental limitation identified by both the community and MemoryArena.

### Pre-Compaction Flush

When a session approaches context limits, a silent agentic turn prompts the model to write durable memories before compaction. Configuration:
- `memoryFlush.enabled` (default: true)
- Soft threshold: 4000 tokens before compaction
- The agent receives a flush prompt instructing it to save to `memory/YYYY-MM-DD.md`
- Append-only to avoid data loss

This converts a destructive operation (compaction) into a checkpoint, but it's still LLM-directed and can miss critical information.

### Source Code Layout

```
src/memory/
├── manager.ts           # Main MemoryIndexManager
├── hybrid.ts            # mergeHybridResults(), bm25RankToScore(), buildFtsQuery()
├── mmr.ts               # Maximal Marginal Relevance re-ranking
├── temporal-decay.ts    # Recency-aware scoring for dated files
├── embeddings*.ts       # Provider-specific embedding implementations
├── memory-schema.ts     # SQLite schema (files, chunks, embedding_cache, FTS5)
├── sync-memory-files.ts # Memory file synchronization
├── sync-index.ts        # Incremental indexing logic
└── query-expansion.ts   # FTS keyword extraction fallback

src/agents/
├── workspace.ts         # MEMORY.md loading and bootstrap
├── system-prompt.ts     # Memory section in system prompt
├── tools/memory-tool.ts # memory_search + memory_get tools
└── bootstrap-files.ts   # Memory file injection into context

src/auto-reply/reply/
├── memory-flush.ts      # Pre-compaction flush settings
└── post-compaction-context.ts

src/hooks/bundled/session-memory/
└── handler.ts           # Dated memory generation on /new
```

---

## Community Memory Approaches (Six Schools)

### 1. "Just Configure It Better" (0D tuning)

Enable memory flush, tune hybrid search weights, set `reserveTokensFloor` higher. Partially correct -- defaults ship misconfigured -- but hits a ceiling because memory ops remain tool-based (LLM-directed).

### 2. Mem0 Plugin -- System-Layer Enforcement (1D)

Moves write/read from tools to hooks: `before_agent_start` (auto-recall injects relevant memories) and `after_agent_run` (auto-capture extracts facts). Memory lives outside the context window. Uses ADD/UPDATE/DELETE/NOOP consolidation. 26% improvement over OpenAI memory on LOCOMO.

**Known issue**: Early versions had a property-name mismatch (`systemContext` vs `prependContext`) that silently broke injection for weeks.

### 3. Cognee Plugin -- Knowledge Graph Overlay (2D)

Builds entity-relationship graph from Markdown files. Handles multi-hop queries ("Alice manages auth team" + "who handles auth permissions?"). Markdown files stay as source of truth; graph is a parallel index with hash-based change detection. Requires Docker + Cognee server.

### 4. Graphiti Plugin -- Temporal Knowledge Graph (2D+)

Bi-temporal tracking (four timestamps per fact). Three tiers: episodes, entities, communities. Retrieval combines semantic + BM25 + graph traversal with no LLM calls at query time (P95: 300ms). Requires Neo4j + Graphiti server + OpenAI API.

### 5. Supermemory -- Vector-Graph Hybrid with Hooks

Cloud-hosted. Hooks for automatic capture; stores both distilled facts and raw chunks. Claims active forgetting (memory decay). Self-published benchmarks: 85.9% vs 58.3% for native OpenClaw RAG.

### 6. DIY Pragmatist School (the most interesting for clawfarm)

Craig Fisher's four-layer system:
- **Automated fact extraction** via cron job every 4 hours (reads session logs, LLM extracts atomic facts to `facts.jsonl`). Cost: ~$0.04/day.
- **working-context.md** as explicit working memory ("pilot's checklist" that survives compaction)
- **Temporally-structured MEMORY.md** with `[since:]`, `[learned:]`, `[updated:]` markers
- **Kuzu** (embedded graph database, no server, like SQLite)

The coolmanns repo goes further: 12-layer architecture with SQLite + FTS5, activation scoring with hot/warm/cool decay, importance tagging, gating policies.

---

## MemoryArena Framework & Key Findings

MemoryArena (Feb 2026, arXiv:2602.16313) provides the benchmark framework for evaluating agent memory in multi-session agentic tasks.

### Memory Dimensionality Taxonomy

| Dimension | Description | Examples |
|-----------|-------------|----------|
| **0D** | Raw history, no abstraction | Full context buffers, flat RAG, OpenClaw native |
| **1D** | Consolidation but flat storage | MemGPT, Mem0, ReasoningBank |
| **2D** | Structured/relational storage | Mem0-g, GraphRAG, Cognee, Graphiti |

### Critical Finding: Dimensionality doesn't uniformly help

- Long-context agents with verbatim history are competitive when traces fit in context
- RAG systems suffer from retrieval failure cascading
- MemGPT achieves best precision but worst recall (no fallback when it fails to store)
- External memory helps most in formal reasoning (skill distillation, not just fact recall)
- Performance degrades sharply at subtask depth 3-4 across all methods

### The Three Bottlenecks (what actually matters)

1. **What to write** (consolidation): Deciding which session information will be useful later
2. **When to read** (retrieval cue): Knowing which prior information is relevant now
3. **How to integrate** (working memory): Combining retrieved memory with current context for correct action

Current systems optimize for (2). MemoryArena shows (1) and (3) are the actual bottlenecks.

---

## Frontier Research Directions

### Learned Indexing (the "bitter lesson" approach)

Rather than hand-crafted semantic hierarchies, use a transformer as the index itself.

**Titans (Google, Dec 2024)**: Neural long-term memory MLP whose weights update during inference. Surprise-weighted gradient updates. Scales to 2M+ tokens, outperforms GPT-4 on needle-in-haystack. Memory is the network.

**MemGen (Zhang et al., Sep 2025)**: Memory weaver generates latent token sequences directly into the agent's reasoning stream. LoRA-based trigger + separate weaver model. Outperforms retrieval systems by up to 38%. Latent tokens spontaneously organize into functional clusters (planning, procedural, working memory) without explicit supervision.

**MemoRAG (Qian et al., Sep 2024)**: Lightweight LLM compresses entire corpus into global latent representation via KV compression (up to 16x). Generates retrieval "clues" rather than direct context. Accepted at WWW 2025.

### Proposed Ideal Architecture (from conversation analysis)

```
┌─────────────────────────────────────────────────┐
│  MAIN AGENT (Claude/GPT via API)                │
│  Receives: system prompt + memory context       │
├─────────────────────────────────────────────────┤
│  MEMORY CONTEXT (generated text, ~500-2000 tok) │
│  Regenerated per query (<1s)                    │
├─────────────────────────────────────────────────┤
│  MEMORY MODEL (local, 500M-1B params)           │
│  Frozen backbone + user LoRA adapters           │
│  Forward pass = context generation              │
├─────────────────────────────────────────────────┤
│  ADAPTER LAYER (the "learned index")            │
│  LoRA ranks per memory domain                   │
│  Updated incrementally (~60s budget)            │
├─────────────────────────────────────────────────┤
│  RAW FACT STORE (append-only)                   │
│  Every conversation turn via hooks              │
│  Source of truth for all training               │
└─────────────────────────────────────────────────┘
```

Target: 60-second memory updates between sessions, <1-second memory inference.

---

## Clawfarm Testing Dimensions

Based on the above, the key dimensions to test in a memory variant farm:

### Write Policy Variants
- **LLM-directed** (native OpenClaw): Agent decides what to save
- **Hook-based automatic** (Mem0 pattern): Every turn captured automatically
- **Cron-based extraction** (Fisher pattern): External process extracts from session logs periodically
- **Hybrid**: Hooks for real-time + cron for consolidation

### Storage Structure Variants
- **0D Flat files**: Markdown only (native)
- **1D Structured facts**: JSONL/SQLite with extraction pipeline
- **2D Knowledge graph**: Entity-relationship graph (Kuzu embedded, or Neo4j)
- **Learned index**: Small transformer as the memory model

### Retrieval Variants
- **Vector only**: Cosine similarity over embeddings
- **BM25 only**: Keyword/FTS search
- **Hybrid** (default): Weighted combination
- **Graph traversal**: Relationship-aware retrieval
- **Learned retrieval**: Memory model generates context directly

### Integration Variants
- **Prepend context**: Inject as system prompt text (current approach)
- **Working context file**: Explicit scratchpad for active tasks
- **Tiered injection**: Always-loaded core + on-demand deep retrieval

### Evaluation Axes (from MemoryArena)
- Constraint propagation (shopping compatibility tasks)
- Preference aggregation with relational constraints (travel planning)
- Compositional information accumulation (progressive search)
- Skill distillation and reuse (formal reasoning)
- Simple fact recall (baseline, already saturated)
