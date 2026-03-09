import type { AgentMemoryGraph, MemoryGraphNode, MemoryGraphEdge } from "../types.js";

/**
 * Parses openclaw's markdown memory files into an AgentMemoryGraph.
 *
 * Node types:
 * - core: MEMORY.md
 * - daily: Dated files (YYYY-MM-DD pattern)
 * - topic: Topic files (other .md) or H2 headings within files
 * - entity: Bold/backtick/quoted terms
 * - fact: Declarative statements (lines starting with "- ")
 *
 * Edges:
 * - containment: file → topic (H2 heading in that file)
 * - mention: topic → entity (entity appears under that heading)
 * - co-occurrence: entity ↔ entity (appear in same section)
 */

interface MemoryFile {
  path: string;
  content: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/** Extract bold, backtick, and quoted terms from text */
function extractEntities(text: string): string[] {
  const entities = new Set<string>();

  // **bold** terms
  for (const match of text.matchAll(/\*\*([^*]+)\*\*/g)) {
    entities.add(match[1].trim());
  }

  // `backtick` terms
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    entities.add(match[1].trim());
  }

  // "quoted" terms (double quotes, at least 2 chars)
  for (const match of text.matchAll(/"([^"]{2,})"/g)) {
    entities.add(match[1].trim());
  }

  return [...entities];
}

/** Compute visual size: clamp(log2(charCount + 1) * 8, 10, 80) */
function computeSize(charCount: number): number {
  return Math.min(80, Math.max(10, Math.log2(charCount + 1) * 8));
}

/** Classify a file path into a node type */
function classifyFile(filePath: string): "core" | "daily" | "topic" {
  const name = filePath.replace(/\.md$/i, "");
  if (name === "MEMORY") return "core";
  if (DATE_PATTERN.test(name)) return "daily";
  return "topic";
}

/** Sanitize a string into a graph node ID */
function toNodeId(prefix: string, label: string): string {
  return `${prefix}:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/**
 * Parse a set of memory files into an AgentMemoryGraph.
 */
export function extractGraphFromFiles(files: MemoryFile[]): AgentMemoryGraph {
  const nodes = new Map<string, MemoryGraphNode>();
  const edgeSet = new Map<string, MemoryGraphEdge>();

  function addNode(id: string, label: string, type: MemoryGraphNode["type"], charCount: number): void {
    const existing = nodes.get(id);
    if (existing) {
      // Merge: increase size and item count
      existing.size = computeSize(charCount);
      existing.itemCount += 1;
    } else {
      nodes.set(id, {
        id,
        label,
        type,
        size: computeSize(charCount),
        itemCount: 1,
      });
    }
  }

  function addEdge(source: string, target: string, weight: number = 1): void {
    if (source === target) return;
    const key = `${source}→${target}`;
    const reverseKey = `${target}→${source}`;
    if (edgeSet.has(key)) {
      edgeSet.get(key)!.weight += weight;
    } else if (edgeSet.has(reverseKey)) {
      edgeSet.get(reverseKey)!.weight += weight;
    } else {
      edgeSet.set(key, { source, target, weight });
    }
  }

  for (const file of files) {
    const fileType = classifyFile(file.path);
    const fileLabel = file.path.replace(/\.md$/i, "");
    const fileId = toNodeId("file", fileLabel);

    // Add file node
    addNode(fileId, fileLabel, fileType, file.content.length);

    // Split into sections by H2 headings
    const sections = splitByH2(file.content);

    for (const section of sections) {
      // Add topic node for each H2 heading
      if (section.heading) {
        const topicId = toNodeId("topic", section.heading);
        addNode(topicId, section.heading, "topic", section.body.length);
        addEdge(fileId, topicId); // containment

        // Extract entities from the section body
        const entities = extractEntities(section.body);
        for (const entity of entities) {
          const entityId = toNodeId("entity", entity);
          addNode(entityId, entity, "entity", entity.length);
          addEdge(topicId, entityId); // mention
        }

        // Co-occurrence edges between entities in the same section
        for (let i = 0; i < entities.length; i++) {
          for (let j = i + 1; j < entities.length; j++) {
            addEdge(
              toNodeId("entity", entities[i]),
              toNodeId("entity", entities[j]),
              0.5,
            );
          }
        }

        // Count fact nodes (lines starting with "- ")
        const facts = section.body
          .split("\n")
          .filter((line) => /^- .{10,}/.test(line.trim()));
        if (facts.length > 0) {
          const factId = toNodeId("facts", `${section.heading}-facts`);
          addNode(factId, `${section.heading} facts`, "fact", facts.join("\n").length);
          nodes.get(factId)!.itemCount = facts.length;
          addEdge(topicId, factId);
        }
      } else {
        // Top-level content without a heading — extract entities directly under file
        const entities = extractEntities(section.body);
        for (const entity of entities) {
          const entityId = toNodeId("entity", entity);
          addNode(entityId, entity, "entity", entity.length);
          addEdge(fileId, entityId);
        }
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edgeSet.values()],
  };
}

interface Section {
  heading: string | null;
  body: string;
}

/** Split markdown content into sections by H2 (##) headings */
function splitByH2(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      // Save previous section
      if (currentLines.length > 0 || currentHeading !== null) {
        sections.push({
          heading: currentHeading,
          body: currentLines.join("\n"),
        });
      }
      currentHeading = h2Match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentLines.length > 0 || currentHeading !== null) {
    sections.push({
      heading: currentHeading,
      body: currentLines.join("\n"),
    });
  }

  return sections;
}
