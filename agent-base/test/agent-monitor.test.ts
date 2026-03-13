import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentMonitor } from "../src/monitoring/agent-monitor.js";

describe("AgentMonitor", () => {
  const baseConfig = {
    agentId: "test-agent",
    agentName: "test",
    memoryVariant: "native-0d",
    mode: "eval" as const,
    farmDashboardUrl: "http://localhost:3847",
    reportIntervalMs: 5000,
    workspaceDir: "/tmp/test",
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
    port: 0,
    contextTokensAvailable: 200_000,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts offline and transitions to online", () => {
    const monitor = new AgentMonitor(baseConfig);
    expect(monitor.getStatus().status).toBe("offline");

    monitor.start();
    expect(monitor.getStatus().status).toBe("online");
    monitor.stop();
  });

  it("tracks messages and sessions", () => {
    const monitor = new AgentMonitor(baseConfig);
    monitor.start();

    monitor.recordSessionStart();
    monitor.recordMessageProcessed();
    monitor.recordMessageProcessed();

    const status = monitor.getStatus();
    expect(status.messagesProcessed).toBe(2);
    expect(status.sessionsTotal).toBe(1);
    expect(status.sessionsActive).toBe(1);

    monitor.recordSessionEnd();
    expect(monitor.getStatus().sessionsActive).toBe(0);
    monitor.stop();
  });

  it("tracks token usage via cost tracker", () => {
    const monitor = new AgentMonitor(baseConfig);
    monitor.recordTokenUsage({ input: 5000, output: 2000, cacheRead: 1000, cacheWrite: 0 });

    const status = monitor.getStatus();
    expect(status.costInputTokens).toBe(5000);
    expect(status.costOutputTokens).toBe(2000);
    expect(status.costCacheReadTokens).toBe(1000);
    expect(status.costEstimatedUsd).toBeGreaterThan(0);
  });

  it("resets all state", () => {
    const monitor = new AgentMonitor(baseConfig);
    monitor.recordSessionStart();
    monitor.recordMessageProcessed();
    monitor.recordTokenUsage({ input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 });

    monitor.reset();

    const status = monitor.getStatus();
    expect(status.messagesProcessed).toBe(0);
    expect(status.sessionsTotal).toBe(0);
    expect(status.costInputTokens).toBe(0);
  });

  it("produces valid AgentStatus shape", () => {
    const monitor = new AgentMonitor(baseConfig);
    const status = monitor.getStatus();

    expect(status.id).toBe("test-agent");
    expect(status.name).toBe("test");
    expect(status.memoryVariant).toBe("native-0d");
    expect(status.mode).toBe("eval");
    expect(typeof status.lastHeartbeat).toBe("string");
    expect(Array.isArray(status.integrations)).toBe(true);
  });
});
