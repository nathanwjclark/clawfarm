import type {
  AgentStatus,
  EvalType,
  EvalRun,
  MemoryVariant,
  CostSnapshot,
  CostConfig,
  ApiKeyConfig,
  AgentMemoryGraph,
  AgentMessage,
  AgentEvalSummary,
} from "./types.js";
import { SIM_MESSAGES, SIM_MEMORY_GRAPH } from "./sim-data.js";

// SIMULATED: All data in this file is mock data for dashboard development.
// Each function documents what real data source it should be replaced with.
// Search for "SIMULATED:" comments to find all replacement points.

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// AGENTS
// ---------------------------------------------------------------------------

// SIMULATED: Replace with real OpenClaw agent connections.
// Future: Each agent will be a running OpenClaw instance reporting via WebSocket or HTTP polling.
const MOCK_AGENTS: AgentStatus[] = [
  {
    id: "agent-01",
    name: "native-baseline",
    memoryVariant: "native-0d",
    status: "online",
    uptimeSeconds: 14400,
    lastHeartbeat: minutesAgo(0.5),
    mode: "eval",
    messagesProcessed: 342,
    sessionsTotal: 12,
    sessionsActive: 1,
    contextTokensUsed: 48200,
    contextTokensAvailable: 200000,
    costInputTokens: 1_240_000,
    costOutputTokens: 310_000,
    costCacheReadTokens: 620_000,
    costEstimatedUsd: 5.12,
    metrics: { avg_response_ms: 1850, memory_recall_accuracy: 0.42, fact_retention_rate: 0.31, compaction_events: 8 },
    integrations: [
      { name: "Slack #farm-test", type: "slack", status: "connected", lastCheck: minutesAgo(1) },
      { name: "WebChat", type: "webchat", status: "connected", lastCheck: minutesAgo(1) },
    ],
  },
  {
    id: "agent-02",
    name: "native-tuned",
    memoryVariant: "native-0d-tuned",
    status: "online",
    uptimeSeconds: 14380,
    lastHeartbeat: minutesAgo(0.3),
    mode: "eval",
    messagesProcessed: 338,
    sessionsTotal: 12,
    sessionsActive: 1,
    contextTokensUsed: 52100,
    contextTokensAvailable: 200000,
    costInputTokens: 1_310_000,
    costOutputTokens: 295_000,
    costCacheReadTokens: 890_000,
    costEstimatedUsd: 5.45,
    metrics: { avg_response_ms: 1920, memory_recall_accuracy: 0.58, fact_retention_rate: 0.49, compaction_events: 5, flush_saves: 5 },
    integrations: [
      { name: "Slack #farm-test", type: "slack", status: "connected", lastCheck: minutesAgo(1) },
    ],
  },
  {
    id: "agent-03",
    name: "mem0-hooks",
    memoryVariant: "mem0-1d",
    status: "online",
    uptimeSeconds: 13200,
    lastHeartbeat: minutesAgo(0.2),
    mode: "eval",
    messagesProcessed: 315,
    sessionsTotal: 11,
    sessionsActive: 1,
    contextTokensUsed: 38700,
    contextTokensAvailable: 200000,
    costInputTokens: 1_580_000,
    costOutputTokens: 340_000,
    costCacheReadTokens: 420_000,
    costEstimatedUsd: 6.88,
    metrics: { avg_response_ms: 2100, memory_recall_accuracy: 0.74, fact_retention_rate: 0.68, compaction_events: 4, mem0_facts_stored: 187, mem0_auto_recalls: 294 },
    integrations: [
      { name: "Slack #farm-test", type: "slack", status: "connected", lastCheck: minutesAgo(0.5) },
      { name: "Discord #testing", type: "discord", status: "connected", lastCheck: minutesAgo(2) },
    ],
  },
  {
    id: "agent-04",
    name: "mem0-aggressive",
    memoryVariant: "mem0-1d-aggressive",
    status: "error",
    uptimeSeconds: 8400,
    lastHeartbeat: minutesAgo(12),
    mode: "eval",
    messagesProcessed: 201,
    sessionsTotal: 8,
    sessionsActive: 0,
    contextTokensUsed: 0,
    contextTokensAvailable: 200000,
    costInputTokens: 2_100_000,
    costOutputTokens: 410_000,
    costCacheReadTokens: 310_000,
    costEstimatedUsd: 8.92,
    metrics: { avg_response_ms: 3200, memory_recall_accuracy: 0.71, fact_retention_rate: 0.72, compaction_events: 3, mem0_facts_stored: 412, error_count: 3 },
    integrations: [
      { name: "Slack #farm-test", type: "slack", status: "error", lastCheck: minutesAgo(12), details: "Connection reset by peer" },
    ],
  },
  {
    id: "agent-05",
    name: "cognee-graph",
    memoryVariant: "cognee-2d",
    status: "online",
    uptimeSeconds: 10800,
    lastHeartbeat: minutesAgo(0.4),
    mode: "real-world",
    messagesProcessed: 47,
    sessionsTotal: 5,
    sessionsActive: 1,
    contextTokensUsed: 61200,
    contextTokensAvailable: 200000,
    costInputTokens: 820_000,
    costOutputTokens: 195_000,
    costCacheReadTokens: 340_000,
    costEstimatedUsd: 3.41,
    metrics: { avg_response_ms: 2400, memory_recall_accuracy: 0.79, fact_retention_rate: 0.65, graph_entities: 134, graph_relationships: 89, multi_hop_success_rate: 0.62 },
    integrations: [
      { name: "Slack #real-world", type: "slack", status: "connected", lastCheck: minutesAgo(1) },
      { name: "Telegram", type: "telegram", status: "connected", lastCheck: minutesAgo(3) },
    ],
  },
  {
    id: "agent-06",
    name: "graphiti-temporal",
    memoryVariant: "graphiti-2d+",
    status: "online",
    uptimeSeconds: 10800,
    lastHeartbeat: minutesAgo(0.6),
    mode: "real-world",
    messagesProcessed: 43,
    sessionsTotal: 5,
    sessionsActive: 1,
    contextTokensUsed: 55800,
    contextTokensAvailable: 200000,
    costInputTokens: 940_000,
    costOutputTokens: 220_000,
    costCacheReadTokens: 280_000,
    costEstimatedUsd: 4.15,
    metrics: { avg_response_ms: 2800, memory_recall_accuracy: 0.82, fact_retention_rate: 0.77, graph_entities: 98, graph_episodes: 43, graph_communities: 7, temporal_query_accuracy: 0.71 },
    integrations: [
      { name: "Slack #real-world", type: "slack", status: "connected", lastCheck: minutesAgo(1) },
    ],
  },
  {
    id: "agent-07",
    name: "fisher-diy",
    memoryVariant: "diy-cron-1d",
    status: "online",
    uptimeSeconds: 14200,
    lastHeartbeat: minutesAgo(0.1),
    mode: "eval",
    messagesProcessed: 330,
    sessionsTotal: 12,
    sessionsActive: 1,
    contextTokensUsed: 41500,
    contextTokensAvailable: 200000,
    costInputTokens: 1_150_000,
    costOutputTokens: 280_000,
    costCacheReadTokens: 710_000,
    costEstimatedUsd: 4.78,
    metrics: { avg_response_ms: 1700, memory_recall_accuracy: 0.69, fact_retention_rate: 0.64, cron_extractions: 24, facts_jsonl_entries: 156, working_context_updates: 38 },
    integrations: [
      { name: "Slack #farm-test", type: "slack", status: "connected", lastCheck: minutesAgo(0.5) },
      { name: "API endpoint", type: "api", status: "connected", lastCheck: minutesAgo(1) },
    ],
  },
  {
    id: "agent-08",
    name: "learned-index-exp",
    memoryVariant: "learned-index",
    status: "offline",
    uptimeSeconds: 0,
    lastHeartbeat: hoursAgo(2),
    mode: "eval",
    messagesProcessed: 0,
    sessionsTotal: 0,
    sessionsActive: 0,
    contextTokensUsed: 0,
    contextTokensAvailable: 200000,
    costInputTokens: 0,
    costOutputTokens: 0,
    costCacheReadTokens: 0,
    costEstimatedUsd: 0,
    metrics: {},
    integrations: [],
  },
];

