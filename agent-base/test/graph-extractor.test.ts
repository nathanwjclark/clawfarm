import { describe, it, expect } from "vitest";
import { extractGraphFromFiles } from "../src/memory/graph-extractor.js";

describe("extractGraphFromFiles", () => {
  it("creates a core node for MEMORY.md", () => {
    const graph = extractGraphFromFiles([
      { path: "MEMORY.md", content: "# Memory\n\nSome content here." },
    ]);
    const coreNode = graph.nodes.find((n) => n.type === "core");
    expect(coreNode).toBeDefined();
    expect(coreNode!.label).toBe("MEMORY");
  });

  it("creates a daily node for dated files", () => {
    const graph = extractGraphFromFiles([
      { path: "2026-03-08.md", content: "## Today\n\nDid some stuff." },
    ]);
    const dailyNode = graph.nodes.find((n) => n.type === "daily");
    expect(dailyNode).toBeDefined();
    expect(dailyNode!.label).toBe("2026-03-08");
  });

  it("creates topic nodes for non-dated, non-MEMORY files", () => {
    const graph = extractGraphFromFiles([
      { path: "preferences.md", content: "## Style\n\nPrefers dark mode." },
    ]);
    const fileNode = graph.nodes.find((n) => n.id.startsWith("file:"));
    expect(fileNode).toBeDefined();
    expect(fileNode!.type).toBe("topic");
  });

  it("extracts H2 headings as topic nodes with containment edges", () => {
    const graph = extractGraphFromFiles([
      {
        path: "MEMORY.md",
        content: "# Memory\n\n## User Preferences\n\nLikes cats.\n\n## Technical Notes\n\nUses TypeScript.",
      },
    ]);

    const topicNodes = graph.nodes.filter((n) => n.type === "topic");
    expect(topicNodes.length).toBe(2);
    expect(topicNodes.map((n) => n.label).sort()).toEqual([
      "Technical Notes",
      "User Preferences",
    ]);

    // Should have containment edges from file to topics
    const fileNode = graph.nodes.find((n) => n.type === "core");
    const containmentEdges = graph.edges.filter(
      (e) => e.source === fileNode!.id,
    );
    expect(containmentEdges.length).toBe(2);
  });

  it("extracts bold, backtick, and quoted entities", () => {
    const graph = extractGraphFromFiles([
      {
        path: "MEMORY.md",
        content: '## Tools\n\nUses **TypeScript** with `vitest` for "unit testing" purposes.',
      },
    ]);

    const entityNodes = graph.nodes.filter((n) => n.type === "entity");
    const labels = entityNodes.map((n) => n.label).sort();
    expect(labels).toContain("TypeScript");
    expect(labels).toContain("vitest");
    expect(labels).toContain("unit testing");
  });

  it("creates fact nodes from bullet-point lists", () => {
    const graph = extractGraphFromFiles([
      {
        path: "MEMORY.md",
        content:
          "## Preferences\n\n- User prefers dark mode for all editors\n- User likes to use vim keybindings\n- Short",
      },
    ]);

    const factNodes = graph.nodes.filter((n) => n.type === "fact");
    expect(factNodes.length).toBe(1);
    // "Short" line is <10 chars so shouldn't count, but the two longer ones should
    expect(factNodes[0].itemCount).toBe(2);
  });

  it("creates co-occurrence edges between entities in the same section", () => {
    const graph = extractGraphFromFiles([
      {
        path: "MEMORY.md",
        content: "## Stack\n\nUses **TypeScript** with **React** and **Node.js**.",
      },
    ]);

    // 3 entities → 3 co-occurrence edges (3 choose 2)
    const entityIds = graph.nodes
      .filter((n) => n.type === "entity")
      .map((n) => n.id);
    expect(entityIds.length).toBe(3);

    const coEdges = graph.edges.filter(
      (e) => entityIds.includes(e.source) && entityIds.includes(e.target),
    );
    expect(coEdges.length).toBe(3);
  });

  it("returns empty graph for empty input", () => {
    const graph = extractGraphFromFiles([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("handles multiple files", () => {
    const graph = extractGraphFromFiles([
      { path: "MEMORY.md", content: "# Memory\n\n## Core\n\nMain context." },
      {
        path: "2026-03-08.md",
        content: "## Session 1\n\nDiscussed **React**.",
      },
      {
        path: "debugging.md",
        content: "## Tips\n\nUse `console.log` for quick debugging.",
      },
    ]);

    const fileNodes = graph.nodes.filter((n) => n.id.startsWith("file:"));
    expect(fileNodes.length).toBe(3);

    // Should have at least one node of each classification type
    expect(graph.nodes.some((n) => n.type === "core")).toBe(true);
    expect(graph.nodes.some((n) => n.type === "daily")).toBe(true);
  });

  it("computes sizes using log2 formula", () => {
    const graph = extractGraphFromFiles([
      {
        path: "MEMORY.md",
        content: "# Memory\n\n" + "x".repeat(1000),
      },
    ]);

    const coreNode = graph.nodes.find((n) => n.type === "core");
    expect(coreNode!.size).toBeGreaterThan(10);
    expect(coreNode!.size).toBeLessThanOrEqual(80);
  });
});
