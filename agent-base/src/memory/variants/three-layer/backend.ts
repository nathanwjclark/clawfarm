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
import { L1_FILES, L1_TEMPLATES, L1_TOKEN_BUDGETS } from "./templates.js";
import {
  consolidateWithLLM,
  type ExtractedFact,
  type TrimSuggestion,
} from "./consolidator.js";

const BREADCRUMB_MAX_BYTES = 4096;
const ALLOWED_MEMORY_PATHS: AllowedMemoryPath[] = [
  { kind: "file", relPath: "AGENTS.md" },
  { kind: "file", relPath: "SOUL.md" },
  { kind: "file", relPath: "TOOLS.md" },
  { kind: "file", relPath: "IDENTITY.md" },
  { kind: "file", relPath: "USER.md" },
  { kind: "file", relPath: "HEARTBEAT.md" },
  { kind: "file", relPath: "MEMORY.md" },
  { kind: "dir", relPath: "memory" },
  { kind: "dir", relPath: "reference" },
];

function mergeVariantFile(baseContent: string, overlayContent: string, label: string): string {
  const trimmedBase = baseContent.trimEnd();
  const trimmedOverlay = overlayContent.trim();
  if (!trimmedOverlay) {
    return `${trimmedBase}\n`;
  }
  return `${trimmedBase}\n\n## ${label}\n\n${trimmedOverlay}\n`;
}

/**
 * 3-Layer memory backend (1D).
 *
 * L1: 7 root workspace files (always loaded by OpenClaw)
 * L2: memory/ directory (semantically searched)
 * L3: reference/ directory (opened on demand)
 *
 * The core value is write discipline: after every turn, an LLM extracts
 * facts and routes them to the correct layer/file.
 */
