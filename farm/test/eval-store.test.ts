import { describe, it, expect, beforeEach } from "vitest";
import {
  storeEvalResult,
  storeEvalMetadata,
  storeEvalProgress,
  getRunningEvals,
  getStoredEvalTypes,
  getStoredEvalType,
  getStoredVariantPerformance,
  getRecentRunsForAgent,
  resetEvalStore,
} from "../src/eval-store.js";

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    evalId: "eval-recall-basic",
    agentId: "agent-01",
    memoryVariant: "native-0d",
    status: "completed" as const,
    score: 8,
    maxScore: 10,
    taskResults: { "task-1": 5, "task-2": 3 },
    costUsd: 0.05,
    durationMs: 5000,
    ...overrides,
  };
}

const nameLookup = (id: string) => id;

describe("eval-store", () => {
  beforeEach(() => {
    resetEvalStore();
  });

  it("stores and retrieves eval results as EvalTypes", () => {
    const result = makeResult();
    storeEvalResult(result, "Agent One", "fast");

    const evalTypes = getStoredEvalTypes(nameLookup);
    expect(evalTypes).toHaveLength(1);
    expect(evalTypes[0].id).toBe("eval-recall-basic");
    expect(evalTypes[0].recentRuns).toHaveLength(1);
    expect(evalTypes[0].recentRuns[0].score).toBe(8);
    expect(evalTypes[0].recentRuns[0].agentName).toBe("Agent One");
    expect(evalTypes[0].recentRuns[0].clockSpeed).toBe("fast");
  });

  it("computes highScore from completed runs", () => {
    storeEvalResult(makeResult({ runId: "r1", score: 6 }), "Agent One", "fast");
    storeEvalResult(makeResult({ runId: "r2", score: 9 }), "Agent One", "fast");
    storeEvalResult(makeResult({ runId: "r3", score: 7 }), "Agent Two", "real-world");

    const evalTypes = getStoredEvalTypes(nameLookup);
    expect(evalTypes[0].highScore).not.toBeNull();
    expect(evalTypes[0].highScore!.score).toBe(9);
    expect(evalTypes[0].highScore!.runId).toBe("r2");
  });

  it("does not produce highScore when all runs failed", () => {
    storeEvalResult(makeResult({ runId: "r1", status: "failed" }), "Agent One", "fast");

    const evalTypes = getStoredEvalTypes(nameLookup);
    expect(evalTypes[0].highScore).toBeNull();
  });

  it("uses metadata when available", () => {
    storeEvalMetadata({
      id: "eval-recall-basic",
      name: "Basic Recall",
      description: "Tests basic memory recall",
      category: "recall",
      taskCount: 5,
      maxScore: 10,
    });
    storeEvalResult(makeResult(), "Agent One", "fast");

    const evalTypes = getStoredEvalTypes(nameLookup);
    expect(evalTypes[0].name).toBe("Basic Recall");
    expect(evalTypes[0].description).toBe("Tests basic memory recall");
    expect(evalTypes[0].taskCount).toBe(5);
  });

  it("auto-creates metadata stub when evalId is unknown", () => {
    storeEvalResult(makeResult(), "Agent One", "fast");

    const evalTypes = getStoredEvalTypes(nameLookup);
    expect(evalTypes[0].name).toBe("eval-recall-basic");
    expect(evalTypes[0].taskCount).toBe(2); // from taskResults keys
  });

  it("groups multiple evals separately", () => {
    storeEvalResult(makeResult({ evalId: "eval-a" }), "Agent", "fast");
    storeEvalResult(makeResult({ evalId: "eval-b" }), "Agent", "fast");

    const evalTypes = getStoredEvalTypes(nameLookup);
    expect(evalTypes).toHaveLength(2);
    const ids = evalTypes.map((e) => e.id).sort();
    expect(ids).toEqual(["eval-a", "eval-b"]);
  });

  it("getStoredEvalType returns single eval", () => {
    storeEvalResult(makeResult({ evalId: "eval-a" }), "Agent", "fast");
    storeEvalResult(makeResult({ evalId: "eval-b" }), "Agent", "fast");

    const evalType = getStoredEvalType("eval-a", nameLookup);
    expect(evalType).toBeDefined();
    expect(evalType!.id).toBe("eval-a");

    expect(getStoredEvalType("nonexistent", nameLookup)).toBeUndefined();
  });

  it("computes variant performance as best score percentage", () => {
    storeEvalResult(
      makeResult({ runId: "r1", memoryVariant: "v1", evalId: "e1", score: 7, maxScore: 10 }),
      "Agent", "fast",
    );
    storeEvalResult(
      makeResult({ runId: "r2", memoryVariant: "v1", evalId: "e1", score: 9, maxScore: 10 }),
      "Agent", "fast",
    );
    storeEvalResult(
      makeResult({ runId: "r3", memoryVariant: "v2", evalId: "e1", score: 5, maxScore: 10 }),
      "Agent", "fast",
    );

    const perf = getStoredVariantPerformance();
    expect(perf.get("v1")).toEqual({ e1: 90 });
    expect(perf.get("v2")).toEqual({ e1: 50 });
  });

  it("excludes failed runs from variant performance", () => {
    storeEvalResult(
      makeResult({ runId: "r1", memoryVariant: "v1", status: "failed", score: 0 }),
      "Agent", "fast",
    );

    const perf = getStoredVariantPerformance();
    expect(perf.size).toBe(0);
  });

  it("getRecentRunsForAgent filters by agentId", () => {
    storeEvalResult(makeResult({ runId: "r1", agentId: "a1" }), "Agent1", "fast");
    storeEvalResult(makeResult({ runId: "r2", agentId: "a2" }), "Agent2", "fast");
    storeEvalResult(makeResult({ runId: "r3", agentId: "a1" }), "Agent1", "fast");

    const runs = getRecentRunsForAgent("a1", nameLookup);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.agentId === "a1")).toBe(true);
  });

  it("limits recentRuns to 10 per eval", () => {
    for (let i = 0; i < 15; i++) {
      storeEvalResult(makeResult({ runId: `r${i}` }), "Agent", "fast");
    }

    const evalTypes = getStoredEvalTypes(nameLookup);
    expect(evalTypes[0].recentRuns).toHaveLength(10);
  });

  it("stores and retrieves eval progress", () => {
    storeEvalProgress("run-1", "agent-01", "vending-bench", "native-0d", "Agent One", "fast", {
      current: 42,
      total: 365,
      label: "day",
      score: 1500,
    });

    const running = getRunningEvals();
    expect(running).toHaveLength(1);
    expect(running[0].runId).toBe("run-1");
    expect(running[0].evalId).toBe("vending-bench");
    expect(running[0].progress.current).toBe(42);
    expect(running[0].progress.score).toBe(1500);
  });

  it("running eval shows as running in EvalType recentRuns", () => {
    storeEvalProgress("run-1", "agent-01", "vending-bench", "native-0d", "Agent One", "fast", {
      current: 100,
      total: 365,
      label: "day",
      score: 2000,
    });

    const evalTypes = getStoredEvalTypes(nameLookup);
    const vb = evalTypes.find(e => e.id === "vending-bench");
    expect(vb).toBeDefined();
    expect(vb!.recentRuns[0].status).toBe("running");
    expect(vb!.recentRuns[0].progress).toBeDefined();
    expect(vb!.recentRuns[0].progress!.current).toBe(100);
  });

  it("storeEvalResult overwrites running progress entry", () => {
    storeEvalProgress("run-1", "agent-01", "vending-bench", "native-0d", "Agent One", "fast", {
      current: 200,
      total: 365,
      label: "day",
      score: 3000,
    });

    // Now store the final result with same runId
    storeEvalResult(
      {
        runId: "run-1",
        evalId: "vending-bench",
        agentId: "agent-01",
        memoryVariant: "native-0d",
        status: "completed",
        score: 5000,
        maxScore: -1,
        taskResults: { netWorth: 5000 },
        costUsd: 2.5,
        durationMs: 60000,
      },
      "Agent One",
      "fast",
    );

    const running = getRunningEvals();
    expect(running).toHaveLength(0);

    const evalTypes = getStoredEvalTypes(nameLookup);
    const vb = evalTypes.find(e => e.id === "vending-bench");
    expect(vb).toBeDefined();
    expect(vb!.recentRuns[0].status).toBe("completed");
    expect(vb!.recentRuns[0].score).toBe(5000);
  });

  it("computes startedAt from completedAt minus durationMs", () => {
    const before = Date.now();
    storeEvalResult(makeResult({ durationMs: 10000 }), "Agent", "fast");
    const after = Date.now();

    const evalTypes = getStoredEvalTypes(nameLookup);
    const run = evalTypes[0].recentRuns[0];

    const startedMs = new Date(run.startedAt).getTime();
    const completedMs = new Date(run.completedAt!).getTime();
    const duration = completedMs - startedMs;

    // Duration should be approximately 10000ms
    expect(duration).toBeGreaterThanOrEqual(9900);
    expect(duration).toBeLessThanOrEqual(10100);
    // completedAt should be roughly now
    expect(completedMs).toBeGreaterThanOrEqual(before);
    expect(completedMs).toBeLessThanOrEqual(after + 100);
  });
});