// SIMULATED: Replace with real-time agent status polling.
export function getSimulatedAgents(): AgentStatus[] {
  return MOCK_AGENTS.map((agent) => ({
    ...agent,
    uptimeSeconds: agent.status === "online" ? agent.uptimeSeconds + Math.floor(Math.random() * 10) : agent.uptimeSeconds,
    lastHeartbeat: agent.status === "online" ? new Date().toISOString() : agent.lastHeartbeat,
    contextTokensUsed: agent.status === "online" ? agent.contextTokensUsed + Math.floor(Math.random() * 500) : agent.contextTokensUsed,
  }));
}

// SIMULATED: Replace with lookup against real agent registry.
export function getSimulatedAgent(id: string): AgentStatus | undefined {
  return getSimulatedAgents().find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// EVAL TYPES
// ---------------------------------------------------------------------------

// SIMULATED: Replace with eval definitions loaded from eval config files.
// Future: Eval types will be defined in YAML/JSON configs in an evals/ directory.
const MOCK_EVAL_TYPES: EvalType[] = [
  {
    id: "eval-fact-recall",
    name: "Fact Recall",
    description: "Simple retrieval of previously stated facts. Tests whether the agent can recall specific information (names, dates, preferences, decisions) from earlier sessions. Baseline eval — most memory systems saturate here.",
    category: "recall",
    taskCount: 50,
    highScore: { agentId: "agent-06", agentName: "graphiti-temporal", memoryVariant: "graphiti-2d+", score: 46, maxScore: 50, runId: "run-fr-01", achievedAt: hoursAgo(3) },
    recentRuns: [
      { id: "run-fr-01", evalId: "eval-fact-recall", agentId: "agent-06", agentName: "graphiti-temporal", memoryVariant: "graphiti-2d+", startedAt: hoursAgo(4), completedAt: hoursAgo(3), status: "completed", clockSpeed: "fast", score: 46, maxScore: 50, costUsd: 0.42 },
      { id: "run-fr-02", evalId: "eval-fact-recall", agentId: "agent-03", agentName: "mem0-hooks", memoryVariant: "mem0-1d", startedAt: hoursAgo(4), completedAt: hoursAgo(3.2), status: "completed", clockSpeed: "fast", score: 43, maxScore: 50, costUsd: 0.38 },
      { id: "run-fr-03", evalId: "eval-fact-recall", agentId: "agent-01", agentName: "native-baseline", memoryVariant: "native-0d", startedAt: hoursAgo(4), completedAt: hoursAgo(3.5), status: "completed", clockSpeed: "fast", score: 28, maxScore: 50, costUsd: 0.35 },
      { id: "run-fr-04", evalId: "eval-fact-recall", agentId: "agent-07", agentName: "fisher-diy", memoryVariant: "diy-cron-1d", startedAt: hoursAgo(3), completedAt: hoursAgo(2.5), status: "completed", clockSpeed: "fast", score: 39, maxScore: 50, costUsd: 0.41 },
    ],
  },
  {
    id: "eval-constraint-prop",
    name: "Constraint Propagation",
    description: "Shopping compatibility tasks from MemoryArena. Agent buys a camera body in session 1, then must recall specific attributes (mount type, sensor size) to buy compatible lenses/accessories in later sessions. Tests whether memory captures and retrieves constraint-relevant attributes.",
    category: "reasoning",
    taskCount: 30,
    highScore: { agentId: "agent-03", agentName: "mem0-hooks", memoryVariant: "mem0-1d", score: 19, maxScore: 30, runId: "run-cp-02", achievedAt: hoursAgo(5) },
    recentRuns: [
      { id: "run-cp-01", evalId: "eval-constraint-prop", agentId: "agent-01", agentName: "native-baseline", memoryVariant: "native-0d", startedAt: hoursAgo(6), completedAt: hoursAgo(5.2), status: "completed", clockSpeed: "fast", score: 8, maxScore: 30, costUsd: 0.85 },
      { id: "run-cp-02", evalId: "eval-constraint-prop", agentId: "agent-03", agentName: "mem0-hooks", memoryVariant: "mem0-1d", startedAt: hoursAgo(6), completedAt: hoursAgo(5), status: "completed", clockSpeed: "fast", score: 19, maxScore: 30, costUsd: 1.12 },
      { id: "run-cp-03", evalId: "eval-constraint-prop", agentId: "agent-05", agentName: "cognee-graph", memoryVariant: "cognee-2d", startedAt: hoursAgo(5), status: "running", clockSpeed: "fast" },
    ],
  },
  {
    id: "eval-pref-aggregation",
    name: "Preference Aggregation",
    description: "Travel planning with relational constraints. Base traveler's itinerary is set, then 5-8 additional travelers are added with JOIN constraints (share activity with person X) and RELATION constraints (hotel rating N levels higher than person X). Dependency chains up to depth 4.",
    category: "reasoning",
    taskCount: 25,
    highScore: { agentId: "agent-06", agentName: "graphiti-temporal", memoryVariant: "graphiti-2d+", score: 14, maxScore: 25, runId: "run-pa-01", achievedAt: hoursAgo(8) },
    recentRuns: [
      { id: "run-pa-01", evalId: "eval-pref-aggregation", agentId: "agent-06", agentName: "graphiti-temporal", memoryVariant: "graphiti-2d+", startedAt: hoursAgo(9), completedAt: hoursAgo(8), status: "completed", clockSpeed: "fast", score: 14, maxScore: 25, costUsd: 1.45 },
      { id: "run-pa-02", evalId: "eval-pref-aggregation", agentId: "agent-01", agentName: "native-baseline", memoryVariant: "native-0d", startedAt: hoursAgo(9), completedAt: hoursAgo(8.5), status: "completed", clockSpeed: "fast", score: 6, maxScore: 25, costUsd: 1.20 },
    ],
  },
  {
    id: "eval-compositional-search",
    name: "Compositional Search",
    description: "Progressive information accumulation across sessions. Multi-step research tasks where each session's findings build on previous ones. Subquery chains with strict causal ordering — later queries depend on earlier results.",
    category: "integration",
    taskCount: 40,
    highScore: { agentId: "agent-07", agentName: "fisher-diy", memoryVariant: "diy-cron-1d", score: 24, maxScore: 40, runId: "run-cs-03", achievedAt: hoursAgo(6) },
    recentRuns: [
      { id: "run-cs-01", evalId: "eval-compositional-search", agentId: "agent-01", agentName: "native-baseline", memoryVariant: "native-0d", startedAt: hoursAgo(7), completedAt: hoursAgo(6.5), status: "completed", clockSpeed: "fast", score: 15, maxScore: 40, costUsd: 1.80 },
      { id: "run-cs-02", evalId: "eval-compositional-search", agentId: "agent-03", agentName: "mem0-hooks", memoryVariant: "mem0-1d", startedAt: hoursAgo(7), completedAt: hoursAgo(6.2), status: "completed", clockSpeed: "fast", score: 22, maxScore: 40, costUsd: 2.10 },
      { id: "run-cs-03", evalId: "eval-compositional-search", agentId: "agent-07", agentName: "fisher-diy", memoryVariant: "diy-cron-1d", startedAt: hoursAgo(7), completedAt: hoursAgo(6), status: "completed", clockSpeed: "fast", score: 24, maxScore: 40, costUsd: 1.65 },
    ],
  },
  {
    id: "eval-skill-distillation",
    name: "Skill Distillation",
    description: "Formal reasoning tasks where the agent must distill reusable proof techniques from earlier lemmas and apply them to later, harder problems. Tests whether memory abstracts patterns vs. just storing raw facts. The hardest eval — exposes the gap between 0D and higher-dimensional memory.",
    category: "reasoning",
    taskCount: 20,
    highScore: { agentId: "agent-05", agentName: "cognee-graph", memoryVariant: "cognee-2d", score: 7, maxScore: 20, runId: "run-sd-02", achievedAt: hoursAgo(10) },
    recentRuns: [
      { id: "run-sd-01", evalId: "eval-skill-distillation", agentId: "agent-01", agentName: "native-baseline", memoryVariant: "native-0d", startedAt: hoursAgo(11), completedAt: hoursAgo(10.5), status: "completed", clockSpeed: "fast", score: 2, maxScore: 20, costUsd: 2.50 },
      { id: "run-sd-02", evalId: "eval-skill-distillation", agentId: "agent-05", agentName: "cognee-graph", memoryVariant: "cognee-2d", startedAt: hoursAgo(11), completedAt: hoursAgo(10), status: "completed", clockSpeed: "fast", score: 7, maxScore: 20, costUsd: 3.20 },
    ],
  },
  {
    id: "eval-temporal-reasoning",
    name: "Temporal Reasoning",
    description: "Queries about when facts changed, which version is current, and what superseded what. Tests the agent's ability to track fact evolution over time — 'What database did we use before switching?' and 'When did we decide to move to Postgres?'",
    category: "recall",
    taskCount: 35,
    highScore: { agentId: "agent-06", agentName: "graphiti-temporal", memoryVariant: "graphiti-2d+", score: 29, maxScore: 35, runId: "run-tr-01", achievedAt: hoursAgo(4) },
    recentRuns: [
      { id: "run-tr-01", evalId: "eval-temporal-reasoning", agentId: "agent-06", agentName: "graphiti-temporal", memoryVariant: "graphiti-2d+", startedAt: hoursAgo(5), completedAt: hoursAgo(4), status: "completed", clockSpeed: "fast", score: 29, maxScore: 35, costUsd: 0.95 },
      { id: "run-tr-02", evalId: "eval-temporal-reasoning", agentId: "agent-02", agentName: "native-tuned", memoryVariant: "native-0d-tuned", startedAt: hoursAgo(5), completedAt: hoursAgo(4.5), status: "completed", clockSpeed: "fast", score: 14, maxScore: 35, costUsd: 0.72 },
    ],
  },
  {
    id: "eval-multi-hop",
    name: "Multi-hop Retrieval",
    description: "Relational queries requiring traversal: 'Alice manages the auth team' + 'Who handles permissions?' → Alice. Tests whether memory connects entities through relationships rather than just matching keywords.",
    category: "integration",
    taskCount: 30,
    highScore: { agentId: "agent-05", agentName: "cognee-graph", memoryVariant: "cognee-2d", score: 21, maxScore: 30, runId: "run-mh-02", achievedAt: hoursAgo(7) },
    recentRuns: [
      { id: "run-mh-01", evalId: "eval-multi-hop", agentId: "agent-01", agentName: "native-baseline", memoryVariant: "native-0d", startedAt: hoursAgo(8), completedAt: hoursAgo(7.5), status: "completed", clockSpeed: "fast", score: 9, maxScore: 30, costUsd: 1.10 },
      { id: "run-mh-02", evalId: "eval-multi-hop", agentId: "agent-05", agentName: "cognee-graph", memoryVariant: "cognee-2d", startedAt: hoursAgo(8), completedAt: hoursAgo(7), status: "completed", clockSpeed: "fast", score: 21, maxScore: 30, costUsd: 1.35 },
      { id: "run-mh-03", evalId: "eval-multi-hop", agentId: "agent-06", agentName: "graphiti-temporal", memoryVariant: "graphiti-2d+", startedAt: hoursAgo(7), completedAt: hoursAgo(6), status: "completed", clockSpeed: "fast", score: 20, maxScore: 30, costUsd: 1.40 },
    ],
  },
  {
    id: "eval-working-memory",
    name: "Working Memory Retention",
    description: "Context retention through compaction. Tests whether an agent maintains coherent working state during long multi-step tasks that trigger context compaction. Measures the 'woke up with amnesia' failure mode.",
    category: "robustness",
    taskCount: 20,
    highScore: { agentId: "agent-07", agentName: "fisher-diy", memoryVariant: "diy-cron-1d", score: 15, maxScore: 20, runId: "run-wm-03", achievedAt: hoursAgo(5) },
    recentRuns: [
      { id: "run-wm-01", evalId: "eval-working-memory", agentId: "agent-01", agentName: "native-baseline", memoryVariant: "native-0d", startedAt: hoursAgo(6), completedAt: hoursAgo(5.5), status: "completed", clockSpeed: "fast", score: 5, maxScore: 20, costUsd: 1.60 },
      { id: "run-wm-02", evalId: "eval-working-memory", agentId: "agent-03", agentName: "mem0-hooks", memoryVariant: "mem0-1d", startedAt: hoursAgo(6), completedAt: hoursAgo(5.3), status: "completed", clockSpeed: "fast", score: 12, maxScore: 20, costUsd: 1.45 },
      { id: "run-wm-03", evalId: "eval-working-memory", agentId: "agent-07", agentName: "fisher-diy", memoryVariant: "diy-cron-1d", startedAt: hoursAgo(6), completedAt: hoursAgo(5), status: "completed", clockSpeed: "fast", score: 15, maxScore: 20, costUsd: 1.50 },
    ],
  },
];

export function getSimulatedEvalTypes(): EvalType[] {
  return MOCK_EVAL_TYPES;
}

export function getSimulatedEvalType(id: string): EvalType | undefined {
  return MOCK_EVAL_TYPES.find((e) => e.id === id);
}

// SIMULATED: Replace with real eval run lookups from eval orchestrator.
export function getSimulatedAgentEvalSummary(agentId: string): AgentEvalSummary {
  const agent = MOCK_AGENTS.find((a) => a.id === agentId);
  if (!agent) return { lastRun: null, variantBest: null };

  // Find the most recent completed run for this agent across all evals
  let lastRun: AgentEvalSummary["lastRun"] = null;
  let lastRunTime = 0;

  // Find the best score for this agent's variant across all evals
  let variantBest: AgentEvalSummary["variantBest"] = null;
  let bestPct = 0;

  for (const evalType of MOCK_EVAL_TYPES) {
    // Last run for this agent
    const agentRuns = evalType.recentRuns
      .filter((r) => r.agentId === agentId && r.completedAt)
      .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());

    if (agentRuns.length > 0) {
      const r = agentRuns[0];
      const t = new Date(r.completedAt!).getTime();
      if (t > lastRunTime) {
        lastRunTime = t;
        lastRun = {
          evalId: evalType.id,
          evalName: evalType.name,
          score: r.score ?? 0,
          maxScore: r.maxScore ?? 0,
          completedAt: r.completedAt!,
          status: r.status as "completed" | "running" | "failed",
        };
      }
    }

    // Best score for this variant across all agents with same memoryVariant
    const variantRuns = evalType.recentRuns
      .filter((r) => r.memoryVariant === agent.memoryVariant && r.status === "completed" && r.score != null && r.maxScore);

    for (const r of variantRuns) {
      const pct = r.score! / r.maxScore!;
      if (pct > bestPct) {
        bestPct = pct;
        variantBest = {
          evalId: evalType.id,
          evalName: evalType.name,
          score: r.score!,
          maxScore: r.maxScore!,
          agentName: r.agentName,
          achievedAt: r.completedAt!,
        };
      }
    }
  }

  return { lastRun, variantBest };
}

