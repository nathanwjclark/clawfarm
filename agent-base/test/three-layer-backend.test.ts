import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ThreeLayerBackend } from "../src/memory/variants/three-layer/backend.js";
import { L1_FILES, L1_TEMPLATES, L1_TOKEN_BUDGETS } from "../src/memory/variants/three-layer/templates.js";
import type { AgentBaseConfig } from "../src/config.js";

const baseConfig: AgentBaseConfig = {
  agentId: "test-3layer",
  agentName: "Test 3-Layer Agent",
  memoryVariant: "three-layer-1d",
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

describe("ThreeLayerBackend", () => {
  let tmpDir: string;
  let backend: ThreeLayerBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "three-layer-test-"));
    const config = { ...baseConfig, workspaceDir: tmpDir };
    backend = new ThreeLayerBackend(config);
    await backend.init(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("has correct variantId and dimensionality", () => {
    expect(backend.variantId).toBe("three-layer-1d");
    expect(backend.dimensionality).toBe("1D");
  });

  describe("init", () => {
    it("creates all 7 L1 files", async () => {
      for (const file of L1_FILES) {
        const stat = await fs.stat(path.join(tmpDir, file));
        expect(stat.isFile()).toBe(true);
      }
    });

    it("creates memory/ directory (L2)", async () => {
      const stat = await fs.stat(path.join(tmpDir, "memory"));
      expect(stat.isDirectory()).toBe(true);
    });

    it("creates reference/ directory (L3)", async () => {
      const stat = await fs.stat(path.join(tmpDir, "reference"));
      expect(stat.isDirectory()).toBe(true);
    });

    it("personalizes IDENTITY.md with agent name", async () => {
      const content = await fs.readFile(path.join(tmpDir, "IDENTITY.md"), "utf-8");
      expect(content).toContain("Test 3-Layer Agent");
      expect(content).not.toContain("three-layer-agent");
    });

    it("writes SOUL.md with memory protocol", async () => {
      const content = await fs.readFile(path.join(tmpDir, "SOUL.md"), "utf-8");
      expect(content).toContain("3-layer memory system");
      expect(content).toContain("L1 (Brain)");
      expect(content).toContain("L2 (Memory)");
      expect(content).toContain("L3 (Reference)");
    });

    it("writes AGENTS.md with routing rules", async () => {
      const content = await fs.readFile(path.join(tmpDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("Behavioral rules → AGENTS.md");
      expect(content).toContain("Tool commands → TOOLS.md");
      expect(content).toContain("memory/YYYY-MM-DD.md");
    });

    it("writes HEARTBEAT.md with standing tasks", async () => {
      const content = await fs.readFile(path.join(tmpDir, "HEARTBEAT.md"), "utf-8");
      expect(content).toContain("Standing Tasks");
      expect(content).toContain("search L2 memory");
    });
  });

  describe("recall", () => {
    it("returns structured memory context", async () => {
      await fs.writeFile(
        path.join(tmpDir, "MEMORY.md"),
        "# Memory\n\n## Active Work\n\nWorking with QuickStock delivery timing.",
      );
      await fs.writeFile(
        path.join(tmpDir, "memory", "2026-03-09.md"),
        "QuickStock promised delivery by Day 4.",
      );
      await fs.writeFile(
        path.join(tmpDir, "reference", "suppliers.md"),
        "# Suppliers\n\nQuickStock is the fastest supplier.",
      );

      const result = await backend.recall([
        {
          id: "1",
          timestamp: new Date().toISOString(),
          role: "user",
          content: "What do we know about QuickStock?",
          tokenCount: 8,
        },
      ]);

      expect(result).toContain("L1 Active State");
      expect(result).toContain("Recent L2 Notes");
      expect(result).toContain("QuickStock");
    });
  });

  describe("consolidate", () => {
    it("routes facts correctly with mocked LLM call", async () => {
      // Mock the consolidateWithLLM function
      const consolidator = await import("../src/memory/variants/three-layer/consolidator.js");
      const mockResult = {
        facts: [
          {
            content: "- User prefers dark mode",
            destination: { layer: "L1" as const, file: "USER.md" },
            action: "append" as const,
          },
          {
            content: "- Completed API refactor for v2 endpoints",
            destination: { layer: "L2" as const, file: "memory/2026-03-09.md" },
            action: "append" as const,
          },
          {
            content: "- REST API uses versioned endpoints → Deep dive: reference/api-design.md",
            destination: { layer: "L2" as const, file: "memory/api-design.md" },
            action: "append" as const,
          },
        ],
        trimSuggestions: [],
      };

      vi.spyOn(consolidator, "consolidateWithLLM").mockResolvedValue(mockResult);

      await backend.consolidate(
        "I prefer dark mode. Also we finished the API refactor.",
        "Got it! I've noted your dark mode preference.",
        [],
      );

      // Check L1 update
      const userMd = await fs.readFile(path.join(tmpDir, "USER.md"), "utf-8");
      expect(userMd).toContain("User prefers dark mode");

      // Check L2 daily note
      const dailyNote = await fs.readFile(
        path.join(tmpDir, "memory", "2026-03-09.md"),
        "utf-8",
      );
      expect(dailyNote).toContain("Completed API refactor");

      // Check L2 breadcrumb
      const breadcrumb = await fs.readFile(
        path.join(tmpDir, "memory", "api-design.md"),
        "utf-8",
      );
      expect(breadcrumb).toContain("REST API uses versioned endpoints");
      expect(breadcrumb).toContain("Deep dive: reference/api-design.md");

      vi.restoreAllMocks();
    });

    it("handles replace-section action", async () => {
      const consolidator = await import("../src/memory/variants/three-layer/consolidator.js");
      const mockResult = {
        facts: [
          {
            content: "Working on migration to PostgreSQL 16",
            destination: { layer: "L1" as const, file: "MEMORY.md" },
            action: "replace-section" as const,
            section: "Active Work",
          },
        ],
        trimSuggestions: [],
      };

      vi.spyOn(consolidator, "consolidateWithLLM").mockResolvedValue(mockResult);
      await backend.consolidate("Started the PG migration", "On it!", []);

      const memoryMd = await fs.readFile(path.join(tmpDir, "MEMORY.md"), "utf-8");
      expect(memoryMd).toContain("## Active Work");
      expect(memoryMd).toContain("Working on migration to PostgreSQL 16");

      vi.restoreAllMocks();
    });

    it("degrades gracefully on API failure", async () => {
      const consolidator = await import("../src/memory/variants/three-layer/consolidator.js");
      vi.spyOn(consolidator, "consolidateWithLLM").mockRejectedValue(
        new Error("API timeout"),
      );

      // Should not throw
      await backend.consolidate("hello", "world", []);

      // L1 files should be unchanged from templates
      const memoryMd = await fs.readFile(path.join(tmpDir, "MEMORY.md"), "utf-8");
      expect(memoryMd).toContain("_No active items._");

      vi.restoreAllMocks();
    });
  });

  describe("enforceL1Budget", () => {
    it("trims oversized L1 files and moves overflow to daily note", async () => {
      // Write a very large IDENTITY.md (budget is 500 tokens ≈ 2000 chars)
      const largeContent =
        "# IDENTITY.md\n\n" +
        Array.from({ length: 200 }, (_, i) => `- Line ${i}: ${"x".repeat(20)}`).join(
          "\n",
        );
      await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), largeContent);

      await backend.enforceL1Budget();

      // File should be smaller now
      const trimmed = await fs.readFile(path.join(tmpDir, "IDENTITY.md"), "utf-8");
      expect(trimmed.length).toBeLessThan(largeContent.length);

      // Daily note should have overflow
      const today = new Date().toISOString().split("T")[0];
      const dailyNote = await fs.readFile(
        path.join(tmpDir, "memory", `${today}.md`),
        "utf-8",
      );
      expect(dailyNote).toContain("Trimmed from IDENTITY.md");
    });

    it("does not trim files within budget", async () => {
      // Default templates should be within budget
      const soulContent = await fs.readFile(path.join(tmpDir, "SOUL.md"), "utf-8");

      await backend.enforceL1Budget();

      const afterTrim = await fs.readFile(path.join(tmpDir, "SOUL.md"), "utf-8");
      expect(afterTrim).toBe(soulContent);
    });
  });

  describe("breadcrumbs", () => {
    it("appends to breadcrumb files", async () => {
      const consolidator = await import("../src/memory/variants/three-layer/consolidator.js");
      const mockResult = {
        facts: [
          {
            content: "- TypeScript strict mode catches null errors → Deep dive: reference/typescript.md",
            destination: { layer: "L2" as const, file: "memory/typescript.md" },
            action: "append" as const,
          },
        ],
        trimSuggestions: [],
      };

      vi.spyOn(consolidator, "consolidateWithLLM").mockResolvedValue(mockResult);
      await backend.consolidate("TS tip", "response", []);

      const breadcrumb = await fs.readFile(
        path.join(tmpDir, "memory", "typescript.md"),
        "utf-8",
      );
      expect(breadcrumb).toContain("→ Deep dive: reference/typescript.md");

      vi.restoreAllMocks();
    });

    it("archives oldest entries when breadcrumb exceeds 4KB", async () => {
      // Pre-fill a breadcrumb file close to 4KB
      const breadcrumbPath = path.join(tmpDir, "memory", "big-topic.md");
      const lines = Array.from(
        { length: 80 },
        (_, i) => `- Fact ${i}: ${"info".repeat(10)} → Deep dive: reference/big-topic.md`,
      );
      await fs.writeFile(breadcrumbPath, lines.join("\n") + "\n");

      const consolidator = await import("../src/memory/variants/three-layer/consolidator.js");
      const mockResult = {
        facts: [
          {
            content: "- New fact that pushes over limit → Deep dive: reference/big-topic.md",
            destination: { layer: "L2" as const, file: "memory/big-topic.md" },
            action: "append" as const,
          },
        ],
        trimSuggestions: [],
      };

      vi.spyOn(consolidator, "consolidateWithLLM").mockResolvedValue(mockResult);
      await backend.consolidate("more info", "response", []);

      // Reference file should have been created with archived entries
      const refContent = await fs.readFile(
        path.join(tmpDir, "reference", "big-topic.md"),
        "utf-8",
      );
      expect(refContent).toContain("Fact 0");

      // Breadcrumb should still exist but be smaller
      const breadcrumbContent = await fs.readFile(breadcrumbPath, "utf-8");
      expect(Buffer.byteLength(breadcrumbContent, "utf-8")).toBeLessThanOrEqual(4096);

      vi.restoreAllMocks();
    });
  });

  describe("captureSnapshot", () => {
    it("captures all 3 layers", async () => {
      // Add some L2 and L3 content
      await fs.writeFile(
        path.join(tmpDir, "memory", "2026-03-09.md"),
        "## Session Notes\n\nDid some work.",
      );
      await fs.writeFile(
        path.join(tmpDir, "reference", "api-guide.md"),
        "# API Guide\n\nDetailed reference.",
      );

      const snapshot = await backend.captureSnapshot();

      expect(snapshot.variantId).toBe("three-layer-1d");
      // 7 L1 files + 1 L2 file + 1 L3 file = 9
      expect(snapshot.files.length).toBe(9);
      expect(snapshot.stats.totalFiles).toBe(9);
      expect(snapshot.stats.indexSizeBytes).toBeGreaterThan(0);
      expect(snapshot.graphState.nodes.length).toBeGreaterThan(0);

      // Check all layers are represented
      const paths = snapshot.files.map((f) => f.path);
      expect(paths).toContain("SOUL.md");
      expect(paths).toContain("MEMORY.md");
      expect(paths).toContain("memory/2026-03-09.md");
      expect(paths).toContain("reference/api-guide.md");
    });
  });

  describe("reset", () => {
    it("clears L2 and L3 contents", async () => {
      await fs.writeFile(
        path.join(tmpDir, "memory", "notes.md"),
        "Some notes.",
      );
      await fs.writeFile(
        path.join(tmpDir, "reference", "guide.md"),
        "Some guide.",
      );

      await backend.reset();

      const memoryEntries = await fs.readdir(path.join(tmpDir, "memory"));
      expect(memoryEntries.length).toBe(0);

      const refEntries = await fs.readdir(path.join(tmpDir, "reference"));
      expect(refEntries.length).toBe(0);
    });

    it("re-seeds L1 templates", async () => {
      // Modify an L1 file
      await fs.writeFile(
        path.join(tmpDir, "MEMORY.md"),
        "# Memory\n\n## Active\n\nLots of stuff here.",
      );

      await backend.reset();

      const memoryMd = await fs.readFile(
        path.join(tmpDir, "MEMORY.md"),
        "utf-8",
      );
      expect(memoryMd).toContain("_No active items._");
    });
  });

  describe("generateOpenclawConfig", () => {
    it("produces config with workspace path and memory search enabled", () => {
      const config = backend.generateOpenclawConfig("/some/workspace");
      const agents = config.agents as any;
      const memory = config.memory as any;
      expect(agents.defaults.workspace).toBe("/some/workspace");
      expect(agents.defaults.skipBootstrap).toBe(true);
      expect(agents.defaults.memorySearch.enabled).toBe(true);
      expect(agents.defaults.memorySearch.store.vector.enabled).toBe(false);
      expect(memory.backend).toBe("external");
    });
  });

  describe("extractGraph", () => {
    it("parses all 3 layers into graph nodes", async () => {
      await fs.writeFile(
        path.join(tmpDir, "memory", "2026-03-09.md"),
        "## Session\n\nWorked on **API refactor**.",
      );
      await fs.writeFile(
        path.join(tmpDir, "reference", "api-guide.md"),
        "## REST API\n\nUses `Express` framework.",
      );

      const graph = await backend.extractGraph();

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      // Should have nodes from all layers
      expect(graph.nodes.some((n) => n.type === "topic")).toBe(true);
      expect(graph.nodes.some((n) => n.type === "entity")).toBe(true);
    });
  });
});

