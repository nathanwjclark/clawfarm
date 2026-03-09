import { describe, it, expect } from "vitest";
import { CostTracker } from "../src/monitoring/cost-tracker.js";

describe("CostTracker", () => {
  const defaultPricing = {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.30,
    cacheWritePerMillion: 3.75,
  };

  it("accumulates token usage", () => {
    const tracker = new CostTracker(defaultPricing, { perEvalRunUsd: 10, totalUsd: 100 });
    tracker.recordUsage({ input: 1000, output: 500, cacheRead: 200, cacheWrite: 0 });
    tracker.recordUsage({ input: 2000, output: 1000, cacheRead: 300, cacheWrite: 100 });

    const state = tracker.getState();
    expect(state.totalInputTokens).toBe(3000);
    expect(state.totalOutputTokens).toBe(1500);
    expect(state.totalCacheReadTokens).toBe(500);
    expect(state.totalCacheWriteTokens).toBe(100);
  });

  it("estimates cost correctly", () => {
    const tracker = new CostTracker(defaultPricing, { perEvalRunUsd: 10, totalUsd: 100 });
    // 1M input tokens = $3, 1M output tokens = $15
    tracker.recordUsage({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 });

    expect(tracker.estimateUsd()).toBe(18);
  });

  it("detects cost cap exceeded", () => {
    const tracker = new CostTracker(defaultPricing, { perEvalRunUsd: 1, totalUsd: 5 });
    // Enough output tokens to exceed $1 eval cap: need $1 = 1M/15 = ~66,667 output tokens
    tracker.recordUsage({ input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 });
    expect(tracker.isOverEvalCap()).toBe(true);
  });

  it("resets eval accumulator", () => {
    const tracker = new CostTracker(defaultPricing, { perEvalRunUsd: 10, totalUsd: 100 });
    tracker.recordUsage({ input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 });
    tracker.resetEvalAccumulator();

    const state = tracker.getState();
    expect(state.totalInputTokens).toBe(0);
    expect(state.estimatedUsd).toBe(0);
  });
});