// ---------------------------------------------------------------------------
// MEMORY VARIANTS
// ---------------------------------------------------------------------------

// SIMULATED: Replace with variant configs loaded from agent workspace definitions.
const MOCK_VARIANTS: MemoryVariant[] = [
  {
    id: "native-0d", name: "Native Baseline (0D)", dimensionality: "0D",
    description: "OpenClaw's default memory: flat Markdown files, LLM-directed writes, hybrid BM25+vector retrieval. No consolidation or structure. Memory flush disabled.",
    writePolicy: "LLM-directed (tool-based)", storageType: "Markdown files", retrievalMethod: "Hybrid BM25 (30%) + Vector (70%)",
    agents: ["agent-01"], evalPerformance: { "eval-fact-recall": 0.56, "eval-constraint-prop": 0.27, "eval-compositional-search": 0.38, "eval-skill-distillation": 0.10, "eval-temporal-reasoning": 0.31, "eval-multi-hop": 0.30, "eval-working-memory": 0.25, "eval-pref-aggregation": 0.24 },
  },
  {
    id: "native-0d-tuned", name: "Native Tuned (0D)", dimensionality: "0D",
    description: "OpenClaw native with flush enabled, higher reserveTokensFloor, tuned hybrid weights. Same architecture, better defaults.",
    writePolicy: "LLM-directed + pre-compaction flush", storageType: "Markdown files", retrievalMethod: "Hybrid BM25 (30%) + Vector (70%)",
    agents: ["agent-02"], evalPerformance: { "eval-fact-recall": 0.68, "eval-constraint-prop": 0.33, "eval-compositional-search": 0.45, "eval-skill-distillation": 0.15, "eval-temporal-reasoning": 0.40, "eval-multi-hop": 0.37, "eval-working-memory": 0.40, "eval-pref-aggregation": 0.32 },
  },
  {
    id: "mem0-1d", name: "Mem0 Hook-based (1D)", dimensionality: "1D",
    description: "Mem0 plugin with hook-based auto-capture and auto-recall. Extracts facts automatically on every turn via ADD/UPDATE/DELETE/NOOP consolidation. Memory lives outside context window.",
    writePolicy: "Hook-based automatic (before/after agent run)", storageType: "Mem0 vector store + fact deduplication", retrievalMethod: "Mem0 semantic search + auto-injection",
    agents: ["agent-03"], evalPerformance: { "eval-fact-recall": 0.86, "eval-constraint-prop": 0.63, "eval-compositional-search": 0.55, "eval-skill-distillation": 0.20, "eval-temporal-reasoning": 0.51, "eval-multi-hop": 0.53, "eval-working-memory": 0.60, "eval-pref-aggregation": 0.48 },
  },
  {
    id: "mem0-1d-aggressive", name: "Mem0 Aggressive (1D)", dimensionality: "1D",
    description: "Mem0 with aggressive extraction settings — captures more facts per turn, lower confidence threshold. Higher recall but more noise and cost.",
    writePolicy: "Hook-based aggressive (low threshold)", storageType: "Mem0 vector store", retrievalMethod: "Mem0 semantic search",
    agents: ["agent-04"], evalPerformance: { "eval-fact-recall": 0.82, "eval-constraint-prop": 0.58, "eval-compositional-search": 0.50, "eval-skill-distillation": 0.18, "eval-temporal-reasoning": 0.48, "eval-multi-hop": 0.49, "eval-working-memory": 0.55, "eval-pref-aggregation": 0.44 },
  },
  {
    id: "cognee-2d", name: "Cognee Knowledge Graph (2D)", dimensionality: "2D",
    description: "Cognee plugin building entity-relationship graph from Markdown files. Graph traversal for retrieval alongside vector similarity. Handles multi-hop queries naturally.",
    writePolicy: "Hook-based + graph extraction", storageType: "Knowledge graph + Markdown", retrievalMethod: "Graph traversal + chain-of-thought",
    agents: ["agent-05"], evalPerformance: { "eval-fact-recall": 0.88, "eval-constraint-prop": 0.57, "eval-compositional-search": 0.58, "eval-skill-distillation": 0.35, "eval-temporal-reasoning": 0.54, "eval-multi-hop": 0.70, "eval-working-memory": 0.50, "eval-pref-aggregation": 0.52 },
  },
  {
    id: "graphiti-2d+", name: "Graphiti Temporal Graph (2D+)", dimensionality: "2D+",
    description: "Zep's Graphiti with bi-temporal tracking (four timestamps per fact), three-tier data model (episodes/entities/communities), hybrid retrieval with no LLM calls at query time.",
    writePolicy: "Hook-based + temporal entity extraction", storageType: "Neo4j temporal knowledge graph", retrievalMethod: "Semantic + BM25 + graph traversal (P95: 300ms)",
    agents: ["agent-06"], evalPerformance: { "eval-fact-recall": 0.92, "eval-constraint-prop": 0.60, "eval-compositional-search": 0.62, "eval-skill-distillation": 0.30, "eval-temporal-reasoning": 0.83, "eval-multi-hop": 0.67, "eval-working-memory": 0.55, "eval-pref-aggregation": 0.56 },
  },
  {
    id: "diy-cron-1d", name: "Fisher DIY Cron (1D)", dimensionality: "1D",
    description: "Craig Fisher-inspired approach: cron-based external fact extraction every 4 hours, working-context.md for active tasks, temporally-structured MEMORY.md with [since:]/[updated:] markers, embedded Kuzu graph.",
    writePolicy: "External cron extraction (4h) + working-context.md", storageType: "JSONL facts + structured Markdown + Kuzu", retrievalMethod: "FTS5 + embedded graph queries",
    agents: ["agent-07"], evalPerformance: { "eval-fact-recall": 0.78, "eval-constraint-prop": 0.50, "eval-compositional-search": 0.60, "eval-skill-distillation": 0.25, "eval-temporal-reasoning": 0.60, "eval-multi-hop": 0.48, "eval-working-memory": 0.75, "eval-pref-aggregation": 0.45 },
  },
  {
    id: "learned-index", name: "Learned Index (Experimental)", dimensionality: "1D",
    description: "Experimental: small local transformer (1.5B) with per-user LoRA adapters as a learned memory index. Frozen backbone generates context in one forward pass. Not yet operational.",
    writePolicy: "Hook-based capture + LoRA adapter training", storageType: "Raw append-only log + LoRA weights", retrievalMethod: "Single forward pass through memory model",
    agents: ["agent-08"], evalPerformance: {},
  },
];

