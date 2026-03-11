import fs from "node:fs/promises";
import path from "node:path";
import type { AgentBaseConfig } from "../../../config.js";
import type { AgentMemoryGraph, AgentMessage, MemorySnapshot } from "../../../types.js";
import type { MemoryBackend } from "../../memory-backend.js";
import {
  readAllowedMemory,
  searchAllowedMemory,
  type AllowedMemoryPath,
  writeAllowedMemory,
} from "../../backend-memory-store.js";
import { extractGraphFromFiles } from "../../graph-extractor.js";
import {
  buildQueryTerms,
  collectMatchingSnippets,
  formatRecallSection,
  listMarkdownFiles,
  listRecentDatedFiles,
  readOptionalFile,
  trimMarkdownForRecall,
} from "../../recall-utils.js";
import {
  FIVE_DAY_L1_FILES,
  FIVE_DAY_L1_TOKEN_BUDGETS,
  FIVE_DAY_TEMPLATE_DIRS,
  buildFiveDayTemplates,
  mergeFiveDayOverlay,
} from "./templates.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const ALLOWED_MEMORY_PATHS: AllowedMemoryPath[] = [
  { kind: "file", relPath: "MEMORY.md" },
  { kind: "dir", relPath: "memory" },
  { kind: "dir", relPath: "learnings" },
  { kind: "dir", relPath: "docs" },
];

export class FiveDayBackend implements MemoryBackend {
  readonly variantId: string;
  readonly dimensionality = "1D" as const;
  private workspaceDir = "";

  constructor(private config: AgentBaseConfig) {
    this.variantId = config.memoryVariant;
  }

  async composeEvalWorkspaceFiles(input: {
    identity?: string;
    workspaceFiles?: Record<string, string>;
  }): Promise<Record<string, string>> {
    const baseTemplates = buildFiveDayTemplates(this.config.agentName);
    const files: Record<string, string> = {};

    if (input.identity) {
      files["IDENTITY.md"] = input.identity;
    }

    for (const [filename, content] of Object.entries(input.workspaceFiles ?? {})) {
      switch (filename) {
        case "AGENTS.md":
          files[filename] = mergeFiveDayOverlay(
            baseTemplates["AGENTS.md"],
            content,
            "Eval Persona Overlay",
          );
          break;
        case "SOUL.md":
          files[filename] = mergeFiveDayOverlay(
            baseTemplates["SOUL.md"],
            content,
            "Eval Persona Overlay",
          );
          break;
        case "TOOLS.md":
          files[filename] = mergeFiveDayOverlay(
            baseTemplates["TOOLS.md"],
            content,
            "Eval Tool Overlay",
          );
          break;
        default:
          files[filename] = content;
      }
    }

    return files;
  }

