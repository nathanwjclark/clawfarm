import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NativeBackend } from "../src/memory/variants/native/backend.js";
import type { AgentBaseConfig } from "../src/config.js";

describe("NativeBackend", () => {
  let tmpDir: string;
  let config: AgentBaseConfig;
  let backend: NativeBackend;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "native-backend-test-"));
    config = {
      agentId: "test-agent",
      agentName: "Test Agent",
      memoryVariant: "native-0d",
      mode: "eval",
      farmDashboardUrl: "http://localhost:3847",
      reportIntervalMs: 5000,
      workspaceDir: tmpDir,
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      pricing: {
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheWritePerMillion: 3.75,
      },
      costCap: { perEvalRunUsd: 10, totalUsd: 100 },
      port: 0,
      contextTokensAvailable: 200_000,
    };
    backend = new NativeBackend(config);
    await backend.init(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("has correct variantId and dimensionality", () => {
    expect(backend.variantId).toBe("native-0d");
    expect(backend.dimensionality).toBe("0D");
  });

  it("recall injects stored memory and recent notes", async () => {
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      "# Memory\n\n## Preferences\n\nPrefers exact supplier names.",
    );
    await fs.writeFile(
      path.join(tmpDir, "memory", "2026-03-09.md"),
      "Confirmed supplier shortlist with QuickStock and Bay Area Wholesale.",
    );

    const result = await backend.recall([
      {
        id: "1",
        timestamp: new Date().toISOString(),
        role: "user",
        content: "What did we decide about QuickStock?",
        tokenCount: 10,
      },
    ]);

    expect(result).toContain("Stored Memory");
    expect(result).toContain("Recent Daily Notes");
    expect(result).toContain("QuickStock");
  });

  it("consolidate is a no-op", async () => {
    // Should not throw
    await backend.consolidate("hello", "world", []);
  });

  it("init creates memory directory", async () => {
    const stat = await fs.stat(path.join(tmpDir, "memory"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("captureSnapshot reads memory files", async () => {
    // Write some test memory files
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      "# Memory\n\n## Preferences\n\nLikes **cats**.",
    );
    await fs.writeFile(
      path.join(tmpDir, "memory", "notes.md"),
      "## Notes\n\nSome notes here.",
    );

    const snapshot = await backend.captureSnapshot();

    expect(snapshot.variantId).toBe("native-0d");
    expect(snapshot.files.length).toBe(2);
    expect(snapshot.stats.totalFiles).toBe(2);
    expect(snapshot.stats.totalChunks).toBeGreaterThan(0);
    expect(snapshot.stats.indexSizeBytes).toBeGreaterThan(0);

    // Should have a populated graph (not empty)
    expect(snapshot.graphState.nodes.length).toBeGreaterThan(0);
  });

  it("extractGraph parses markdown files into graph nodes", async () => {
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      '# Memory\n\n## Tools\n\nUses **TypeScript** and `vitest`.\n\n## Facts\n\n- The user prefers dark mode always\n- The user works on web applications',
    );

    const graph = await backend.extractGraph();

    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.type === "core")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "topic")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "entity")).toBe(true);
  });

  it("reset clears memory files", async () => {
    await fs.writeFile(
      path.join(tmpDir, "MEMORY.md"),
      "# Memory\n\nSome important stuff.",
    );
    await fs.writeFile(
      path.join(tmpDir, "memory", "notes.md"),
      "Some notes.",
    );

    await backend.reset();

    // MEMORY.md should be reset
    const memoryMd = await fs.readFile(
      path.join(tmpDir, "MEMORY.md"),
      "utf-8",
    );
    expect(memoryMd).toBe("# Memory\n");

    // memory/ dir should be empty
    const entries = await fs.readdir(path.join(tmpDir, "memory"));
    expect(entries.length).toBe(0);
  });

  it("generateOpenclawConfig produces config with workspace path", () => {
    const config = backend.generateOpenclawConfig("/some/workspace");
    const agents = config.agents as any;
    const memory = config.memory as any;
    expect(agents.defaults.workspace).toBe("/some/workspace");
    expect(agents.defaults.skipBootstrap).toBe(true);
    expect(agents.defaults.memorySearch.enabled).toBe(true);
    expect(memory.backend).toBe("external");
  });
});
