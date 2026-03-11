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

export interface EvalType {
  id: string;
  name: string;
  description: string;
  category: "recall" | "reasoning" | "integration" | "robustness" | "simulation";
  taskCount: number;
  maxScore?: number;
  highScore: EvalScore | null;
  recentRuns: EvalRun[];
}

export interface EvalRun {
  id: string;
  evalId: string;
  agentId: string;
  agentName: string;
  memoryVariant: string;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "running" | "completed" | "failed";
  clockSpeed: "fast" | "real-world" | "custom";
  customSpeedMs?: number;
  score?: number;
  maxScore?: number;
  taskResults?: Record<string, number>;
  costUsd?: number;
  progress?: {
    current: number;
    total: number;
    label?: string;
    score?: number;
  };
  runMetrics?: RunMetrics;
  /** Profiling timing summary (persisted, available after completion). */
  profilingSummary?: {
    days: Array<{
      day: number;
      wallMs: number;
      chatHandlerMs: number;
      openclawMs: number;
      bootstrapMs: number;
      llmApiMs: number;
      toolExecMs: number;
    }>;
    avg: {
      wallMs: number;
      chatHandlerMs: number;
      openclawMs: number;
      bootstrapMs: number;
      llmApiMs: number;
      toolExecMs: number;
    };
    firstDay?: {
      day: number;
      wallMs: number;
      chatHandlerMs: number;
      openclawMs: number;
      bootstrapMs: number;
      llmApiMs: number;
      toolExecMs: number;
    };
  };
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

export interface EvalScore {
  agentId: string;
  agentName: string;
  memoryVariant: string;
  score: number;
  maxScore: number;
  runId: string;
  achievedAt: string;
}

export interface MemoryVariant {
  id: string;
  name: string;
  dimensionality: "0D" | "1D" | "2D" | "2D+";
  description: string;
  writePolicy: string;
  storageType: string;
  retrievalMethod: string;
  agents: string[];
  evalPerformance: Record<string, number>;
}

export interface CostSnapshot {
  timestamp: string;
  totalUsd: number;
  byAgent: Record<string, number>;
}

export interface CostConfig {
  globalCapUsd: number;
  perEvalRunCapUsd: number;
  warningThresholdPct: number;
  autoStopOnCap: boolean;
}

export interface ApiKeyConfig {
  id: string;
  label: string;
  provider: "anthropic" | "openai";
  keyPrefix: string;
  status: "active" | "rate-limited" | "exhausted" | "error";
  rateLimitRpm: number;
  currentUsageRpm: number;
  isPrimary: boolean;
  totalSpentUsd: number;
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