  async init(workspaceDir: string): Promise<void> {
    this.workspaceDir = workspaceDir;
    for (const dir of FIVE_DAY_TEMPLATE_DIRS) {
      await fs.mkdir(path.join(workspaceDir, dir), { recursive: true });
    }

    const templates = buildFiveDayTemplates(this.config.agentName);
    for (const [filename, content] of Object.entries(templates)) {
      const fullPath = path.join(workspaceDir, filename);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    const openclawDir = path.join(workspaceDir, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    await fs.writeFile(
      path.join(openclawDir, "workspace-state.json"),
      JSON.stringify({
        version: 1,
        bootstrapSeededAt: new Date().toISOString(),
        onboardingCompletedAt: new Date().toISOString(),
      }),
    );

    await this.assertBudgets();
  }

  async searchMemory(input: {
    query: string;
    maxResults?: number;
    minScore?: number;
  }) {
    return searchAllowedMemory({
      workspaceDir: this.workspaceDir,
      allowed: ALLOWED_MEMORY_PATHS,
      ...input,
    });
  }

  async readMemory(input: {
    path: string;
    from?: number;
    lines?: number;
  }) {
    return readAllowedMemory({
      workspaceDir: this.workspaceDir,
      allowed: ALLOWED_MEMORY_PATHS,
      ...input,
    });
  }

  async writeMemory(input: {
    path: string;
    content: string;
    mode?: "append" | "replace";
  }) {
    return writeAllowedMemory({
      workspaceDir: this.workspaceDir,
      allowed: ALLOWED_MEMORY_PATHS,
      ...input,
    });
  }

  async recall(conversation: AgentMessage[]): Promise<string> {
    const sections: string[] = [];

    const memoryContent = await readOptionalFile(path.join(this.workspaceDir, "MEMORY.md"));
    if (memoryContent) {
      sections.push(
        formatRecallSection("Active Memory", [trimMarkdownForRecall(memoryContent, 1000)]),
      );
    }

    const learningsContent = await readOptionalFile(
      path.join(this.workspaceDir, "learnings", "LEARNINGS.md"),
    );
    if (learningsContent) {
      sections.push(
        formatRecallSection("Learned Rules", [trimMarkdownForRecall(learningsContent, 900)]),
      );
    }

    const recentDailyFiles = await listRecentDatedFiles(path.join(this.workspaceDir, "memory"), 2);
    if (recentDailyFiles.length > 0) {
      const recentLines: string[] = [];
      for (const filePath of recentDailyFiles) {
        const content = await readOptionalFile(filePath);
        if (!content) continue;
        recentLines.push(`### ${path.basename(filePath)}`);
        recentLines.push(trimMarkdownForRecall(content, 600));
      }
      sections.push(formatRecallSection("Recent Daily Notes", recentLines));
    }

    const queryTerms = buildQueryTerms(conversation);
    const searchableFiles = [
      ...(await listMarkdownFiles(path.join(this.workspaceDir, "memory"))),
      ...(await listMarkdownFiles(path.join(this.workspaceDir, "learnings"))),
      ...(await listMarkdownFiles(path.join(this.workspaceDir, "docs"))),
    ];
    const snippets = await collectMatchingSnippets(searchableFiles, queryTerms, 4);
    if (snippets.length > 0) {
      sections.push(
        formatRecallSection(
          "Relevant Retrieved Snippets",
          snippets.map((entry) => `- ${entry.file}: ${entry.snippet}`),
        ),
      );
    }

    return sections.filter(Boolean).join("\n\n");
  }

  async consolidate(
    _userMessage: string,
    _agentResponse: string,
    _conversation: AgentMessage[],
  ): Promise<void> {
    await this.assertBudgets();
  }

  async extractGraph(): Promise<AgentMemoryGraph> {
    const files = await this.readAllFiles();
    return extractGraphFromFiles(files);
  }

  async captureSnapshot(): Promise<MemorySnapshot> {
    const files = await this.readAllFiles();
    const graphState = extractGraphFromFiles(files);

    let totalChunks = 0;
    let indexSizeBytes = 0;
    for (const file of files) {
      totalChunks += file.content.split("\n---\n").length;
      indexSizeBytes += Buffer.byteLength(file.content, "utf-8");
    }

    return {
      variantId: this.variantId,
      files: files.map((file) => ({ path: file.path, content: file.content })),
      stats: {
        totalChunks,
        totalFiles: files.length,
        indexSizeBytes,
      },
      graphState,
    };
  }

  async reset(): Promise<void> {
    for (const dir of ["memory", "learnings", "docs"]) {
      const dirPath = path.join(this.workspaceDir, dir);
      try {
        const entries = await fs.readdir(dirPath);
        for (const entry of entries) {
          await fs.rm(path.join(dirPath, entry), { recursive: true, force: true });
        }
      } catch {}
    }
    await this.init(this.workspaceDir);
  }

  generateOpenclawConfig(workspaceDir: string): Record<string, unknown> {
    return {
      agents: {
        defaults: {
          workspace: workspaceDir,
          skipBootstrap: true,
          contextPruning: {
            mode: "cache-ttl",
            ttl: "6h",
            keepLastAssistants: 3,
          },
          compaction: {
            memoryFlush: {
              enabled: true,
              softThresholdTokens: 4000,
            },
          },
          memorySearch: {
            enabled: true,
          },
        },
      },
      memory: {
        backend: "external",
      },
    };
  }

  private async assertBudgets(): Promise<void> {
    for (const filename of FIVE_DAY_L1_FILES) {
      const fullPath = path.join(this.workspaceDir, filename);
      const content = await fs.readFile(fullPath, "utf-8");
      const estimated = estimateTokens(content);
      const budget = FIVE_DAY_L1_TOKEN_BUDGETS[filename];
      if (estimated > budget) {
        throw new Error(`[five-day] ${filename} exceeds token budget (${estimated} > ${budget})`);
      }
    }
  }

  private async readAllFiles(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    const roots = [...FIVE_DAY_L1_FILES, "learnings/LEARNINGS.md"];
    for (const entry of roots) {
      try {
        const content = await fs.readFile(path.join(this.workspaceDir, entry), "utf-8");
        files.push({ path: entry, content });
      } catch {}
    }

    for (const dir of ["memory", "docs"]) {
      try {
        const entries = await fs.readdir(path.join(this.workspaceDir, dir), {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const filePath = `${dir}/${entry.name}`;
          const content = await fs.readFile(path.join(this.workspaceDir, filePath), "utf-8");
          files.push({ path: filePath, content });
        }
      } catch {}
    }

    return files;
  }
}
