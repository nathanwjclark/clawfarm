import fs from "node:fs/promises";
import path from "node:path";
import type { AgentBaseConfig } from "../config.js";

/**
 * Pre-populate a workspace with identity files so openclaw skips bootstrap.
 * Also creates the .openclaw-home/config.yaml that points openclaw at this workspace.
 */
export async function seedWorkspace(
  workspaceDir: string,
  config: AgentBaseConfig,
): Promise<void> {
  const files: Array<[string, string]> = [
    [
      "IDENTITY.md",
      `# IDENTITY.md

- **Name:** ${config.agentName}
- **Creature:** AI eval agent
- **Vibe:** Helpful, concise, task-focused
- **Emoji:** 🧪
`,
    ],
    [
      "USER.md",
      `# USER.md

- **Name:** Michael
- **What to call them:** Michael
- **Timezone:** US/Pacific
- **Notes:** Software engineer. Likes concise, direct answers. Appreciates when you give specific recommendations rather than listing everything.
`,
    ],
    [
      "SOUL.md",
      `# SOUL.md

## Core Truths

Be genuinely helpful. Skip filler. Get things done.

Have opinions. Recommend specific products/choices when asked.

Be resourceful — try to answer from knowledge before asking.

## Memory

When the user shares important information, decisions, specs, preferences, or asks you to remember something:
- **Always write it to MEMORY.md** using the write or edit tool. Do not just say you'll remember — actually save it.
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
    ],
    [
      "MEMORY.md",
      `# Memory

_No entries yet._
`,
    ],
  ];

  for (const [name, content] of files) {
    const filePath = path.join(workspaceDir, name);
    await fs.writeFile(filePath, content, { flag: "wx" }).catch(() => {});
  }

  // Create memory directory
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });

  // Mark workspace as onboarded so bootstrap is skipped
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

  console.log(`[workspace-seed] Seeded ${workspaceDir}`);
}
