import fs from "node:fs";
import path from "node:path";
import type { EvalType, EvalRun, EvalScore, RunMetrics } from "./types.js";

/**
 * Eval result storage with disk persistence.
 * Stores eval run results reported by agents, and derives EvalType/EvalRun
 * structures for the dashboard API. Data survives server restarts.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const RESULTS_FILE = path.join(DATA_DIR, "eval-results.json");
const META_FILE = path.join(DATA_DIR, "eval-metadata.json");
let persistEnabled = false;

export interface StoredEvalRun {
  result: {
    runId: string;
    evalId: string;
    agentId: string;
    memoryVariant: string;
    status: "completed" | "failed";
    score: number;
    maxScore: number;
    taskResults: Record<string, number>;
    costUsd: number;
    durationMs: number;
    runMetrics?: RunMetrics;
  };
  agentName: string;
  startedAt: string;
  completedAt: string;
  clockSpeed: "fast" | "real-world" | "custom";
}

export interface EvalMetadata {
  id: string;
  name: string;
  description: string;
  category: "recall" | "reasoning" | "integration" | "robustness" | "simulation";
  taskCount: number;
  maxScore: number;
}

// Keyed by runId
const results = new Map<string, StoredEvalRun>();

// Keyed by evalId
const evalMeta = new Map<string, EvalMetadata>();

export function storeEvalResult(
  result: StoredEvalRun["result"],
  agentName: string,
  clockSpeed: "fast" | "real-world" | "custom",
): void {
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.now() - result.durationMs).toISOString();

  results.set(result.runId, {
    result,
    agentName,
    startedAt,
    completedAt,
    clockSpeed,
  });

  // Auto-create metadata stub if evalId is unknown
  if (!evalMeta.has(result.evalId)) {
    evalMeta.set(result.evalId, {
      id: result.evalId,
      name: result.evalId,
      description: "",
      category: "recall",
      taskCount: Object.keys(result.taskResults).length,
      maxScore: result.maxScore,
    });
  }

  saveToDisk();
}

export function storeEvalMetadata(meta: EvalMetadata): void {
  evalMeta.set(meta.id, meta);
  saveToDisk();
}

/** Build farm EvalType[] from stored runs + metadata. */
export function getStoredEvalTypes(
  agentNameLookup: (agentId: string) => string,
): EvalType[] {
  // Group runs by evalId
  const runsByEval = new Map<string, StoredEvalRun[]>();
  for (const stored of results.values()) {
    const evalId = stored.result.evalId;
    if (!runsByEval.has(evalId)) runsByEval.set(evalId, []);
    runsByEval.get(evalId)!.push(stored);
  }

  const evalTypes: EvalType[] = [];

  for (const [evalId, runs] of runsByEval) {
    const meta = evalMeta.get(evalId);

    // Build EvalRun entries sorted by completedAt (most recent first)
    const evalRuns: EvalRun[] = runs
      .map((s) => storedToEvalRun(s, agentNameLookup))
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

    // Find high score among completed runs
    const completedRuns = runs.filter((r) => r.result.status === "completed");
    let highScore: EvalScore | null = null;
    if (completedRuns.length > 0) {
      const best = completedRuns.reduce((a, b) =>
        a.result.score > b.result.score ? a : b,
      );
      highScore = {
        agentId: best.result.agentId,
        agentName: best.agentName,
        memoryVariant: best.result.memoryVariant,
        score: best.result.score,
        maxScore: best.result.maxScore,
        runId: best.result.runId,
        achievedAt: best.completedAt,
      };
    }

    evalTypes.push({
      id: evalId,
      name: meta?.name ?? evalId,
      description: meta?.description ?? "",
      category: meta?.category ?? "recall",
      taskCount: meta?.taskCount ?? Object.keys(runs[0].result.taskResults).length,
      maxScore: meta?.maxScore,
      highScore,
      recentRuns: evalRuns.slice(0, 10),
    });
  }

  return evalTypes;
}

export function getStoredEvalType(
  id: string,
  agentNameLookup: (agentId: string) => string,
): EvalType | undefined {
  return getStoredEvalTypes(agentNameLookup).find((e) => e.id === id);
}

/** Best score % per variant per eval: Map<variantId, Record<evalId, scorePercent>>. */
export function getStoredVariantPerformance(): Map<string, Record<string, number>> {
  const perfMap = new Map<string, Record<string, number>>();

  for (const stored of results.values()) {
    if (stored.result.status !== "completed") continue;
    const variant = stored.result.memoryVariant;
    const evalId = stored.result.evalId;
    const pct = stored.result.maxScore > 0
      ? Math.round((stored.result.score / stored.result.maxScore) * 100)
      : 0;

    if (!perfMap.has(variant)) perfMap.set(variant, {});
    const existing = perfMap.get(variant)![evalId] ?? 0;
    if (pct > existing) {
      perfMap.get(variant)![evalId] = pct;
    }
  }

  return perfMap;
}

