// Re-export farm types that the agent base image produces
// These are duplicated here (not imported from ../src/) to keep agent-base self-contained.
// Keep in sync with clawfarm/src/types.ts.

export interface AgentStatus {
  id: string;
  name: string;
  memoryVariant: string;
  status: "online" | "offline" | "error";
  uptimeSeconds: number;
  lastHeartbeat: string;
  mode: "eval" | "real-world";
  messagesProcessed: number;
  sessionsTotal: number;
  sessionsActive: number;
  contextTokensUsed: number;
  contextTokensAvailable: number;
  costInputTokens: number;
  costOutputTokens: number;
  costCacheReadTokens: number;
  costEstimatedUsd: number;
  metrics: Record<string, number>;
  integrations: IntegrationStatus[];
}

export interface IntegrationStatus {
  name: string;
  type: "slack" | "discord" | "telegram" | "webchat" | "api";
  status: "connected" | "disconnected" | "error";
  lastCheck: string;
  details?: string;
}

export interface AgentMemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

export interface MemoryGraphNode {
  id: string;
  label: string;
  type: "core" | "daily" | "topic" | "fact" | "entity" | "community";
  size: number;
  itemCount: number;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface AgentMessage {
  id: string;
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tokenCount: number;
}

export interface AgentEvalSummary {
  lastRun: {
    evalId: string;
    evalName: string;
    score: number;
    maxScore: number;
    completedAt: string;
    status: "completed" | "running" | "failed";
  } | null;
  variantBest: {
    evalId: string;
    evalName: string;
    score: number;
    maxScore: number;
    agentName: string;
    achievedAt: string;
  } | null;
}

// Token usage from a single agent run
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Accumulated cost state
export interface CostState {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  estimatedUsd: number;
}

// Per-model pricing (USD per million tokens)
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

// Snapshot of memory state after an eval run
export interface MemorySnapshot {
  variantId: string;
  files: Array<{ path: string; content: string }>;
  stats: {
    totalChunks: number;
    totalFiles: number;
    indexSizeBytes: number;
  };
  graphState: AgentMemoryGraph;
}

export interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory" | "sessions";
  citation?: string;
}

export interface MemoryReadResult {
  path: string;
  text: string;
}

export interface MemoryWriteResult {
  ok: boolean;
  path: string;
  mode: "append" | "replace";
  bytesWritten: number;
}

// Result of a completed eval run
export interface EvalRunResult {
  runId: string;
  evalId: string;
  agentId: string;
  memoryVariant: string;
  status: "completed" | "failed";
  score: number;
  maxScore: number;
  taskResults: Record<string, number>;
  costUsd: number;
  durationMs: number;
  tokenUsage: { input: number; output: number; cacheRead: number };
  transcripts: Array<{ sessionIndex: number; messages: AgentMessage[] }>;
  memorySnapshot: MemorySnapshot;
  /** Operational metrics (LLM calls, tool calls, messages, token breakdown). */
  runMetrics?: RunMetrics;
}

/** Operational metrics captured during an eval run. */
export interface RunMetrics {
  llmCalls: number;
  toolCalls: number;
  messagesGenerated: number;
  tokenBreakdown?: {
    agentInputTokens: number;
    agentOutputTokens: number;
    supplierInputTokens?: number;
    supplierOutputTokens?: number;
  };
  extra?: Record<string, number | string>;
}