export function getSimulatedVariants(): MemoryVariant[] {
  return MOCK_VARIANTS;
}

export function getSimulatedVariant(id: string): MemoryVariant | undefined {
  return MOCK_VARIANTS.find((v) => v.id === id);
}

// ---------------------------------------------------------------------------
// COST DATA
// ---------------------------------------------------------------------------

// SIMULATED: Replace with real cost tracking from API usage logs.
// Future: Track per-request costs from Claude/OpenAI API responses.
export function getSimulatedCostHistory(): CostSnapshot[] {
  const snapshots: CostSnapshot[] = [];
  const now = Date.now();
  // Generate 4 hours of 15-minute snapshots
  for (let i = 16; i >= 0; i--) {
    const ts = new Date(now - i * 15 * 60_000).toISOString();
    const progress = (16 - i) / 16;
    const byAgent: Record<string, number> = {};
    for (const agent of MOCK_AGENTS) {
      if (agent.status === "offline") {
        byAgent[agent.id] = 0;
      } else {
        // Ramp up cost over time with some noise
        const base = agent.costEstimatedUsd * progress;
        const noise = (Math.random() - 0.5) * 0.3;
        byAgent[agent.id] = Math.max(0, +(base + noise).toFixed(2));
      }
    }
    const totalUsd = Object.values(byAgent).reduce((a, b) => a + b, 0);
    snapshots.push({ timestamp: ts, totalUsd: +totalUsd.toFixed(2), byAgent });
  }
  return snapshots;
}

