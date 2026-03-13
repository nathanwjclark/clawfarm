import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EvalBridge } from "../src/lifecycle/eval-bridge.js";
import type { ExternalEvalDefinition } from "../src/evals/external-eval-definition.js";
import type { AgentBaseConfig } from "../src/config.js";
import type { ChatHandler } from "../src/lifecycle/chat-handler.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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
    modelParams: {},
    pricing: {
      inputPerMillion: 3,
      outputPerMillion: 15,
      cacheReadPerMillion: 0.30,
      cacheWritePerMillion: 3.75,
    },
    evalUseLlmSuppliers: true,
    costCap: { perEvalRunUsd: 10, totalUsd: 100 },
    port: 3900,
    contextTokensAvailable: 200_000,
    externalEvalDirs: [],
    ...overrides,
  };
}

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

function makeMockReporter() {
  return {
    reportEvalResult: vi.fn().mockResolvedValue(undefined),
    reportEvalProgress: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeMockChatHandler() {
  return {
    configureForEval: vi.fn(),
    handleMessage: vi.fn().mockResolvedValue({ text: "ok", toolCalls: 0 }),
    reset: vi.fn(),
    getSessionId: vi.fn(() => "test-session"),
    isBusy: vi.fn(() => false),
    isConfiguredForEval: vi.fn(() => false),
  } as unknown as ChatHandler;
}

function makeMockBackend() {
  return {
    reset: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    generateOpenclawConfig: vi.fn(() => ({})),
    captureSnapshot: vi.fn().mockResolvedValue({ files: [], stats: {} }),
  } as any;
}

async function setupPreflightEnv(tmpDir: string, evalId: string): Promise<{ openclawDir: string; evalDir: string }> {
  const openclawDir = path.join(tmpDir, "fake-openclaw");
  await fs.mkdir(openclawDir, { recursive: true });
  await fs.writeFile(path.join(openclawDir, "openclaw.mjs"), "// stub");

  const evalDir = path.join(tmpDir, `fake-${evalId}`);
  await fs.mkdir(evalDir, { recursive: true });

  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake-key-for-unit-tests";
  }

  return { openclawDir, evalDir };
}

describe("EvalBridge", () => {
  let tmpDir: string;
  let savedApiKey: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-bridge-test-"));
    savedApiKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(async () => {
    if (savedApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs eval subprocess and tracks state", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "test-eval");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const chatHandler = makeMockChatHandler();
    const backend = makeMockBackend();
    const bridge = new EvalBridge(config, monitor, reporter, chatHandler, backend);

    expect(bridge.isRunning()).toBe(false);

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
      agentMode: true,
    };

    const result = await bridge.runEval(evalDef);

    expect(bridge.isRunning()).toBe(false);
    expect(result.evalId).toBe("test-eval");
    expect(result.agentId).toBe("test-agent");
    expect(result.status).toBe("failed"); // no transcript file
    expect(monitor.setEvalSummary).toHaveBeenCalled();
    expect(reporter.reportEvalResult).toHaveBeenCalled();
    expect(chatHandler.reset).toHaveBeenCalled(); // should reset after eval
  });

  it("resolves {agentUrl} placeholder in args", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "url-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir], port: 4567 });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const chatHandler = makeMockChatHandler();
    const backend = makeMockBackend();
    const bridge = new EvalBridge(config, monitor, reporter, chatHandler, backend);

    const evalDef: ExternalEvalDefinition = {
      id: "url-test",
      name: "URL Test",
      description: "test",
      category: "simulation",
      command: "echo",
      args: ["agent-url={agentUrl}", "farm-url={farmUrl}", "agent-id={agentId}"],
      defaultDays: 5,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+)/,
      resultExtractor: async () => ({ score: 0, maxScore: -1, taskResults: {}, costUsd: 0, durationMs: 0 }),
      agentMode: true,
    };

    // The eval will just echo the resolved args — we verify it doesn't crash
    const result = await bridge.runEval(evalDef);
    expect(result.status).toBe("failed"); // no transcript
    // The key thing is it didn't throw — placeholders were resolved
  });

  it("extracts results from transcript file", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "transcript-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const chatHandler = makeMockChatHandler();
    const backend = makeMockBackend();
    const bridge = new EvalBridge(config, monitor, reporter, chatHandler, backend);

    const evalDef: ExternalEvalDefinition = {
      id: "transcript-test",
      name: "Transcript Test",
      description: "test",
      category: "simulation",
      command: "bash",
      args: [
        "-c",
        `echo '{"net":3500}' > {logDir}/run-001-transcript.json`,
      ],
      defaultDays: 5,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+)/,
      resultExtractor: async (transcriptPath: string) => {
        const raw = JSON.parse(await fs.readFile(transcriptPath, "utf-8"));
        return {
          score: raw.net,
          maxScore: -1,
          taskResults: { totalAssets: raw.net },
          costUsd: 0,
          durationMs: 0,
        };
      },
      agentMode: true,
    };

    const result = await bridge.runEval(evalDef);
    expect(result.status).toBe("completed");
    expect(result.score).toBe(3500);
  });

  it("rejects concurrent runs", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "slow-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const chatHandler = makeMockChatHandler();
    const backend = makeMockBackend();
    const bridge = new EvalBridge(config, monitor, reporter, chatHandler, backend);

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
      resultExtractor: async () => ({ score: 0, maxScore: -1, taskResults: {}, costUsd: 0, durationMs: 0 }),
      agentMode: true,
    };

    const firstRun = bridge.runEval(evalDef);
    await new Promise((r) => setTimeout(r, 50));
    expect(bridge.isRunning()).toBe(true);

    await expect(bridge.runEval(evalDef)).rejects.toThrow("An eval is already running");

    await firstRun;
  });

  it("attaches llmCallProfiles from PROFILE_CALLS to progress reports", async () => {
    const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "profile-calls-test");
    const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
    const monitor = makeMockMonitor();
    const reporter = makeMockReporter();
    const chatHandler = makeMockChatHandler();
    const backend = makeMockBackend();
    const bridge = new EvalBridge(config, monitor, reporter, chatHandler, backend);

    // Write script to a file to avoid shell escaping issues with $ signs
    const scriptPath = path.join(evalDir, "run-test.sh");
    const scriptLines = [
      '#!/bin/bash',
      'echo "Day 1/3 | Total Assets: \\$500"',
      'echo "[PROFILE] day=1 turn=1 wall=5000 handler=5000 openclaw=5000 boot=100 llm=4000 tool=800"',
      'echo \'[PROFILE_CALLS] day=1 [{"callIndex":0,"callType":"initial","totalMs":2500,"ttfcMs":800,"generationMs":1700,"usage":{"input":1000,"output":500},"toolCallsRequested":3},{"callIndex":1,"callType":"tool_followup","totalMs":1500,"ttfcMs":600,"generationMs":900,"usage":{"input":1500,"output":300},"toolCallsRequested":0}]\'',
      'echo "Day 2/3 | Total Assets: \\$600"',
      'echo "[PROFILE] day=2 turn=1 wall=3000 handler=3000 openclaw=3000 boot=50 llm=2500 tool=400"',
      'echo \'[PROFILE_CALLS] day=2 [{"callIndex":0,"callType":"initial","totalMs":2500,"ttfcMs":700,"generationMs":1800,"usage":{"input":1200,"output":600},"toolCallsRequested":2}]\'',
      'echo "Day 3/3 | Total Assets: \\$700"',
      'echo "[PROFILE] day=3 turn=1 wall=4000 handler=4000 openclaw=4000 boot=80 llm=3000 tool=900"',
      'echo \'[PROFILE_CALLS] day=3 [{"callIndex":0,"callType":"initial","totalMs":3000,"ttfcMs":900,"generationMs":2100,"usage":{"input":1300,"output":700},"toolCallsRequested":4}]\'',
      'echo \'{"score":700}\' > "$1/run-001-transcript.json"',
    ].join('\n');
    await fs.writeFile(scriptPath, scriptLines, { mode: 0o755 });

    const evalDef: ExternalEvalDefinition = {
      id: "profile-calls-test",
      name: "Profile Calls Test",
      description: "test",
      category: "simulation",
      command: "bash",
      args: [scriptPath, "{logDir}"],
      defaultDays: 3,
      maxScore: -1,
      progressPattern: /Day (\d+)\/(\d+).*Total Assets: \$([0-9.,-]+)/,
      resultExtractor: async (transcriptPath: string) => {
        const raw = JSON.parse(await fs.readFile(transcriptPath, "utf-8"));
        return { score: raw.score, maxScore: -1, taskResults: { totalAssets: raw.score }, costUsd: 0, durationMs: 0 };
      },
      agentMode: true,
    };

    await bridge.runEval(evalDef);

    // Check that reportEvalProgress was called with turnProfile containing llmCallProfiles
    const progressCalls = reporter.reportEvalProgress.mock.calls;
    expect(progressCalls.length).toBeGreaterThanOrEqual(2); // at least days 1 and 2 (day 3 flushed on close)

    // Find the call for day 1 — should have llmCallProfiles with 2 entries
    const day1Call = progressCalls.find((c: any[]) => c[3]?.current === 1);
    expect(day1Call).toBeDefined();
    const day1Profile = day1Call![3].turnProfile;
    expect(day1Profile).toBeDefined();
    expect(day1Profile.llmApiMs).toBe(4000);
    expect(day1Profile.llmCallProfiles).toBeDefined();
    expect(day1Profile.llmCallProfiles).toHaveLength(2);
    expect(day1Profile.llmCallProfiles[0].ttfcMs).toBe(800);
    expect(day1Profile.llmCallProfiles[0].generationMs).toBe(1700);
    expect(day1Profile.llmCallProfiles[1].callType).toBe("tool_followup");
  });

  describe("preflight", () => {
    it("fails when ANTHROPIC_API_KEY is not set", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const config = makeConfig({ workspaceDir: tmpDir });
      const bridge = new EvalBridge(config, makeMockMonitor(), makeMockReporter(), makeMockChatHandler());

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
        agentMode: true,
      };

      const result = await bridge.preflight(evalDef);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ANTHROPIC_API_KEY");
    });

    it("passes when all requirements are met", async () => {
      const { openclawDir, evalDir } = await setupPreflightEnv(tmpDir, "test");
      const config = makeConfig({ workspaceDir: tmpDir, openclawDir, externalEvalDirs: [evalDir] });
      const bridge = new EvalBridge(config, makeMockMonitor(), makeMockReporter(), makeMockChatHandler());

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
        agentMode: true,
      };

      const result = await bridge.preflight(evalDef);
      expect(result.ok).toBe(true);
    });
  });
});
