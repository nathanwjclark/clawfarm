/**
 * Definition for an external eval that runs as a subprocess.
 * Unlike scripted EvalDefinitions (with messages[] + scoring[]),
 * external evals are self-contained programs that output transcript JSON.
 */
export interface ExternalEvalDefinition {
  id: string;
  name: string;
  description: string;
  category: "recall" | "reasoning" | "integration" | "robustness" | "simulation";
  /** Command to spawn. */
  command: string;
  /** Args array. Supports placeholders: {days}, {logDir}, {evalDir}, {openclawDir}, {workspaceDir} */
  args: string[];
  /** Default number of simulation days. */
  defaultDays: number;
  /** Max score sentinel: -1 = unbounded (display raw value, not percentage). */
  maxScore: number;
  /** Regex to parse progress from stdout. Named groups: day, totalDays, netWorth (optional). */
  progressPattern: RegExp;
  /** How to extract results from the transcript JSON file. */
  resultExtractor: (transcriptPath: string) => Promise<ExternalEvalResult>;
  /** If true, use EvalBridge (HTTP agent mode) instead of ExternalEvalRunner (direct openclaw). */
  agentMode?: boolean;
}

export interface ExternalEvalResult {
  score: number;
  maxScore: number;
  taskResults: Record<string, number>;
  costUsd: number;
  durationMs: number;
  /** Operational metrics from the eval run (LLM calls, tool usage, etc.) */
  runMetrics?: RunMetrics;
}

/**
 * Operational metrics captured during an eval run.
 * These are agent execution stats — not eval-specific scores.
 */
export interface RunMetrics {
  llmCalls: number;
  toolCalls: number;
  messagesGenerated: number;
  /** Token usage breakdown (more granular than EvalRunResult.tokenUsage). */
  tokenBreakdown?: {
    agentInputTokens: number;
    agentOutputTokens: number;
    supplierInputTokens?: number;
    supplierOutputTokens?: number;
  };
  /** Any additional counters specific to the eval type. */
  extra?: Record<string, number | string>;
}

export interface ExternalEvalProgress {
  current: number;
  total: number;
  label: string;
  score?: number;
}