// SIMULATED: Replace with persistent cost config from database/config file.
export function getSimulatedCostConfig(): CostConfig {
  return {
    globalCapUsd: 100,
    perEvalRunCapUsd: 10,
    warningThresholdPct: 80,
    autoStopOnCap: true,
  };
}

// SIMULATED: Replace with real API key management from secure storage.
// Future: Read from encrypted config; status from rate limit headers.
export function getSimulatedApiKeys(): ApiKeyConfig[] {
  return [
    { id: "key-1", label: "Primary Claude", provider: "anthropic", keyPrefix: "sk-ant-api03-15vJ...QAA", status: "active", rateLimitRpm: 4000, currentUsageRpm: 1250, isPrimary: true, totalSpentUsd: 38.50 },
    { id: "key-2", label: "Backup Claude", provider: "anthropic", keyPrefix: "sk-ant-api03-8xMn...R2w", status: "active", rateLimitRpm: 4000, currentUsageRpm: 0, isPrimary: false, totalSpentUsd: 0 },
    { id: "key-3", label: "OpenAI Embeddings", provider: "openai", keyPrefix: "sk-proj-7Kw2...mNx", status: "active", rateLimitRpm: 10000, currentUsageRpm: 340, isPrimary: true, totalSpentUsd: 2.15 },
  ];
}

