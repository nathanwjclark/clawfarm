import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FiveDayBackend } from "../src/memory/variants/five-day/backend.js";
import {
  FIVE_DAY_L1_FILES,
  FIVE_DAY_L1_TOKEN_BUDGETS,
} from "../src/memory/variants/five-day/templates.js";
import type { AgentBaseConfig } from "../src/config.js";

describe("FiveDayBackend", () => {
  let tmpDir: string;
  let backend: FiveDayBackend;

  const config: AgentBaseConfig = {
    agentId: "test-5day",
    agentName: "Test 5-Day Agent",
    memoryVariant: "five-day-1d",
    mode: "eval",
    farmDashboardUrl: "http://localhost:3847",
    reportIntervalMs: 5000,
    workspaceDir: "/tmp/test-5day",
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

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "five-day-test-"));
    backend = new FiveDayBackend({ ...config, workspaceDir: tmpDir });
    await backend.init(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates required workspace files and directories", async () => {
    for (const filename of FIVE_DAY_L1_FILES) {
      const stat = await fs.stat(path.join(tmpDir, filename));
      expect(stat.isFile()).toBe(true);
    }
    const learnings = await fs.readFile(path.join(tmpDir, "learnings", "LEARNINGS.md"), "utf-8");
    expect(learnings).toContain("LEARNINGS.md");
    expect((await fs.stat(path.join(tmpDir, "memory"))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(tmpDir, "docs"))).isDirectory()).toBe(true);
  });

  it("places boot instructions at the top of AGENTS.md", async () => {
    const agents = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agents.startsWith("# AGENTS.md\n\n## Boot Sequence")).toBe(true);
    expect(agents).toContain("Read learnings/LEARNINGS.md");
    expect(agents).toContain("Write a HANDOVER section");
  });

  it("recall injects active memory, learnings, and recent notes", async () => {
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      "# MEMORY.md\n\n## Active State\n\nWaiting on QuickStock delivery.",
    );
    await fs.writeFile(
      path.join(tmpDir, "learnings", "LEARNINGS.md"),
      "# LEARNINGS.md\n\n- Always follow up if a supplier misses promised delivery.",
    );
    await fs.writeFile(
      path.join(tmpDir, "memory", "2026-03-09.md"),
      "HANDOVER: QuickStock promised Day 4 delivery.",
    );

    const result = await backend.recall([
      {
        id: "1",
        timestamp: new Date().toISOString(),
        role: "user",
        content: "What was the handover on QuickStock?",
        tokenCount: 9,
      },
    ]);

    expect(result).toContain("Active Memory");
    expect(result).toContain("Learned Rules");
    expect(result).toContain("Recent Daily Notes");
    expect(result).toContain("QuickStock");
  });

  it("generates external memory + compaction config", () => {
    const generated = backend.generateOpenclawConfig(tmpDir) as any;
    expect(generated.memory.backend).toBe("external");
    expect(generated.agents.defaults.compaction.memoryFlush.softThresholdTokens).toBe(4000);
    expect(generated.agents.defaults.contextPruning.mode).toBe("cache-ttl");
    expect(generated.agents.defaults.contextPruning.keepLastAssistants).toBe(3);
  });

  it("composes eval overlays without dropping boot discipline", async () => {
    const files = await backend.composeEvalWorkspaceFiles({
      identity: "# IDENTITY.md\n\nEval identity",
      workspaceFiles: {
        "AGENTS.md": "Eval-specific instruction.",
        "SOUL.md": "Eval personality.",
        "TOOLS.md": "Eval tools.",
      },
    });

    expect(files["IDENTITY.md"]).toContain("Eval identity");
    expect(files["AGENTS.md"]).toContain("## Boot Sequence");
    expect(files["AGENTS.md"]).toContain("Eval-specific instruction.");
    expect(files["SOUL.md"]).toContain("Eval personality.");
    expect(files["TOOLS.md"]).toContain("Eval tools.");
  });

  it("keeps templates under configured token budgets", async () => {
    for (const filename of FIVE_DAY_L1_FILES) {
      const content = await fs.readFile(path.join(tmpDir, filename), "utf-8");
      expect(Math.ceil(content.length / 4)).toBeLessThanOrEqual(FIVE_DAY_L1_TOKEN_BUDGETS[filename]);
    }
  });

  it("routes in-turn search/read/write through the backend", async () => {
    await backend.writeMemory({
      path: "memory/2026-03-09.md",
      content: "QuickStock promised delivery by Day 4.",
      mode: "append",
    });

    const searchResults = await backend.searchMemory({
      query: "QuickStock delivery",
      maxResults: 3,
    });
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]?.path).toBe("memory/2026-03-09.md");

    const readResult = await backend.readMemory({
      path: "memory/2026-03-09.md",
    });
    expect(readResult.text).toContain("QuickStock promised delivery");
  });

  it("searches nested backend-owned memory paths", async () => {
    await backend.writeMemory({
      path: "docs/vendor-notes/quickstock.md",
      content: "QuickStock requires order confirmation by email.",
      mode: "replace",
    });

    const results = await backend.searchMemory({
      query: "order confirmation email",
      maxResults: 3,
    });

    expect(results.some((entry) => entry.path === "docs/vendor-notes/quickstock.md")).toBe(true);
  });

  it("resets mutable files and restores templates", async () => {
    await fs.writeFile(path.join(tmpDir, "memory", "2026-03-09.md"), "marker");
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# MEMORY.md\n\nChanged");

    await backend.reset();

    await expect(fs.readFile(path.join(tmpDir, "memory", "2026-03-09.md"), "utf-8")).rejects.toThrow();
    const memory = await fs.readFile(path.join(tmpDir, "MEMORY.md"), "utf-8");
    expect(memory).toContain("_No active items._");
  });
});
