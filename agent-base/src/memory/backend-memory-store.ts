import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryReadResult, MemorySearchResult, MemoryWriteResult } from "../types.js";

export type AllowedMemoryPath =
  | { kind: "file"; relPath: string }
  | { kind: "dir"; relPath: string };

function normalizeRelPath(relPath: string): string {
  return relPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

export function resolveAllowedMemoryPath(
  workspaceDir: string,
  relPath: string,
  allowed: AllowedMemoryPath[],
): string {
  const normalized = normalizeRelPath(relPath);
  if (!normalized || normalized.includes("..")) {
    throw new Error(`Invalid memory path: "${relPath}"`);
  }

  const absTarget = path.resolve(workspaceDir, normalized);
  for (const rule of allowed) {
    const absRule = path.resolve(workspaceDir, rule.relPath);
    if (rule.kind === "file" && absTarget === absRule) {
      return absTarget;
    }
    if (rule.kind === "dir" && isInside(absRule, absTarget)) {
      return absTarget;
    }
  }

  throw new Error(`Memory path not allowed: "${relPath}"`);
}

export async function listFilesForRules(
  workspaceDir: string,
  allowed: AllowedMemoryPath[],
): Promise<Array<{ relPath: string; absPath: string }>> {
  const files = new Map<string, string>();

  async function walkDir(absDir: string): Promise<void> {
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(absPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relPath = path.relative(workspaceDir, absPath).replace(/\\/g, "/");
      files.set(relPath, absPath);
    }
  }

  for (const rule of allowed) {
    const absRule = path.resolve(workspaceDir, rule.relPath);
    if (rule.kind === "file") {
      try {
        const stat = await fs.stat(absRule);
        if (stat.isFile()) {
          files.set(rule.relPath, absRule);
        }
      } catch {}
      continue;
    }

    await walkDir(absRule);
  }

  return [...files.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([relPath, absPath]) => ({ relPath, absPath }));
}

export async function searchAllowedMemory(params: {
  workspaceDir: string;
  allowed: AllowedMemoryPath[];
  query: string;
  maxResults?: number;
  minScore?: number;
}): Promise<MemorySearchResult[]> {
  const queryTerms = params.query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{2,}/g)
    ?.filter(Boolean) ?? [];

  const files = await listFilesForRules(params.workspaceDir, params.allowed);
  const results: MemorySearchResult[] = [];
  const maxResults = params.maxResults ?? 5;
  const minScore = params.minScore ?? 0;

  for (const file of files) {
    const content = await fs.readFile(file.absPath, "utf-8").catch(() => "");
    if (!content) continue;
    const lines = content.split("\n");
    let best:
      | {
          startLine: number;
          endLine: number;
          score: number;
          snippet: string;
        }
      | undefined;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const lowered = line.toLowerCase();
      const score = queryTerms.length === 0
        ? 0
        : queryTerms.reduce((sum, term) => sum + (lowered.includes(term) ? 1 : 0), 0);
      if (score <= 0) continue;

      const start = Math.max(0, index - 1);
      const end = Math.min(lines.length - 1, index + 1);
      const snippet = lines.slice(start, end + 1).join("\n").trim();
      if (!best || score > best.score) {
        best = {
          startLine: start + 1,
          endLine: end + 1,
          score,
          snippet,
        };
      }
    }

    if (best && best.score >= minScore) {
      results.push({
        path: file.relPath,
        startLine: best.startLine,
        endLine: best.endLine,
        score: best.score,
        snippet: best.snippet,
        source: "memory",
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, maxResults);
}

export async function readAllowedMemory(params: {
  workspaceDir: string;
  allowed: AllowedMemoryPath[];
  path: string;
  from?: number;
  lines?: number;
}): Promise<MemoryReadResult> {
  const absPath = resolveAllowedMemoryPath(params.workspaceDir, params.path, params.allowed);
  const relPath = path.relative(params.workspaceDir, absPath).replace(/\\/g, "/");
  const content = await fs.readFile(absPath, "utf-8");

  if (!params.from && !params.lines) {
    return { path: relPath, text: content };
  }

  const allLines = content.split("\n");
  const start = Math.max(1, params.from ?? 1);
  const count = Math.max(1, params.lines ?? allLines.length);
  const selected = allLines.slice(start - 1, start - 1 + count).join("\n");
  return { path: relPath, text: selected };
}

export async function writeAllowedMemory(params: {
  workspaceDir: string;
  allowed: AllowedMemoryPath[];
  path: string;
  content: string;
  mode?: "append" | "replace";
}): Promise<MemoryWriteResult> {
  const mode = params.mode ?? "append";
  const absPath = resolveAllowedMemoryPath(params.workspaceDir, params.path, params.allowed);
  const relPath = path.relative(params.workspaceDir, absPath).replace(/\\/g, "/");
  await fs.mkdir(path.dirname(absPath), { recursive: true });

  if (mode === "replace") {
    await fs.writeFile(absPath, params.content);
  } else {
    const existing = await fs.readFile(absPath, "utf-8").catch(() => "");
    const next = existing ? `${existing.trimEnd()}\n${params.content}\n` : `${params.content}\n`;
    await fs.writeFile(absPath, next);
  }

  return {
    ok: true,
    path: relPath,
    mode,
    bytesWritten: Buffer.byteLength(params.content, "utf-8"),
  };
}