describe("ThreeLayerBackend - consolidator integration", () => {
  it("consolidateWithLLM returns empty result when no API key", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

      const { consolidateWithLLM } = await import(
      "../src/memory/variants/three-layer/consolidator.js"
    );

    const result = await consolidateWithLLM(
      "hello",
      "world",
      { "MEMORY.md": "# Memory" },
      [],
      "2026-03-09",
    );

    expect(result.facts).toEqual([]);
    expect(result.trimSuggestions).toEqual([]);

    // Restore
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });
});

describe("three-layer-templates", () => {
  it("has templates for all 7 L1 files", () => {
    expect(L1_FILES.length).toBe(7);
    for (const file of L1_FILES) {
      expect(L1_TEMPLATES[file]).toBeDefined();
      expect(L1_TEMPLATES[file].length).toBeGreaterThan(0);
    }
  });

  it("has budgets for all L1 files", () => {
    for (const file of L1_FILES) {
      expect(L1_TOKEN_BUDGETS[file]).toBeGreaterThanOrEqual(500);
      expect(L1_TOKEN_BUDGETS[file]).toBeLessThanOrEqual(1000);
    }
  });

  it("total budget sums to TOTAL_L1_BUDGET or less", async () => {
    const { TOTAL_L1_BUDGET } = await import(
      "../src/memory/variants/three-layer/templates.js"
    );
    const sum = Object.values(L1_TOKEN_BUDGETS).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(TOTAL_L1_BUDGET);
  });

  it("templates are within their token budgets", () => {
    for (const file of L1_FILES) {
      const estimatedTokens = Math.ceil(L1_TEMPLATES[file].length / 4);
      expect(estimatedTokens).toBeLessThanOrEqual(L1_TOKEN_BUDGETS[file]);
    }
  });
});