/** Get recent runs for a specific agent. */
export function getRecentRunsForAgent(
  agentId: string,
  agentNameLookup: (agentId: string) => string,
): EvalRun[] {
  const runs: EvalRun[] = [];
  for (const stored of results.values()) {
    if (stored.result.agentId === agentId) {
      runs.push(storedToEvalRun(stored, agentNameLookup));
    }
  }
  return runs
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 20);
}

/** Load persisted data from disk. Call on server startup. */
export function loadEvalStore(): void {
  persistEnabled = true;
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf-8")) as Array<[string, StoredEvalRun]>;
      results.clear();
      for (const [key, val] of data) results.set(key, val);
    }
  } catch { /* start fresh */ }
  try {
    if (fs.existsSync(META_FILE)) {
      const data = JSON.parse(fs.readFileSync(META_FILE, "utf-8")) as Array<[string, EvalMetadata]>;
      evalMeta.clear();
      for (const [key, val] of data) evalMeta.set(key, val);
    }
  } catch { /* start fresh */ }
}

/**
 * Store eval progress for a running external eval.
 * Creates/updates a running entry. When storeEvalResult() arrives for the same runId,
 * it overwrites this entry.
 */
export function storeEvalProgress(
  runId: string,
  agentId: string,
  evalId: string,
  memoryVariant: string,
  agentName: string,
  clockSpeed: "fast" | "real-world" | "custom",
  progress: { current: number; total: number; label?: string; score?: number },
): void {
  results.set(runId, {
    result: {
      runId,
      evalId,
      agentId,
      memoryVariant,
      status: "completed", // StoredEvalRun only supports completed|failed; we track running separately
      score: progress.score ?? 0,
      maxScore: -1,
      taskResults: {},
      costUsd: 0,
      durationMs: 0,
    },
    agentName,
    startedAt: new Date().toISOString(),
    completedAt: "",
    clockSpeed,
    _running: true,
    _progress: progress,
  } as StoredEvalRun & { _running: boolean; _progress: typeof progress });

  // Don't persist running entries to disk — they're transient
}

/** Get running eval entries (for API responses). */
export function getRunningEvals(): Array<{
  runId: string;
  evalId: string;
  agentId: string;
  agentName: string;
  memoryVariant: string;
  progress: { current: number; total: number; label?: string; score?: number };
}> {
  const running: Array<{
    runId: string;
    evalId: string;
    agentId: string;
    agentName: string;
    memoryVariant: string;
    progress: { current: number; total: number; label?: string; score?: number };
  }> = [];

  for (const stored of results.values()) {
    const s = stored as StoredEvalRun & { _running?: boolean; _progress?: any };
    if (s._running && s._progress) {
      running.push({
        runId: s.result.runId,
        evalId: s.result.evalId,
        agentId: s.result.agentId,
        agentName: s.agentName,
        memoryVariant: s.result.memoryVariant,
        progress: s._progress,
      });
    }
  }

  return running;
}

/** Reset all stored data (for testing). */
export function resetEvalStore(): void {
  results.clear();
  evalMeta.clear();
  persistEnabled = false;
}

function saveToDisk(): void {
  if (!persistEnabled) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(RESULTS_FILE, JSON.stringify([...results.entries()], null, 2));
    fs.writeFileSync(META_FILE, JSON.stringify([...evalMeta.entries()], null, 2));
  } catch {
    // Best-effort — don't crash on write failure
  }
}

// Internal helper
function storedToEvalRun(
  stored: StoredEvalRun,
  agentNameLookup: (agentId: string) => string,
): EvalRun {
  const r = stored.result;
  const s = stored as StoredEvalRun & { _running?: boolean; _progress?: any };
  const run: EvalRun = {
    id: r.runId,
    evalId: r.evalId,
    agentId: r.agentId,
    agentName: stored.agentName || agentNameLookup(r.agentId),
    memoryVariant: r.memoryVariant,
    startedAt: stored.startedAt,
    completedAt: stored.completedAt,
    status: s._running ? "running" : r.status,
    clockSpeed: stored.clockSpeed,
    score: r.score,
    maxScore: r.maxScore,
    taskResults: r.taskResults,
    costUsd: r.costUsd,
    runMetrics: r.runMetrics,
  };
  if (s._running && s._progress) {
    run.progress = s._progress;
  }
  return run;
}
