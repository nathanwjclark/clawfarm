import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExternalEvalRunner } from "../src/lifecycle/external-eval-runner.js";
import type { ExternalEvalDefinition } from "../src/evals/external-eval-definition.js";
import type { AgentBaseConfig } from "../src/config.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Minimal config for testing
function makeConfig(overrides: Partial<AgentBaseConfig> = {}): AgentBaseConfig {
  return {
    agentId: "test-agent",
    agentName: "Test Agent",
    memoryVariant: "native-0d",
    mode: "eval",
    farmDashboardUrl: "http://localhost:3847",
    reportIntervalMs: 5000,
    workspaceDir: "",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.30,
      cacheWritePerMillion: 3.75,
    },
    costCap: { perEvalRunUsd: 10, totalUsd: 100 },
    port: 0,
    contextTokensAvailable: 200_000,
    externalEvalDirs: [],
    ...overrides,
  };
}

// Mock monitor
function makeMockMonitor() {
  return {
    reset: vi.fn(),
    setEvalSummary: vi.fn(),
    getStatus: vi.fn(),
    getMessages: vi.fn(() => []),
    getMemoryGraph: vi.fn(() => ({ nodes: [], edges: [] })),
    getEvalSummary: vi.fn(() => ({ lastRun: null, variantBest: null })),
    recordMessageProcessed: vi.fn(),
    recordSessionEnd: vi.fn(),
    costTracker: {
      getState: vi.fn(() => ({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        estimatedUsd: 0,
      })),
      isOverEvalCap: vi.fn(() => false),
    },
  } as any;
}

// Mock reporter
function makeMockReporter() {
  return {
    reportEvalResult: vi.fn().mockResolvedValue(undefined),
    reportEvalProgress: vi.fn().mockResolvedValue(undefined),
  } as any;
}

/**
 * Set up env + fake openclawDir so preflight passes for tests that need to run the eval.
 * Returns the fake openclawDir path.
 */
async function setupPreflightEnv(tmpDir: string, evalId: string): Promise<{ openclawDir: string; evalDir: string }> {
  const openclawDir = path.join(tmpDir, "fake-openclaw");
  await fs.mkdir(openclawDir, { recursive: true });
  await fs.writeFile(path.join(openclawDir, "openclaw.mjs"), "// stub");

  const evalDir = path.join(tmpDir, `fake-${evalId}`);
  await fs.mkdir(evalDir, { recursive: true });

  // Ensure ANTHROPIC_API_KEY is set
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake-key-for-unit-tests";
  }

  return { openclawDir, evalDir };
}

