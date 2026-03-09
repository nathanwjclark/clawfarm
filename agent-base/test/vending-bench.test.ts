import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { vendingBenchEval } from "../src/evals/vending-bench.js";

describe("vending-bench result extractor", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vb-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("separates eval scores from operational metrics", async () => {
    // Realistic transcript JSON matching vending-bench-openclaw output
    const transcript = {
      config: { days: 20, mode: "openclaw" },
      score: {
        bankBalance: 1084.9,
        machineCash: 69.3,
        storageInventoryValue: 570.17,
        machineInventoryValue: 79.31,
        pendingCreditValue: 161.7,
        netWorth: 1965.38,
        totalRevenue: 2504.0,
        totalSupplierSpend: 1633.1,
        totalItemsSold: 904,
        daysCompleted: 20,
        gameOverReason: "Simulation complete: 20 days elapsed.",
      },
      cost: {
        runId: "test-run",
        startedAt: "2026-03-08T10:00:00Z",
        endedAt: "2026-03-08T10:09:30Z",
        model: "claude-sonnet-4-20250514",
        daysSimulated: 20,
        totalInputTokens: 3440300,
        totalOutputTokens: 29500,
        agentInputTokens: 3200000,
        agentOutputTokens: 28000,
        supplierInputTokens: 240300,
        supplierOutputTokens: 1500,
        agentCalls: 90,
        supplierCalls: 20,
        estimatedCostUsd: 10.763,
      },
      totalLlmCalls: 90,
      totalToolExecutions: 284,
      messageCount: 395,
      wallTimeSeconds: 570.8,
    };

    const transcriptPath = path.join(tmpDir, "run-test-transcript.json");
    await fs.writeFile(transcriptPath, JSON.stringify(transcript));

    const result = await vendingBenchEval.resultExtractor(transcriptPath);

    // Main score should be net worth
    expect(result.score).toBe(1965.38);
    expect(result.maxScore).toBe(-1);

    // --- Eval-specific scores (taskResults) ---
    // Net worth components
    expect(result.taskResults.bankBalance).toBe(1084.9);
    expect(result.taskResults.machineCash).toBe(69.3);
    expect(result.taskResults.storageInventoryValue).toBe(570.17);
    expect(result.taskResults.machineInventoryValue).toBe(79.31);
    expect(result.taskResults.pendingCreditValue).toBe(161.7);

    // Performance metrics
    expect(result.taskResults.totalRevenue).toBe(2504.0);
    expect(result.taskResults.totalSupplierSpend).toBe(1633.1);
    expect(result.taskResults.totalItemsSold).toBe(904);
    expect(result.taskResults.daysCompleted).toBe(20);
    expect(result.taskResults.grossMargin).toBeCloseTo(870.9, 1);

    // Operational metrics should NOT be in taskResults
    expect(result.taskResults.llmCalls).toBeUndefined();
    expect(result.taskResults.toolCalls).toBeUndefined();
    expect(result.taskResults.wallTimeSeconds).toBeUndefined();

    // --- Farm-native operational metrics (runMetrics) ---
    expect(result.runMetrics).toBeDefined();
    expect(result.runMetrics!.llmCalls).toBe(90);
    expect(result.runMetrics!.toolCalls).toBe(284);
    expect(result.runMetrics!.messagesGenerated).toBe(395);

    // Token breakdown
    expect(result.runMetrics!.tokenBreakdown).toBeDefined();
    expect(result.runMetrics!.tokenBreakdown!.agentInputTokens).toBe(3200000);
    expect(result.runMetrics!.tokenBreakdown!.agentOutputTokens).toBe(28000);
    expect(result.runMetrics!.tokenBreakdown!.supplierInputTokens).toBe(240300);
    expect(result.runMetrics!.tokenBreakdown!.supplierOutputTokens).toBe(1500);

    // Extra metadata
    expect(result.runMetrics!.extra!.gameOverReason).toBe("Simulation complete: 20 days elapsed.");
    expect(result.runMetrics!.extra!.supplierCalls).toBe(20);

    // Cost and duration
    expect(result.costUsd).toBe(10.763);
    expect(result.durationMs).toBe(570800); // 570.8s → ms
  });

  it("handles minimal transcript gracefully", async () => {
    const transcript = {
      score: { netWorth: 500 },
      cost: {},
    };

    const transcriptPath = path.join(tmpDir, "run-minimal-transcript.json");
    await fs.writeFile(transcriptPath, JSON.stringify(transcript));

    const result = await vendingBenchEval.resultExtractor(transcriptPath);

    expect(result.score).toBe(500);
    expect(result.costUsd).toBe(0);
    expect(result.durationMs).toBe(0);
    expect(result.runMetrics).toBeDefined();
    expect(result.runMetrics!.llmCalls).toBe(0);
  });

  it("eval definition has correct metadata", () => {
    expect(vendingBenchEval.id).toBe("vending-bench");
    expect(vendingBenchEval.category).toBe("simulation");
    expect(vendingBenchEval.maxScore).toBe(-1);
    expect(vendingBenchEval.defaultDays).toBe(365);
    expect(vendingBenchEval.command).toBe("npx");
    expect(vendingBenchEval.args).toContain("{days}");
  });
});
