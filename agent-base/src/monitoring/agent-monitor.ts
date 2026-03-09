import type { AgentBaseConfig } from "../config.js";
import type { AgentStatus, TokenUsage, AgentMessage, AgentMemoryGraph, AgentEvalSummary } from "../types.js";
import { CostTracker } from "./cost-tracker.js";

/**
 * Tracks agent runtime state: status, uptime, tokens, messages, sessions.
 * Produces AgentStatus snapshots for the farm dashboard.
 */
export class AgentMonitor {
  private status: "online" | "offline" | "error" = "offline";
  private errorMessage: string | null = null;
  private uptimeSeconds = 0;
  private uptimeTimer: ReturnType<typeof setInterval> | null = null;
  private messagesProcessed = 0;
  private sessionsTotal = 0;
  private sessionsActive = 0;
  private contextTokensUsed = 0;
  private messages: AgentMessage[] = [];
  private evalSummary: AgentEvalSummary = { lastRun: null, variantBest: null };
  private memoryGraph: AgentMemoryGraph = { nodes: [], edges: [] };

  readonly costTracker: CostTracker;

  constructor(private config: AgentBaseConfig) {
    this.costTracker = new CostTracker(config.pricing, config.costCap);
  }

  start(): void {
    this.status = "online";
    this.errorMessage = null;
    this.uptimeTimer = setInterval(() => {
      if (this.status === "online") {
        this.uptimeSeconds++;
      }
    }, 1000);
  }

  stop(): void {
    this.status = "offline";
    if (this.uptimeTimer) {
      clearInterval(this.uptimeTimer);
      this.uptimeTimer = null;
    }
  }

  setError(error: string | null): void {
    if (error) {
      this.status = "error";
      this.errorMessage = error;
    } else {
      this.errorMessage = null;
      if (this.status === "error") {
        this.status = "online";
      }
    }
  }

  recordTokenUsage(usage: TokenUsage): void {
    this.costTracker.recordUsage(usage);
    // contextTokensUsed reflects the latest run's context size (input tokens approximate it)
    this.contextTokensUsed = usage.input;
  }

  recordMessageProcessed(message?: AgentMessage): void {
    this.messagesProcessed++;
    if (message) {
      this.messages.push(message);
    }
  }

  recordSessionStart(): void {
    this.sessionsTotal++;
    this.sessionsActive++;
  }

  recordSessionEnd(): void {
    this.sessionsActive = Math.max(0, this.sessionsActive - 1);
  }

  setEvalSummary(summary: AgentEvalSummary): void {
    this.evalSummary = summary;
  }

  setMemoryGraph(graph: AgentMemoryGraph): void {
    this.memoryGraph = graph;
  }

  getStatus(): AgentStatus {
    const cost = this.costTracker.getState();
    return {
      id: this.config.agentId,
      name: this.config.agentName,
      memoryVariant: this.config.memoryVariant,
      status: this.status,
      uptimeSeconds: this.uptimeSeconds,
      lastHeartbeat: new Date().toISOString(),
      mode: this.config.mode,
      messagesProcessed: this.messagesProcessed,
      sessionsTotal: this.sessionsTotal,
      sessionsActive: this.sessionsActive,
      contextTokensUsed: this.contextTokensUsed,
      contextTokensAvailable: this.config.contextTokensAvailable,
      costInputTokens: cost.totalInputTokens,
      costOutputTokens: cost.totalOutputTokens,
      costCacheReadTokens: cost.totalCacheReadTokens,
      costEstimatedUsd: cost.estimatedUsd,
      metrics: {},
      integrations: [
        {
          name: "Farm Dashboard",
          type: "api",
          status: this.status === "online" ? "connected" : "disconnected",
          lastCheck: new Date().toISOString(),
        },
      ],
    };
  }

  getMessages(): AgentMessage[] {
    return this.messages;
  }

  getMemoryGraph(): AgentMemoryGraph {
    return this.memoryGraph;
  }

  getEvalSummary(): AgentEvalSummary {
    return this.evalSummary;
  }

  /** Full reset for a new eval run. */
  reset(): void {
    this.uptimeSeconds = 0;
    this.messagesProcessed = 0;
    this.sessionsTotal = 0;
    this.sessionsActive = 0;
    this.contextTokensUsed = 0;
    this.messages = [];
    this.evalSummary = { lastRun: null, variantBest: null };
    this.memoryGraph = { nodes: [], edges: [] };
    this.costTracker.resetEvalAccumulator();
  }
}
