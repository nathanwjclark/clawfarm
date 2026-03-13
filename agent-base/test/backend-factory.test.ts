import { describe, it, expect } from "vitest";
import { createMemoryBackend } from "../src/memory/backend-factory.js";
import { NativeBackend } from "../src/memory/variants/native/backend.js";
import { FiveDayBackend } from "../src/memory/variants/five-day/backend.js";
import type { AgentBaseConfig } from "../src/config.js";

const baseConfig: AgentBaseConfig = {
  agentId: "test",
  agentName: "Test",
  memoryVariant: "native-0d",
  mode: "eval",
  farmDashboardUrl: "http://localhost:3847",
  reportIntervalMs: 5000,
  workspaceDir: "/tmp/test",
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  modelParams: {},
  pricing: {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  evalUseLlmSuppliers: true,
  costCap: { perEvalRunUsd: 10, totalUsd: 100 },
  port: 0,
  contextTokensAvailable: 200_000,
};

describe("createMemoryBackend", () => {
  it("creates NativeBackend for native-0d", () => {
    const backend = createMemoryBackend("native-0d", baseConfig);
    expect(backend).toBeInstanceOf(NativeBackend);
    expect(backend.variantId).toBe("native-0d");
    expect(backend.dimensionality).toBe("0D");
  });

  it("creates NativeBackend for native-0d-tuned", () => {
    const config = { ...baseConfig, memoryVariant: "native-0d-tuned" };
    const backend = createMemoryBackend("native-0d-tuned", config);
    expect(backend).toBeInstanceOf(NativeBackend);
  });

  it("creates FiveDayBackend for five-day-1d", () => {
    const config = { ...baseConfig, memoryVariant: "five-day-1d" };
    const backend = createMemoryBackend("five-day-1d", config);
    expect(backend).toBeInstanceOf(FiveDayBackend);
    expect(backend.dimensionality).toBe("1D");
  });

  it("creates FiveDayBackend for Cerebras-backed five-day variants", () => {
    for (const variant of [
      "five-day-1d-cerebras-glm47",
    ]) {
      const config = { ...baseConfig, memoryVariant: variant };
      const backend = createMemoryBackend(variant, config);
      expect(backend).toBeInstanceOf(FiveDayBackend);
    }
  });

  it("throws for unimplemented variants", () => {
    for (const variant of [
      "mem0-1d",
      "mem0-1d-aggressive",
      "cognee-2d",
      "graphiti-2d+",
      "diy-cron-1d",
      "learned-index",
    ]) {
      expect(() => createMemoryBackend(variant, baseConfig)).toThrow(
        `Memory variant "${variant}" not yet implemented`,
      );
    }
  });

  it("throws for unknown variants", () => {
    expect(() => createMemoryBackend("foo-bar", baseConfig)).toThrow(
      'Unknown memory variant: "foo-bar"',
    );
  });
});
