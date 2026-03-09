import type { TokenUsage, CostState, ModelPricing } from "../types.js";

/**
 * Accumulates token usage and estimates cost across sessions and eval runs.
 * Enforces cost caps and provides current state for reporting.
 */
export class CostTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private pricing: ModelPricing;
  private perEvalCapUsd: number;
  private totalCapUsd: number;

  constructor(pricing: ModelPricing, caps: { perEvalRunUsd: number; totalUsd: number }) {
    this.pricing = pricing;
    this.perEvalCapUsd = caps.perEvalRunUsd;
    this.totalCapUsd = caps.totalUsd;
  }

  recordUsage(usage: TokenUsage): void {
    this.inputTokens += usage.input;
    this.outputTokens += usage.output;
    this.cacheReadTokens += usage.cacheRead;
    this.cacheWriteTokens += usage.cacheWrite;
  }

  getState(): CostState {
    return {
      totalInputTokens: this.inputTokens,
      totalOutputTokens: this.outputTokens,
      totalCacheReadTokens: this.cacheReadTokens,
      totalCacheWriteTokens: this.cacheWriteTokens,
      estimatedUsd: this.estimateUsd(),
    };
  }

  estimateUsd(): number {
    const { inputPerMillion, outputPerMillion, cacheReadPerMillion, cacheWritePerMillion } = this.pricing;
    const cost =
      (this.inputTokens * inputPerMillion +
        this.outputTokens * outputPerMillion +
        this.cacheReadTokens * cacheReadPerMillion +
        this.cacheWriteTokens * cacheWritePerMillion) /
      1_000_000;
    return parseFloat(cost.toFixed(6));
  }

  isOverTotalCap(): boolean {
    return this.estimateUsd() >= this.totalCapUsd;
  }

  isOverEvalCap(): boolean {
    return this.estimateUsd() >= this.perEvalCapUsd;
  }

  /** Reset for a new eval run (keeps total tracking but resets eval-level cap checking). */
  resetEvalAccumulator(): void {
    // For now, total reset — when we add per-eval vs total separation, split here
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheWriteTokens = 0;
  }
}
