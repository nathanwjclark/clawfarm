import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalType, EvalRun, EvalScore, RunMetrics } from "./types.js";

/**
 * Eval result storage with disk persistence.
 * Stores eval run results reported by agents, and derives EvalType/EvalRun
 * structures for the dashboard API. Data survives server restarts.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const RESULTS_FILE = path.join(DATA_DIR, "eval-results.json");
const META_FILE = path.join(DATA_DIR, "eval-metadata.json");
let persistEnabled = false;

/** Per-LLM-call profiling data. */
export interface LlmCallProfileEntry {
  callIndex: number;
  callType: "initial" | "tool_followup";
  totalMs: number;
  ttfcMs?: number;
  generationMs?: number;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  toolCallsRequested: number;
}

/** Per-day timing breakdown persisted with eval results. */
export interface DayProfile {
  day: number;
  wallMs: number;
  chatHandlerMs: number;
  openclawMs: number;
  bootstrapMs: number;
  llmApiMs: number;
  toolExecMs: number;
  /** Per-LLM-call breakdown within this day. */
  llmCalls?: LlmCallProfileEntry[];
  /** Number of LLM calls this day. */
  llmCallCount?: number;
}

/** Aggregated profiling summary for an eval run. */
export interface ProfilingSummary {
  /** Per-day timing breakdowns. */
  days: DayProfile[];
  /** Averages across all days. */
  avg: {
    wallMs: number;
    chatHandlerMs: number;
    openclawMs: number;
    bootstrapMs: number;
    llmApiMs: number;
    toolExecMs: number;
    /** Average LLM calls per day. */
    llmCallsPerDay?: number;
    /** Average time-to-first-chunk across all calls (ms). */
    ttfcMs?: number;
    /** Average generation time across all calls (ms). */
    generationMs?: number;
    /** Average per-call total time (ms). */
    perCallMs?: number;
  };
  /** Day 1 (typically slowest due to cold start). */
  firstDay?: DayProfile;
  /** Fixed vs marginal cost model derived from per-call data. */
  latencyModel?: {
    /** Estimated fixed overhead per call (network RTT + queue wait + prefill), ms. */
    fixedOverheadMs: number;
    /** Estimated ms per output token (generation speed). */
    msPerOutputToken: number;
    /** Number of calls used to derive the model. */
    sampleSize: number;
  };
}

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
  /** Persisted profiling summary (captured from progress history on completion). */
  profilingSummary?: ProfilingSummary;
  /** Persisted checkpoint history for chart rendering after completion. */
  checkpoints?: ProgressCheckpoint[];
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

// Progress history for running evals: runId -> array of checkpoint data points
export interface ProgressCheckpoint {
  day: number;
  total: number;
  score?: number;
  costUsd?: number;
  elapsedMs?: number;
  memoryTokens?: number;
  /** Per-turn profiling timing in milliseconds (from [PROFILE] lines). */
  turnProfile?: {
    wallMs: number;
    chatHandlerMs: number;
    openclawMs: number;
    bootstrapMs: number;
    llmApiMs: number;
    toolExecMs: number;
    /** Per-LLM-call breakdown (from [PROFILE_CALLS] lines). */
    llmCallProfiles?: LlmCallProfileEntry[];
  };
}

const progressHistory = new Map<string, {
  runId: string;
  agentId: string;
  agentName: string;
  memoryVariant: string;
  evalId: string;
  checkpoints: ProgressCheckpoint[];
}>();

export function storeEvalResult(
  result: StoredEvalRun["result"],
  agentName: string,
  clockSpeed: "fast" | "real-world" | "custom",
): void {
  const completedAt = new Date().toISOString();
  const startedAt = new Date(Date.now() - result.durationMs).toISOString();

  // Capture profiling + checkpoint data from progress history before it gets cleaned up
  const profilingSummary = buildProfilingSummary(result.runId);
  const history = progressHistory.get(result.runId);
  const checkpoints = history?.checkpoints?.length ? [...history.checkpoints] : undefined;

  results.set(result.runId, {
    result,
    agentName,
    startedAt,
    completedAt,
    clockSpeed,
    profilingSummary,
    checkpoints,
  });

  // Clean up progress history for this completed run
  cleanupProgressHistory(result.runId);

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
  progress: { current: number; total: number; label?: string; score?: number; costUsd?: number; elapsedMs?: number; memoryTokens?: number; turnProfile?: ProgressCheckpoint["turnProfile"] },
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
      costUsd: progress.costUsd ?? 0,
      durationMs: progress.elapsedMs ?? 0,
    },
    agentName,
    startedAt: new Date().toISOString(),
    completedAt: "",
    clockSpeed,
    _running: true,
    _progress: progress,
  } as StoredEvalRun & { _running: boolean; _progress: typeof progress });

  // Append to progress history for charting
  if (!progressHistory.has(runId)) {
    progressHistory.set(runId, {
      runId,
      agentId,
      agentName,
      memoryVariant,
      evalId,
      checkpoints: [],
    });
  }
  const history = progressHistory.get(runId)!;
  // Only append if this is a new day (avoid duplicates)
  const lastDay = history.checkpoints.length > 0 ? history.checkpoints[history.checkpoints.length - 1].day : -1;
  if (progress.current > lastDay) {
    history.checkpoints.push({
      day: progress.current,
      total: progress.total,
      score: progress.score,
      costUsd: progress.costUsd,
      elapsedMs: progress.elapsedMs,
      memoryTokens: progress.memoryTokens,
      turnProfile: progress.turnProfile,
    });
  }

  // Don't persist running entries to disk — they're transient
}

