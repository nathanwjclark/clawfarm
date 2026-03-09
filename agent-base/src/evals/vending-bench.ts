import fs from "node:fs/promises";
import type { ExternalEvalDefinition, ExternalEvalResult } from "./external-eval-definition.js";

/**
 * Vending Bench — a 365-day business simulation eval.
 * The runner lives in an external project (vending-bench).
 *
 * Supports two modes:
 * - agent mode (agentMode: true): eval calls agent-base's /eval/message endpoint
 * - legacy mode: eval spawns openclaw directly
 *
 * The agent mode definition uses {agentUrl}, {farmUrl}, {agentId} placeholders.
 */
export const vendingBenchEval: ExternalEvalDefinition = {
  id: "vending-bench",
  name: "Vending Bench",
  description:
    "365-day vending machine business simulation. Measures strategic planning, " +
    "financial management, and long-term decision-making. Score is net worth in dollars.",
  category: "simulation",
  command: "npx",
  args: [
    "tsx",
    "{evalDir}/src/index.ts",
    "run",
    "--mode",
    "agent",
    "--days",
    "{days}",
    "--agent-url",
    "{agentUrl}",
    "--farm-url",
    "{farmUrl}",
    "--agent-id",
    "{agentId}",
    "--log-dir",
    "{logDir}",
  ],
  defaultDays: 365,
  maxScore: -1, // unbounded — score is net worth in dollars
  progressPattern: /Day (\d+)\/(\d+).*Net Worth: \$([0-9.,-]+)/,
  resultExtractor: extractVendingBenchResult,
  agentMode: true,
};

async function extractVendingBenchResult(
  transcriptPath: string,
): Promise<ExternalEvalResult> {
  const raw = await fs.readFile(transcriptPath, "utf-8");
  const transcript = JSON.parse(raw);

  // The transcript has: { config, score: ScoreBreakdown, cost: RunCostEntry, totalLlmCalls, totalToolExecutions, messageCount, wallTimeSeconds }
  const score = transcript.score ?? {};
  const cost = transcript.cost ?? {};

  // --- Eval-specific scores (domain metrics) ---
  // These go in taskResults — they represent the eval's performance output.
  const taskResults: Record<string, number> = {};

  // Net worth components
  if (score.bankBalance !== undefined) taskResults.bankBalance = score.bankBalance;
  if (score.machineCash !== undefined) taskResults.machineCash = score.machineCash;
  if (score.storageInventoryValue !== undefined) taskResults.storageInventoryValue = score.storageInventoryValue;
  if (score.machineInventoryValue !== undefined) taskResults.machineInventoryValue = score.machineInventoryValue;
  if (score.pendingCreditValue !== undefined) taskResults.pendingCreditValue = score.pendingCreditValue;

  // Performance metrics
  if (score.totalRevenue !== undefined) taskResults.totalRevenue = score.totalRevenue;
  if (score.totalSupplierSpend !== undefined) taskResults.totalSupplierSpend = score.totalSupplierSpend;
  if (score.totalItemsSold !== undefined) taskResults.totalItemsSold = score.totalItemsSold;
  if (score.daysCompleted !== undefined) taskResults.daysCompleted = score.daysCompleted;

  // Derived: gross margin
  if (score.totalRevenue !== undefined && score.totalSupplierSpend !== undefined) {
    taskResults.grossMargin = score.totalRevenue - score.totalSupplierSpend;
  }

  // Main score: net worth
  const netWorth = score.netWorth ?? 0;

  // Wall time from transcript (seconds → ms)
  const wallTimeSeconds = transcript.wallTimeSeconds ?? 0;
  const durationMs = wallTimeSeconds > 0 ? Math.round(wallTimeSeconds * 1000) : 0;

  // Cost
  const costUsd = cost.estimatedCostUsd ?? 0;

  // --- Farm-native operational metrics ---
  const runMetrics = {
    llmCalls: transcript.totalLlmCalls ?? cost.agentCalls ?? 0,
    toolCalls: transcript.totalToolExecutions ?? 0,
    messagesGenerated: transcript.messageCount ?? 0,
    tokenBreakdown: {
      agentInputTokens: cost.agentInputTokens ?? 0,
      agentOutputTokens: cost.agentOutputTokens ?? 0,
      supplierInputTokens: cost.supplierInputTokens ?? undefined,
      supplierOutputTokens: cost.supplierOutputTokens ?? undefined,
    },
    extra: {} as Record<string, number | string>,
  };

  // Include game over reason if present
  if (score.gameOverReason) {
    runMetrics.extra.gameOverReason = score.gameOverReason;
  }

  // Include supplier call count if present
  if (cost.supplierCalls !== undefined) {
    runMetrics.extra.supplierCalls = cost.supplierCalls;
  }

  return {
    score: netWorth,
    maxScore: -1,
    taskResults,
    costUsd,
    durationMs,
    runMetrics,
  };
}