// ---------------------------------------------------------------------------
// AGENT DETAIL: MEMORY GRAPH
// ---------------------------------------------------------------------------

// SIMULATED: Replace with real memory file analysis from agent workspace.
// Future: Parse agent's ~/.openclaw/workspace/ to build graph of memory files,
// entities, and relationships.
export function getSimulatedMemoryGraph(agentId: string): AgentMemoryGraph {
  // Agent-01 uses the full simulation data
  if (agentId === "agent-01") return SIM_MEMORY_GRAPH;

  const agent = MOCK_AGENTS.find((a) => a.id === agentId);
  if (!agent) return { nodes: [], edges: [] };

  const nodes: AgentMemoryGraph["nodes"] = [
    { id: "core", label: "MEMORY.md", type: "core", size: 40, itemCount: 1 },
  ];
  const edges: AgentMemoryGraph["edges"] = [];

  // Daily logs
  const dailyCount = Math.max(1, Math.floor(agent.sessionsTotal * 0.8));
  nodes.push({ id: "daily", label: "Daily Logs", type: "daily", size: 20 + dailyCount * 3, itemCount: dailyCount });
  edges.push({ source: "core", target: "daily", weight: 0.8 });

  // Topic files
  const topicCount = Math.floor(Math.random() * 5) + 2;
  for (let i = 0; i < topicCount; i++) {
    const topics = ["projects", "people", "decisions", "tools", "preferences", "workflows", "bugs"];
    const t = topics[i % topics.length];
    nodes.push({ id: `topic-${t}`, label: `memory/${t}.md`, type: "topic", size: 12 + Math.floor(Math.random() * 15), itemCount: Math.floor(Math.random() * 20) + 3 });
    edges.push({ source: "core", target: `topic-${t}`, weight: 0.5 + Math.random() * 0.3 });
    // Some cross-links between topics
    if (i > 0 && Math.random() > 0.5) {
      edges.push({ source: `topic-${topics[(i - 1) % topics.length]}`, target: `topic-${t}`, weight: 0.2 + Math.random() * 0.3 });
    }
  }

  // Graph entities for 2D variants
  if (agent.memoryVariant.includes("2d") || agent.memoryVariant.includes("graphiti")) {
    const entityCount = agent.metrics.graph_entities || Math.floor(Math.random() * 80) + 20;
    const clusterCount = agent.metrics.graph_communities || Math.floor(entityCount / 15);
    for (let c = 0; c < clusterCount; c++) {
      const clusterSize = Math.floor(entityCount / clusterCount);
      nodes.push({ id: `cluster-${c}`, label: `Community ${c + 1}`, type: "community", size: 15 + clusterSize * 2, itemCount: clusterSize });
      edges.push({ source: "core", target: `cluster-${c}`, weight: 0.6 });
      // Inter-cluster edges
      if (c > 0) {
        edges.push({ source: `cluster-${c - 1}`, target: `cluster-${c}`, weight: 0.15 + Math.random() * 0.2 });
      }
    }
  }

  // Fact store for 1D variants
  if (agent.memoryVariant.includes("1d") || agent.memoryVariant.includes("mem0") || agent.memoryVariant.includes("cron")) {
    const factCount = agent.metrics.mem0_facts_stored || agent.metrics.facts_jsonl_entries || Math.floor(Math.random() * 150) + 30;
    nodes.push({ id: "facts", label: "Fact Store", type: "fact", size: 20 + Math.min(factCount / 3, 50), itemCount: factCount });
    edges.push({ source: "core", target: "facts", weight: 0.9 });
    edges.push({ source: "daily", target: "facts", weight: 0.7 });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// AGENT DETAIL: LIVE MESSAGES
// ---------------------------------------------------------------------------

// SIMULATED: Replace with real-time message stream from agent session.
// Future: Subscribe to agent's WebSocket session channel for live messages.
const SAMPLE_MESSAGES: AgentMessage[] = [
  { id: "msg-1", timestamp: minutesAgo(5), role: "user", content: "What's the status of the database migration project?", tokenCount: 12 },
  { id: "msg-2", timestamp: minutesAgo(4.8), role: "system", content: "[Memory recall: searching MEMORY.md and memory/*.md for 'database migration']", tokenCount: 45 },
  { id: "msg-3", timestamp: minutesAgo(4.5), role: "assistant", content: "Based on my notes, the database migration from MySQL to PostgreSQL was approved on Feb 15th. The schema conversion is complete and we're in the testing phase. Key blockers: the legacy reporting queries need rewriting — Sarah is handling that. Target go-live: March 15th.", tokenCount: 62 },
  { id: "msg-4", timestamp: minutesAgo(3), role: "user", content: "Who's responsible for the auth module rewrite?", tokenCount: 10 },
  { id: "msg-5", timestamp: minutesAgo(2.8), role: "system", content: "[Memory recall: searching for 'auth module rewrite responsibility']", tokenCount: 38 },
  { id: "msg-6", timestamp: minutesAgo(2.5), role: "assistant", content: "Alice Chen is leading the auth module rewrite. She manages the auth team and has been working on the OAuth2 → OIDC migration. Her team includes Marcus (backend) and Priya (testing).", tokenCount: 48 },
  { id: "msg-7", timestamp: minutesAgo(1), role: "user", content: "Schedule a check-in with Alice for next week about auth progress", tokenCount: 14 },
  { id: "msg-8", timestamp: minutesAgo(0.5), role: "tool", content: "[calendar.create_event: 'Auth Module Check-in with Alice Chen', next Tuesday 2pm, 30min]", tokenCount: 32 },
  { id: "msg-9", timestamp: minutesAgo(0.3), role: "assistant", content: "Done. I've scheduled a 30-minute check-in with Alice Chen for next Tuesday at 2pm titled 'Auth Module Check-in'. I've also noted this in today's memory log.", tokenCount: 38 },
];

export function getSimulatedMessages(agentId: string): AgentMessage[] {
  // Agent-01 uses the full simulation transcript
  if (agentId === "agent-01") return SIM_MESSAGES;
  return SAMPLE_MESSAGES.map((m) => ({ ...m }));
}