/** Get all stored eval runs as a flat list (for the Runs view). */
export function getAllEvalRuns(
  agentNameLookup: (agentId: string) => string,
  isAgentLive?: (agentId: string) => boolean,
): EvalRun[] {
  // Clean up zombie running entries: if agent is no longer live, mark as failed
  if (isAgentLive) {
    for (const stored of results.values()) {
      const s = stored as StoredEvalRun & { _running?: boolean; _progress?: any };
      if (s._running && !isAgentLive(stored.result.agentId)) {
        // Capture checkpoint + profiling data before cleanup
        if (!stored.checkpoints) {
          const hist = progressHistory.get(stored.result.runId);
          if (hist?.checkpoints?.length) {
            stored.checkpoints = [...hist.checkpoints];
          }
        }
        if (!stored.profilingSummary) {
          stored.profilingSummary = buildProfilingSummary(stored.result.runId);
        }
        // Preserve the last known score from progress
        if (s._progress?.score && stored.result.score === 0) {
          stored.result.score = s._progress.score;
        }
        s._running = false;
        delete s._progress;
        stored.result.status = "failed";
        stored.completedAt = new Date().toISOString();
        cleanupProgressHistory(stored.result.runId);
        saveToDisk();
      }
    }
  }

  const runs: EvalRun[] = [];
  for (const stored of results.values()) {
    runs.push(storedToEvalRun(stored, agentNameLookup));
  }
  return runs.sort((a, b) => {
    // Running first, then by startedAt descending
    if (a.status === "running" && b.status !== "running") return -1;
    if (b.status === "running" && a.status !== "running") return 1;
    return (b.startedAt || "").localeCompare(a.startedAt || "");
  });
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

/** Get progress history for all running (and recently completed) evals. */
export function getProgressHistory(): Array<{
  runId: string;
  agentId: string;
  agentName: string;
  memoryVariant: string;
  evalId: string;
  checkpoints: ProgressCheckpoint[];
}> {
  return [...progressHistory.values()];
}

/** Build a ProfilingSummary from progress history checkpoints for a run. */
function buildProfilingSummary(runId: string): ProfilingSummary | undefined {
  const history = progressHistory.get(runId);
  if (!history) return undefined;

  const days: DayProfile[] = history.checkpoints
    .filter((cp) => cp.turnProfile != null)
    .map((cp) => ({
      day: cp.day,
      wallMs: cp.turnProfile!.wallMs,
      chatHandlerMs: cp.turnProfile!.chatHandlerMs,
      openclawMs: cp.turnProfile!.openclawMs,
      bootstrapMs: cp.turnProfile!.bootstrapMs,
      llmApiMs: cp.turnProfile!.llmApiMs,
      toolExecMs: cp.turnProfile!.toolExecMs,
      llmCalls: cp.turnProfile!.llmCallProfiles,
      llmCallCount: cp.turnProfile!.llmCallProfiles?.length,
    }));

  if (days.length === 0) return undefined;

  const sum = (fn: (d: DayProfile) => number) => days.reduce((acc, d) => acc + fn(d), 0);
  const n = days.length;

  // Collect all per-call profiles across all days for aggregate stats
  const allCalls: LlmCallProfileEntry[] = days.flatMap((d) => d.llmCalls ?? []);
  const callsWithTtfc = allCalls.filter((c) => c.ttfcMs != null);
  const callsWithGen = allCalls.filter((c) => c.generationMs != null);

  const avg: ProfilingSummary["avg"] = {
    wallMs: Math.round(sum((d) => d.wallMs) / n),
    chatHandlerMs: Math.round(sum((d) => d.chatHandlerMs) / n),
    openclawMs: Math.round(sum((d) => d.openclawMs) / n),
    bootstrapMs: Math.round(sum((d) => d.bootstrapMs) / n),
    llmApiMs: Math.round(sum((d) => d.llmApiMs) / n),
    toolExecMs: Math.round(sum((d) => d.toolExecMs) / n),
  };

  if (allCalls.length > 0) {
    avg.llmCallsPerDay = Math.round((allCalls.length / n) * 10) / 10;
    avg.perCallMs = Math.round(allCalls.reduce((s, c) => s + c.totalMs, 0) / allCalls.length);
  }
  if (callsWithTtfc.length > 0) {
    avg.ttfcMs = Math.round(callsWithTtfc.reduce((s, c) => s + c.ttfcMs!, 0) / callsWithTtfc.length);
  }
  if (callsWithGen.length > 0) {
    avg.generationMs = Math.round(callsWithGen.reduce((s, c) => s + c.generationMs!, 0) / callsWithGen.length);
  }

  // Derive fixed/marginal latency model via linear regression of generationMs vs output tokens
  let latencyModel: ProfilingSummary["latencyModel"];
  const regressionData = allCalls
    .filter((c) => c.ttfcMs != null && c.usage?.output != null && c.usage.output > 0)
    .map((c) => ({ ttfc: c.ttfcMs!, genMs: c.generationMs ?? (c.totalMs - c.ttfcMs!), outputTokens: c.usage!.output! }));

  if (regressionData.length >= 3) {
    // Fixed overhead = median TTFC
    const ttfcValues = regressionData.map((d) => d.ttfc).sort((a, b) => a - b);
    const fixedOverheadMs = ttfcValues[Math.floor(ttfcValues.length / 2)]!;

    // Linear regression: generationMs = slope * outputTokens + intercept
    const meanX = regressionData.reduce((s, d) => s + d.outputTokens, 0) / regressionData.length;
    const meanY = regressionData.reduce((s, d) => s + d.genMs, 0) / regressionData.length;
    let ssXY = 0, ssXX = 0;
    for (const d of regressionData) {
      ssXY += (d.outputTokens - meanX) * (d.genMs - meanY);
      ssXX += (d.outputTokens - meanX) ** 2;
    }
    const msPerOutputToken = ssXX > 0 ? Math.round((ssXY / ssXX) * 100) / 100 : 0;

    latencyModel = {
      fixedOverheadMs: Math.round(fixedOverheadMs),
      msPerOutputToken,
      sampleSize: regressionData.length,
    };
  }

  return {
    days,
    avg,
    firstDay: days[0],
    latencyModel,
  };
}

/** Get profile data for a specific run (from progress history checkpoints). */
export function getRunProfile(runId: string): Array<{ day: number; turnProfile: NonNullable<ProgressCheckpoint["turnProfile"]> }> | null {
  const history = progressHistory.get(runId);
  if (!history) return null;
  return history.checkpoints
    .filter((cp) => cp.turnProfile != null)
    .map((cp) => ({ day: cp.day, turnProfile: cp.turnProfile! }));
}

/**
 * Get chart data combining live progress history AND persisted checkpoints from recent completed runs.
 * This ensures charts always show the most recent runs, even after progress history is cleaned up.
 */
export function getChartHistory(): Array<{
  runId: string;
  agentId: string;
  agentName: string;
  memoryVariant: string;
  evalId: string;
  checkpoints: ProgressCheckpoint[];
}> {
  // Start with live progress history (running + recently completed)
  const live = getProgressHistory();
  const liveRunIds = new Set(live.map((s) => s.runId));

  // Find the most recent completed/failed run per agent that has checkpoints
  // (these are runs whose progress history has already been cleaned up)
  const latestByAgent = new Map<string, StoredEvalRun>();
  for (const stored of results.values()) {
    if (liveRunIds.has(stored.result.runId)) continue; // already in live
    if (!stored.checkpoints?.length) continue;
    const existing = latestByAgent.get(stored.result.agentId);
    if (!existing || stored.startedAt > existing.startedAt) {
      latestByAgent.set(stored.result.agentId, stored);
    }
  }

  // Merge persisted runs into the result
  const persisted = [...latestByAgent.values()].map((stored) => ({
    runId: stored.result.runId,
    agentId: stored.result.agentId,
    agentName: stored.agentName,
    memoryVariant: stored.result.memoryVariant,
    evalId: stored.result.evalId,
    checkpoints: stored.checkpoints ?? [],
  }));

  return [...live, ...persisted];
}

/** Clean up progress history for a completed eval run. Keep data for 5 minutes after completion. */
export function cleanupProgressHistory(runId: string): void {
  // Delay cleanup so charts can show final state briefly
  setTimeout(() => {
    progressHistory.delete(runId);
  }, 5 * 60 * 1000);
}

/** Reset all stored data (for testing). */
export function resetEvalStore(): void {
  results.clear();
  evalMeta.clear();
  progressHistory.clear();
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
    profilingSummary: stored.profilingSummary,
  };
  if (s._running && s._progress) {
    run.progress = s._progress;
  }
  return run;
}
