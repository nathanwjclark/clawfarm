import fs from "node:fs/promises";
import path from "node:path";
import type { AgentBaseConfig } from "../config.js";
import type { AgentMemoryGraph, AgentMessage, MemorySnapshot } from "../types.js";
import type { MemoryBackend } from "./memory-backend.js";
import { extractGraphFromFiles } from "./graph-extractor.js";

/**
 * Native 0D memory backend.
 * Openclaw handles memory natively — agent reads/writes MEMORY.md and memory/ files.
 * This backend is essentially a passthrough that provides graph extraction and snapshot capture.
 */
export class NativeBackend implements MemoryBackend {
  readonly variantId: string;
  readonly dimensionality = "0D" as const;
  private workspaceDir: string = "";

  constructor(private config: AgentBaseConfig) {
    this.variantId = config.memoryVariant;
  }

  async init(workspaceDir: string): Promise<void> {
    this.workspaceDir = workspaceDir;
    // Ensure memory directory exists
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  }

  /**
   * No-op: openclaw loads MEMORY.md natively via its own context injection.
   */
  async recall(_conversation: AgentMessage[]): Promise<string> {
    return "";
  }

  /**
   * No-op: the openclaw agent writes to memory files via its own tools.
   */
  async consolidate(
    _userMessage: string,
    _agentResponse: string,
    _conversation: AgentMessage[],
  ): Promise<void> {
    // Native backend relies on openclaw's built-in memory management
  }

  async extractGraph(): Promise<AgentMemoryGraph> {
    const files = await this.readMemoryFiles();
    return extractGraphFromFiles(files);
  }

  async captureSnapshot(): Promise<MemorySnapshot> {
    const files = await this.readMemoryFiles();
    const graphState = extractGraphFromFiles(files);

    let totalChunks = 0;
    let indexSizeBytes = 0;

    for (const file of files) {
      totalChunks += file.content.split("\n---\n").length;
      indexSizeBytes += Buffer.byteLength(file.content, "utf-8");
    }

    return {
      variantId: this.variantId,
      files: files.map((f) => ({ path: f.path, content: f.content })),
      stats: {
        totalChunks,
        totalFiles: files.length,
        indexSizeBytes,
      },
      graphState,
    };
  }

  async reset(): Promise<void> {
    const memoryDir = path.join(this.workspaceDir, "memory");

    // Clear memory directory contents
    try {
      const entries = await fs.readdir(memoryDir);
      for (const entry of entries) {
        await fs.rm(path.join(memoryDir, entry), { recursive: true });
      }
    } catch {
      // memory dir may not exist
    }

    // Reset MEMORY.md to empty
    const memoryMdPath = path.join(this.workspaceDir, "MEMORY.md");
    try {
      await fs.writeFile(memoryMdPath, "# Memory\n");
    } catch {
      // workspace may not exist yet
    }
  }

  generateOpenclawConfig(workspaceDir: string): Record<string, unknown> {
    // Standard config with native memory enabled.
    // Disable vector embeddings to avoid downloading models or needing API keys.
    // Memory search falls back to FTS-only mode.
    return {
      agents: {
        defaults: {
          workspace: workspaceDir,
          skipBootstrap: true,
          memorySearch: {
            enabled: true,
            provider: "local",
            fallback: "none",
            store: {
              vector: { enabled: false },
            },
          },
        },
      },
    };
  }

  /** Read all memory files from the workspace (memory/ dir + MEMORY.md) */
  private async readMemoryFiles(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    const memoryDir = path.join(this.workspaceDir, "memory");

    // Read memory/ directory
    try {
      const entries = await fs.readdir(memoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(memoryDir, entry.name);
        const content = await fs.readFile(filePath, "utf-8");
        files.push({ path: `memory/${entry.name}`, content });
      }
    } catch {
      // memory dir may not exist yet
    }

    // Read MEMORY.md from workspace root
    try {
      const content = await fs.readFile(
        path.join(this.workspaceDir, "MEMORY.md"),
        "utf-8",
      );
      files.push({ path: "MEMORY.md", content });
    } catch {
      // no MEMORY.md
    }

    return files;
  }
}