describe("ExternalEvalRunner", () => {
  let tmpDir: string;
  let savedApiKey: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ext-eval-test-"));
    savedApiKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(async () => {
    // Restore env
    if (savedApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("starts and tracks running state", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "test-eval");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const runner = new ExternalEvalRunner(config, monitor, reporter);

    expect(runner.isRunning()).toBe(false);
    expect(runner.getCurrentRunId()).toBeNull();

    // Create a simple eval that just echoes and exits
    const evalDef: ExternalEvalDefinition = {
      id: "test-eval",
      name: "Test Eval",
      description: "test",
      category: "simulation",
      command: "echo",
      args: ["Day 1/5 Total Assets: $100"],
      defaultDays: 5,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+).*Total Assets: \$([0-9.,-]+)/,
      resultExtractor: async () => ({
        score: 100,
        maxScore: -1,
        taskResults: { totalAssets: 100 },
        costUsd: 0.5,
        durationMs: 1000,
      }),
    };

    const result = await runner.runExternalEval(evalDef);

    // After completion, should not be running
    expect(runner.isRunning()).toBe(false);
    expect(runner.getCurrentRunId()).toBeNull();

    // Result should reflect failed status since no transcript file exists
    expect(result.evalId).toBe("test-eval");
    expect(result.agentId).toBe("test-agent");
    expect(result.memoryVariant).toBe("native-0d");
    expect(result.status).toBe("failed"); // no transcript file

    // Monitor should have been updated
    expect(monitor.setEvalSummary).toHaveBeenCalled();
    // Reporter should have been called
    expect(reporter.reportEvalResult).toHaveBeenCalled();
  });

  it("parses progress from stdout", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "progress-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const runner = new ExternalEvalRunner(config, monitor, reporter);

    // Script that outputs progress lines with large day gap to trigger reporting
    const evalDef: ExternalEvalDefinition = {
      id: "progress-test",
      name: "Progress Test",
      description: "test",
      category: "simulation",
      command: "bash",
      args: ["-c", 'printf "Day 1/10 Total Assets: \\$500\\n"; printf "Day 10/10 Total Assets: \\$2500\\n"'],
      defaultDays: 10,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+).*Total Assets: \$([0-9.,-]+)/,
      resultExtractor: async () => ({
        score: 2500,
        maxScore: -1,
        taskResults: { totalAssets: 2500 },
        costUsd: 1.0,
        durationMs: 5000,
      }),
    };

    await runner.runExternalEval(evalDef);

    // Progress should have been reported at least for the first match (day 1, lastProgressReportDay starts at 0)
    expect(reporter.reportEvalProgress).toHaveBeenCalled();
  });

  it("handles subprocess failure", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "fail-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const runner = new ExternalEvalRunner(config, monitor, reporter);

    const evalDef: ExternalEvalDefinition = {
      id: "fail-test",
      name: "Fail Test",
      description: "test",
      category: "simulation",
      command: "bash",
      args: ["-c", "exit 1"],
      defaultDays: 5,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+)/,
      resultExtractor: async () => ({
        score: 0,
        maxScore: -1,
        taskResults: {},
        costUsd: 0,
        durationMs: 0,
      }),
    };

    const result = await runner.runExternalEval(evalDef);

    expect(result.status).toBe("failed");
    expect(runner.isRunning()).toBe(false);
  });

  it("extracts results from transcript file", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "transcript-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const runner = new ExternalEvalRunner(config, monitor, reporter);

    // We need to create a transcript file that the runner will find
    // The runner creates logDir at {workspaceDir}/eval-runs/{runId}/logs
    // We'll make the eval command create the transcript file
    const evalDef: ExternalEvalDefinition = {
      id: "transcript-test",
      name: "Transcript Test",
      description: "test",
      category: "simulation",
      command: "bash",
      args: [
        "-c",
        `echo '{"scoreBreakdown":{"totalAssets":3500,"bankBalance":2000,"machineCash":500},"cost":{"estimatedCostUsd":1.5},"durationMs":10000}' > {logDir}/run-001-transcript.json`,
      ],
      defaultDays: 5,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+)/,
      resultExtractor: async (transcriptPath: string) => {
        const raw = JSON.parse(await fs.readFile(transcriptPath, "utf-8"));
        return {
          score: raw.scoreBreakdown.totalAssets,
          maxScore: -1,
          taskResults: raw.scoreBreakdown,
          costUsd: raw.cost.estimatedCostUsd,
          durationMs: raw.durationMs,
        };
      },
    };

    const result = await runner.runExternalEval(evalDef);

    expect(result.status).toBe("completed");
    expect(result.score).toBe(3500);
    expect(result.costUsd).toBe(1.5);
    expect(result.taskResults).toEqual({
      totalAssets: 3500,
      bankBalance: 2000,
      machineCash: 500,
    });
  });

  it("rejects concurrent runs", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "slow-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const runner = new ExternalEvalRunner(config, monitor, reporter);

    const evalDef: ExternalEvalDefinition = {
      id: "slow-test",
      name: "Slow Test",
      description: "test",
      category: "simulation",
      command: "bash",
      args: ["-c", "sleep 2"],
      defaultDays: 5,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+)/,
      resultExtractor: async () => ({
        score: 0,
        maxScore: -1,
        taskResults: {},
        costUsd: 0,
        durationMs: 0,
      }),
    };

    // Start first run (don't await)
    const firstRun = runner.runExternalEval(evalDef);

    // Wait a tick for it to start
    await new Promise((r) => setTimeout(r, 50));
    expect(runner.isRunning()).toBe(true);

    // Second run should throw
    await expect(runner.runExternalEval(evalDef)).rejects.toThrow(
      "An external eval is already running",
    );

    // Wait for first to complete
    await firstRun;
  });

  describe("preflight", () => {
    it("fails when ANTHROPIC_API_KEY is not set", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const config = makeConfig({ workspaceDir: tmpDir });
      const runner = new ExternalEvalRunner(config, makeMockMonitor(), makeMockReporter());

      const evalDef: ExternalEvalDefinition = {
        id: "test",
        name: "Test",
        description: "test",
        category: "simulation",
        command: "echo",
        args: [],
        defaultDays: 5,
        maxScore: -1,
        progressPattern: /Day (\d+)\/(\d+)/,
        resultExtractor: async () => ({ score: 0, maxScore: -1, taskResults: {}, costUsd: 0, durationMs: 0 }),
      };

      const result = await runner.preflight(evalDef);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ANTHROPIC_API_KEY");
    });

    it("fails when openclawDir is missing", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      const config = makeConfig({ workspaceDir: tmpDir, openclawDir: undefined });
      const runner = new ExternalEvalRunner(config, makeMockMonitor(), makeMockReporter());

      const evalDef: ExternalEvalDefinition = {
        id: "test",
        name: "Test",
        description: "test",
        category: "simulation",
        command: "echo",
        args: [],
        defaultDays: 5,
        maxScore: -1,
        progressPattern: /Day (\d+)\/(\d+)/,
        resultExtractor: async () => ({ score: 0, maxScore: -1, taskResults: {}, costUsd: 0, durationMs: 0 }),
      };

      const result = await runner.preflight(evalDef);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("openclawDir");
    });

    it("passes when all requirements are met", async () => {
      const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "test");
      const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
      const runner = new ExternalEvalRunner(config, makeMockMonitor(), makeMockReporter());

      const evalDef: ExternalEvalDefinition = {
        id: "test",
        name: "Test",
        description: "test",
        category: "simulation",
        command: "echo",
        args: [],
        defaultDays: 5,
        maxScore: -1,
        progressPattern: /Day (\d+)\/(\d+)/,
        resultExtractor: async () => ({ score: 0, maxScore: -1, taskResults: {}, costUsd: 0, durationMs: 0 }),
      };

      const result = await runner.preflight(evalDef);
      expect(result.ok).toBe(true);
    });
  });
});
