import fs from "node:fs/promises";
import path from "node:path";
import type { AgentMessage } from "../types.js";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "agent",
  "also",
  "been",
  "before",
  "from",
  "have",
  "just",
  "like",
  "make",
  "need",
  "that",
  "them",
  "then",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);

export async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(dirPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export async function listRecentDatedFiles(dirPath: string, limit: number): Promise<string[]> {
  const files = await listMarkdownFiles(dirPath);
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(path.basename(file)))
    .sort()
    .slice(-limit)
    .reverse();
}

export function buildQueryTerms(conversation: AgentMessage[], maxTerms = 8): string[] {
  const text = conversation
    .slice(-6)
    .map((message) => message.content)
    .join(" ")
    .toLowerCase();

  const counts = new Map<string, number>();
  for (const token of text.match(/[a-z0-9][a-z0-9_-]{3,}/g) ?? []) {
    if (STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTerms)
    .map(([token]) => token);
}

export function trimMarkdownForRecall(content: string, maxChars: number): string {
  const cleaned = content.trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export async function collectMatchingSnippets(
  filePaths: string[],
  queryTerms: string[],
  limit: number,
): Promise<Array<{ file: string; snippet: string }>> {
  if (queryTerms.length === 0) {
    return [];
  }

  const results: Array<{ file: string; snippet: string; score: number }> = [];
  for (const filePath of filePaths) {
    const content = await readOptionalFile(filePath);
    if (!content) continue;

    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
    let bestSnippet = "";
    let bestScore = 0;

    for (const line of lines) {
      const haystack = line.toLowerCase();
      const score = queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestSnippet = line;
      }
    }

    if (bestScore > 0 && bestSnippet) {
      results.push({
        file: path.basename(filePath),
        snippet: bestSnippet,
        score: bestScore,
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map(({ file, snippet }) => ({ file, snippet }));
}

export function formatRecallSection(title: string, lines: string[]): string {
  const cleaned = lines.map((line) => line.trimEnd()).filter(Boolean);
  if (cleaned.length === 0) {
    return "";
  }
  return `## ${title}\n${cleaned.join("\n")}`;
}
