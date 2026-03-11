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

const DEFAULT_FILES = {
  "IDENTITY.md": `# IDENTITY.md

- **Name:** {agentName}
- **Creature:** AI eval agent
- **Vibe:** Helpful, concise, task-focused
- **Emoji:** test-tube
`,
  "USER.md": `# USER.md

- **Name:** Michael
- **What to call them:** Michael
- **Timezone:** US/Pacific
- **Notes:** Software engineer. Likes concise, direct answers. Appreciates when you give specific recommendations rather than listing everything.
`,
  "SOUL.md": `# SOUL.md

## Core Truths

Be genuinely helpful. Skip filler. Get things done.

Have opinions. Recommend specific products/choices when asked.

Be resourceful - try to answer from knowledge before asking.

## Memory

When the user shares important information, decisions, specs, preferences, or asks you to remember something:
- **Always write it to MEMORY.md** using the write or edit tool. Do not just say you'll remember - actually save it.
- Organize entries under descriptive H2 headings so they're easy to find later.
- Include specific details (model numbers, specs, prices, compatibility info).

When answering questions that might relate to prior conversations:
- **Always check MEMORY.md first** using memory_search or by reading the file.
- Reference stored facts to maintain continuity across sessions.

## Boundaries

- Stay on task
- Give specific, actionable recommendations
- When shopping or comparing products, always note compatibility details
`,
  "MEMORY.md": `# Memory

_No entries yet._
`,
};

const ALLOWED_MEMORY_PATHS: AllowedMemoryPath[] = [
  { kind: "file", relPath: "MEMORY.md" },
  { kind: "dir", relPath: "memory" },
];

export class NativeBackend implements MemoryBackend {
  readonly variantId: string;
  readonly dimensionality = "0D" as const;
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
    if (input.workspaceFiles) {
      Object.assign(files, input.workspaceFiles);
    }
    return files;
  }

  async init(workspaceDir: string): Promise<void> {
    this.workspaceDir = workspaceDir;
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    for (const [filename, template] of Object.entries(DEFAULT_FILES)) {
      const content = template.replace("{agentName}", this.config.agentName);
      await fs.writeFile(path.join(workspaceDir, filename), content, { flag: "wx" }).catch(() => {});
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
      { flag: "wx" },
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

    const memoryContent = await readOptionalFile(path.join(this.workspaceDir, "MEMORY.md"));
    if (memoryContent) {
      sections.push(
        formatRecallSection("Stored Memory", [trimMarkdownForRecall(memoryContent, 1200)]),
      );
    }

    const recentDailyFiles = await listRecentDatedFiles(path.join(this.workspaceDir, "memory"), 2);
    if (recentDailyFiles.length > 0) {
      const recentLines: string[] = [];
      for (const filePath of recentDailyFiles) {
        const content = await readOptionalFile(filePath);
        if (!content) continue;
        recentLines.push(`### ${path.basename(filePath)}`);
        recentLines.push(trimMarkdownForRecall(content, 500));
      }
      sections.push(formatRecallSection("Recent Daily Notes", recentLines));
    }

    const queryTerms = buildQueryTerms(conversation);
    const files = await listMarkdownFiles(path.join(this.workspaceDir, "memory"));
    const snippets = await collectMatchingSnippets(files, queryTerms, 3);
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
  ): Promise<void> {}

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
    try {
      const entries = await fs.readdir(memoryDir);
      for (const entry of entries) {
        await fs.rm(path.join(memoryDir, entry), { recursive: true });
      }
    } catch {}

    await fs.writeFile(path.join(this.workspaceDir, "MEMORY.md"), "# Memory\n");
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

  private async readMemoryFiles(): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    const memoryDir = path.join(this.workspaceDir, "memory");

    try {
      const entries = await fs.readdir(memoryDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(memoryDir, entry.name);
        const content = await fs.readFile(filePath, "utf-8");
        files.push({ path: `memory/${entry.name}`, content });
      }
    } catch {}

    try {
      const content = await fs.readFile(path.join(this.workspaceDir, "MEMORY.md"), "utf-8");
      files.push({ path: "MEMORY.md", content });
    } catch {}

    return files;
  }
}