export class ThreeLayerBackend implements MemoryBackend {
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
    const files: Record<string, string> = {};
    if (input.identity) {
      files["IDENTITY.md"] = input.identity;
    }
    for (const [filename, content] of Object.entries(input.workspaceFiles ?? {})) {
      switch (filename) {
        case "AGENTS.md":
          files[filename] = mergeVariantFile(L1_TEMPLATES["AGENTS.md"], content, "Eval Persona Overlay");
          break;
        case "SOUL.md":
          files[filename] = mergeVariantFile(L1_TEMPLATES["SOUL.md"], content, "Eval Persona Overlay");
          break;
        case "TOOLS.md":
          files[filename] = mergeVariantFile(L1_TEMPLATES["TOOLS.md"], content, "Eval Tool Overlay");
          break;
        default:
          files[filename] = content;
      }
    }
    return files;
  }

  async init(workspaceDir: string): Promise<void> {
    this.workspaceDir = workspaceDir;

    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "reference"), { recursive: true });

    for (const file of L1_FILES) {
      let content = L1_TEMPLATES[file];
      if (file === "IDENTITY.md") {
        content = content.replace("three-layer-agent", this.config.agentName);
      }
      await fs.writeFile(path.join(workspaceDir, file), content);
    }

    const openclawDir = path.join(workspaceDir, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    const statePath = path.join(openclawDir, "workspace-state.json");
    await fs.writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        bootstrapSeededAt: new Date().toISOString(),
        onboardingCompletedAt: new Date().toISOString(),
      }),
    ).catch(() => {});
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

    const activeMemory = await readOptionalFile(path.join(this.workspaceDir, "MEMORY.md"));
    if (activeMemory) {
      sections.push(
        formatRecallSection("L1 Active State", [trimMarkdownForRecall(activeMemory, 900)]),
      );
    }

    const agentsRules = await readOptionalFile(path.join(this.workspaceDir, "AGENTS.md"));
    if (agentsRules) {
      sections.push(
        formatRecallSection("L1 Rules", [trimMarkdownForRecall(agentsRules, 900)]),
      );
    }

    const recentDailyFiles = await listRecentDatedFiles(path.join(this.workspaceDir, "memory"), 2);
    if (recentDailyFiles.length > 0) {
      const lines: string[] = [];
      for (const filePath of recentDailyFiles) {
        const content = await readOptionalFile(filePath);
        if (!content) continue;
        lines.push(`### ${path.basename(filePath)}`);
        lines.push(trimMarkdownForRecall(content, 500));
      }
      sections.push(formatRecallSection("Recent L2 Notes", lines));
    }

    const queryTerms = buildQueryTerms(conversation);
    const searchableFiles = [
      ...(await listMarkdownFiles(path.join(this.workspaceDir, "memory"))),
      ...(await listMarkdownFiles(path.join(this.workspaceDir, "reference"))),
    ];
    const snippets = await collectMatchingSnippets(searchableFiles, queryTerms, 4);
    if (snippets.length > 0) {
      sections.push(
        formatRecallSection(
          "Relevant L2/L3 Snippets",
          snippets.map((entry) => `- ${entry.file}: ${entry.snippet}`),
        ),
      );
    }

    return sections.filter(Boolean).join("\n\n");
  }

  async consolidate(
    userMessage: string,
    agentResponse: string,
    _conversation: AgentMessage[],
  ): Promise<void> {
    try {
      const currentL1State = await this.readL1State();
      const existingBreadcrumbs = await this.listBreadcrumbs();
      const today = new Date().toISOString().split("T")[0];

      const result = await consolidateWithLLM(
        userMessage,
        agentResponse,
        currentL1State,
        existingBreadcrumbs,
        today,
      );

      for (const fact of result.facts) {
        await this.applyFact(fact);
      }

      for (const suggestion of result.trimSuggestions) {
        await this.applyTrimSuggestion(suggestion);
      }

      await this.enforceL1Budget();
    } catch (err) {
      console.error("[three-layer] Consolidation error:", err);
    }
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
    try {
      const entries = await fs.readdir(memoryDir);
      for (const entry of entries) {
        await fs.rm(path.join(memoryDir, entry), { recursive: true });
      }
    } catch {}

    const referenceDir = path.join(this.workspaceDir, "reference");
    try {
      const entries = await fs.readdir(referenceDir);
      for (const entry of entries) {
        await fs.rm(path.join(referenceDir, entry), { recursive: true });
      }
    } catch {}

    for (const file of L1_FILES) {
      let content = L1_TEMPLATES[file];
      if (file === "IDENTITY.md") {
        content = content.replace("three-layer-agent", this.config.agentName);
      }
      await fs.writeFile(path.join(this.workspaceDir, file), content);
    }
  }

  generateOpenclawConfig(workspaceDir: string): Record<string, unknown> {
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
      memory: {
        backend: "external",
      },
    };
  }

  private async readL1State(): Promise<Record<string, string>> {
    const state: Record<string, string> = {};
    for (const file of L1_FILES) {
      try {
        state[file] = await fs.readFile(path.join(this.workspaceDir, file), "utf-8");
      } catch {
        state[file] = "";
      }
    }
    return state;
  }

  private async listBreadcrumbs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(path.join(this.workspaceDir, "memory"));
      return entries.filter((e) => e.endsWith(".md"));
    } catch {
      return [];
    }
  }

  private async readAllFiles(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];

    for (const file of L1_FILES) {
      try {
        const content = await fs.readFile(path.join(this.workspaceDir, file), "utf-8");
        files.push({ path: file, content });
      } catch {}
    }

    await this.readDirFiles("memory", files);
    await this.readDirFiles("reference", files);

    return files;
  }

  private async readDirFiles(
    dirName: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    const dirPath = path.join(this.workspaceDir, dirName);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const content = await fs.readFile(path.join(dirPath, entry.name), "utf-8");
        files.push({ path: `${dirName}/${entry.name}`, content });
      }
    } catch {}
  }

  private async applyFact(fact: ExtractedFact): Promise<void> {
    const filePath = this.resolveFilePath(fact.destination.file);

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      if (fact.action === "replace-section" && fact.section) {
        await this.replaceSection(filePath, fact.section, fact.content);
      } else if (fact.destination.layer === "L2") {
        await this.appendToBreadcrumb(filePath, fact.content);
      } else {
        await this.appendToFile(filePath, fact.content);
      }
    } catch (err) {
      console.error(`[three-layer] Failed to apply fact to ${fact.destination.file}:`, err);
    }
  }

  private async applyTrimSuggestion(suggestion: TrimSuggestion): Promise<void> {
    try {
      const sourcePath = this.resolveFilePath(suggestion.file);
      const destPath = this.resolveFilePath(suggestion.moveTo);

      const sourceContent = await fs.readFile(sourcePath, "utf-8");
      const trimmedContent = sourceContent.replace(suggestion.contentToRemove, "");

      if (trimmedContent !== sourceContent) {
        await fs.writeFile(sourcePath, trimmedContent);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await this.appendToFile(destPath, suggestion.contentToRemove);
      }
    } catch (err) {
      console.error("[three-layer] Failed to apply trim suggestion:", err);
    }
  }

  private resolveFilePath(filename: string): string {
    if (filename.startsWith("memory/") || filename.startsWith("reference/")) {
      return path.join(this.workspaceDir, filename);
    }
    return path.join(this.workspaceDir, filename);
  }

  private async replaceSection(filePath: string, sectionName: string, newContent: string): Promise<void> {
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, "utf-8");
    } catch {
      await fs.writeFile(filePath, `## ${sectionName}\n\n${newContent}\n`);
      return;
    }

    const sectionPattern = new RegExp(`(## ${escapeRegex(sectionName)}\n)([\\s\\S]*?)(?=\n## |$)`);
    const match = fileContent.match(sectionPattern);

    if (match) {
      fileContent = fileContent.replace(sectionPattern, `## ${sectionName}\n\n${newContent}\n`);
    } else {
      fileContent = fileContent.trimEnd() + `\n\n## ${sectionName}\n\n${newContent}\n`;
    }

    await fs.writeFile(filePath, fileContent);
  }

  private async appendToFile(filePath: string, content: string): Promise<void> {
    let existing = "";
    try {
      existing = await fs.readFile(filePath, "utf-8");
    } catch {}

    const newContent = existing ? existing.trimEnd() + "\n" + content + "\n" : content + "\n";
    await fs.writeFile(filePath, newContent);
  }

  private async appendToBreadcrumb(filePath: string, content: string): Promise<void> {
    let existing = "";
    try {
      existing = await fs.readFile(filePath, "utf-8");
    } catch {}

    const newContent = existing ? existing.trimEnd() + "\n" + content + "\n" : content + "\n";

    if (Buffer.byteLength(newContent, "utf-8") > BREADCRUMB_MAX_BYTES) {
      const lines = newContent.split("\n").filter((l) => l.trim());
      const halfPoint = Math.floor(lines.length / 2);
      const toArchive = lines.slice(0, halfPoint);
      const toKeep = lines.slice(halfPoint);

      await fs.writeFile(filePath, toKeep.join("\n") + "\n");

      const basename = path.basename(filePath);
      const refPath = path.join(this.workspaceDir, "reference", basename);
      await fs.mkdir(path.dirname(refPath), { recursive: true });
      await this.appendToFile(refPath, toArchive.join("\n"));
    } else {
      await fs.writeFile(filePath, newContent);
    }
  }

  async enforceL1Budget(): Promise<void> {
    const today = new Date().toISOString().split("T")[0];

    for (const file of L1_FILES) {
      const budget = L1_TOKEN_BUDGETS[file];
      const filePath = path.join(this.workspaceDir, file);

      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const estimatedTokens = estimateTokenCount(content);
      if (estimatedTokens <= budget) continue;

      const lines = content.split("\n");
      const trimmedLines: string[] = [];
      const overflowLines: string[] = [];
      let currentTokens = 0;

      for (const line of lines) {
        const lineTokens = estimateTokenCount(line);
        if (currentTokens + lineTokens <= budget) {
          trimmedLines.push(line);
          currentTokens += lineTokens;
        } else {
          overflowLines.push(line);
        }
      }

      if (overflowLines.length > 0) {
        await fs.writeFile(filePath, trimmedLines.join("\n") + "\n");

        const dailyPath = path.join(this.workspaceDir, "memory", `${today}.md`);
        const overflowContent = `\n## Trimmed from ${file}\n\n${overflowLines.join("\n")}\n`;
        await this.appendToFile(dailyPath, overflowContent);
      }
    }
  }
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
