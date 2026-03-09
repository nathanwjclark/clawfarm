import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryBackend } from "../memory/memory-backend.js";
import type { MemorySnapshot, AgentMemoryGraph } from "../types.js";

/**
 * Captures a snapshot of the agent's workspace memory state after an eval run.
 * When a MemoryBackend is provided, delegates to it for richer snapshot capture.
 */
export async function captureMemorySnapshot(
  workspaceDir: string,
  variantId: string,
  backend?: MemoryBackend,
): Promise<MemorySnapshot> {
  // Delegate to backend if available
  if (backend) {
    return backend.captureSnapshot();
  }

  const memoryDir = path.join(workspaceDir, "memory");
  const files: Array<{ path: string; content: string }> = [];
  let totalChunks = 0;
  let indexSizeBytes = 0;

  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(memoryDir, entry.name);
      const content = await fs.readFile(filePath, "utf-8");
      files.push({ path: entry.name, content });
      totalChunks += content.split("\n---\n").length;
      const stat = await fs.stat(filePath);
      indexSizeBytes += stat.size;
    }
  } catch {
    // memory dir may not exist yet
  }

  // Also capture MEMORY.md if it exists at workspace root
  try {
    const memoryMd = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf-8");
    files.push({ path: "MEMORY.md", content: memoryMd });
    totalChunks += memoryMd.split("\n---\n").length;
  } catch {
    // no MEMORY.md
  }

  const graphState: AgentMemoryGraph = { nodes: [], edges: [] };

  return {
    variantId,
    files,
    stats: {
      totalChunks,
      totalFiles: files.length,
      indexSizeBytes,
    },
    graphState,
  };
}
