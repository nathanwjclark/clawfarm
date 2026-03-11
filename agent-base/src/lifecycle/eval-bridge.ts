import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createInterface } from "node:readline";
import type { AgentBaseConfig } from "../config.js";
import type { AgentMonitor } from "../monitoring/agent-monitor.js";
import type { FarmReporter } from "../monitoring/farm-reporter.js";
import type {
  ExternalEvalDefinition,
  ExternalEvalProgress,
  LlmCallProfileData,
  RunMetrics,
} from "../evals/external-eval-definition.js";
import type { EvalRunResult } from "../types.js";
import type { ChatHandler } from "./chat-handler.js";
import type { MemoryBackend } from "../memory/memory-backend.js";

export interface EvalBridgeRunOptions {
  days?: number;
  seed?: number;
  resetMemory?: boolean;
}

/**
 * EvalBridge: replaces ExternalEvalRunner for agent-mode evals.
 *
 * Instead of the eval talking to openclaw directly, the eval calls back to
 * agent-base's /eval/message endpoint. The bridge:
 * 1. Calls chatHandler.configureForEval() with the eval's plugin info
 * 2. Spawns the eval subprocess with --agent-url http://localhost:{port}
 * 3. Monitors the subprocess (progress from stdout, exit code)
 * 4. Reads transcript on completion
 */
export type LogSubscriber = (line: string) => void;

export class EvalBridge {
  private running = false;
  private currentRunId: string | null = null;
  private childProcess: ChildProcess | null = null;
  private lastProgress: ExternalEvalProgress | null = null;

  /** Rolling log buffer (last N lines). */
  private logBuffer: string[] = [];
  private readonly LOG_BUFFER_SIZE = 500;
  /** SSE subscribers for live log streaming. */
  private logSubscribers = new Set<LogSubscriber>();

  constructor(
    private config: AgentBaseConfig,
    private monitor: AgentMonitor,
    private reporter: FarmReporter,
    private chatHandler: ChatHandler,
    private backend: MemoryBackend,
  ) {}

  /** Get buffered log lines (for initial catch-up on SSE connect). */
  getLogBuffer(): string[] {
    return [...this.logBuffer];
  }

  /** Subscribe to live log lines. Returns unsubscribe function. */
  subscribeLogs(fn: LogSubscriber): () => void {
    this.logSubscribers.add(fn);
    return () => { this.logSubscribers.delete(fn); };
  }

  private pushLog(line: string): void {
    this.logBuffer.push(line);
    if (this.logBuffer.length > this.LOG_BUFFER_SIZE) {
      this.logBuffer.shift();
    }
    for (const fn of this.logSubscribers) {
      try { fn(line); } catch {}
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  getProgress(): ExternalEvalProgress | null {
    return this.lastProgress;
  }

  /**
   * Preflight check: validates that the environment is ready.
   */
  async preflight(evalDef: ExternalEvalDefinition): Promise<{ ok: boolean; error?: string }> {
    // Check API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return { ok: false, error: "ANTHROPIC_API_KEY environment variable is not set" };
    }

    // Check openclaw directory
    if (!this.config.openclawDir) {
      return { ok: false, error: "openclawDir is not configured" };
    }

    try {
      await fs.access(this.config.openclawDir);
    } catch {
      return { ok: false, error: `openclawDir not found: ${this.config.openclawDir}` };
    }

    // Check eval directory
    const evalDir = this.resolveEvalDir(evalDef.id);
    if (!evalDir) {
      return { ok: false, error: `Could not resolve eval directory for "${evalDef.id}". Configure externalEvalDirs.` };
    }

    try {
      await fs.access(evalDir);
    } catch {
      return { ok: false, error: `Eval directory not found: ${evalDir}` };
    }

    return { ok: true };
  }

  async runEval(
    evalDef: ExternalEvalDefinition,
    options: EvalBridgeRunOptions = {},
  ): Promise<EvalRunResult> {
    if (this.running) {
      throw new Error("An eval is already running");
    }

    // Run preflight checks before committing
    const check = await this.preflight(evalDef);
    if (!check.ok) {
      throw new Error(`Preflight failed: ${check.error}`);
    }

    this.running = true;
    this.logBuffer = [];
    const runId = `run-${crypto.randomBytes(4).toString("hex")}`;
    this.currentRunId = runId;
    this.lastProgress = null;
    const startTime = Date.now();

    // Reset memory by default so each eval starts clean
    const shouldReset = options.resetMemory !== false; // default true
    if (shouldReset) {
      console.log(`[eval-bridge] Resetting memory backend before eval`);
      await this.backend.reset();
      await this.backend.init(this.config.workspaceDir);
    }

    console.log(`[eval-bridge] Starting "${evalDef.name}" (${runId}) in agent mode`);

    // Create eval workspace
    const evalWorkspace = path.join(this.config.workspaceDir, "eval-runs", runId);
    const logDir = path.join(evalWorkspace, "logs");
    await fs.mkdir(logDir, { recursive: true });

    const days = options.days ?? evalDef.defaultDays;
    const seed = options.seed;
    const evalDir = this.resolveEvalDir(evalDef.id);

    // Build the agent URL that the eval subprocess will call back to
    // We need to figure out what port agent-base is listening on.
    // The port is available on the config, but if it was 0 (auto-assign),
    // we rely on the caller having set it correctly.
    const agentPort = this.config.port || 3900; // fallback

    // Resolve command args — replace placeholders
    const rawArgs = evalDef.args.map((arg) =>
      arg
        .replace("{days}", String(days))
        .replace("{logDir}", logDir)
        .replace("{evalDir}", evalDir)
        .replace("{openclawDir}", this.config.openclawDir ?? "")
        .replace("{workspaceDir}", evalWorkspace)
        .replace("{agentPort}", String(agentPort))
        .replace("{agentUrl}", `http://localhost:${agentPort}`)
        .replace("{farmUrl}", this.config.farmDashboardUrl)
        .replace("{agentId}", this.config.agentId)
        .replace("{seed}", seed !== undefined ? String(seed) : ""),
    );

    // Strip --event-seed pair when no seed was provided
    const resolvedArgs: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      if (rawArgs[i] === "--event-seed" && (!rawArgs[i + 1] || rawArgs[i + 1] === "")) {
        i++; // skip empty value
        continue;
      }
      resolvedArgs.push(rawArgs[i]);
    }

    // Update monitor with running state
    this.monitor.setEvalSummary({
      lastRun: {
        evalId: evalDef.id,
        evalName: evalDef.name,
        score: 0,
        maxScore: evalDef.maxScore,
        completedAt: "",
        status: "running",
      },
      variantBest: null,
    });

    let evalStatus: "completed" | "failed" = "completed";
    let lastError: string | null = null;

    // Report progress on every day for chart granularity
    let lastProgressReportDay = 0;
    // Profile regex: [PROFILE] day=N turn=N wall=N handler=N openclaw=N boot=N llm=N tool=N
    const profilePattern = /^\[PROFILE\]\s+day=(\d+)\s+turn=(\d+)\s+wall=(\d+)\s+handler=(\d+)\s+openclaw=(\d+)\s+boot=(\d+)\s+llm=(\d+)\s+tool=(\d+)/;
    // Per-call profile: [PROFILE_CALLS] day=N [{...}, ...]
    const profileCallsPattern = /^\[PROFILE_CALLS\]\s+day=(\d+)\s+(.+)$/;
    /** Parsed profile data keyed by day number. */
    const dayProfiles = new Map<number, { wallMs: number; handlerMs: number; openclawMs: number; bootstrapMs: number; llmApiMs: number; toolExecMs: number; llmCallProfiles?: LlmCallProfileData[] }>();
    // Track the last progress snapshot so we can re-report it with profile data attached
    let pendingProgressReport: { day: number; total: number; score?: number; costUsd: number; elapsedMs: number } | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        // Run from the eval's own directory so npx can find its node_modules
        const spawnCwd = evalDir || evalWorkspace;
        this.childProcess = spawn(evalDef.command, resolvedArgs, {
          cwd: spawnCwd,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        });

        const rl = createInterface({ input: this.childProcess.stdout! });

        // Helper: flush a pending progress report, attaching profile data if available
        const flushProgress = (report: NonNullable<typeof pendingProgressReport>) => {
          const dayProfile = dayProfiles.get(report.day);
          this.reporter
            .reportEvalProgress(runId, evalDef.id, this.config.memoryVariant, {
              current: report.day,
              total: report.total,
              label: "day",
              score: report.score,
              costUsd: report.costUsd,
              elapsedMs: report.elapsedMs,
              turnProfile: dayProfile ? {
                wallMs: dayProfile.wallMs,
                chatHandlerMs: dayProfile.handlerMs,
                openclawMs: dayProfile.openclawMs,
                bootstrapMs: dayProfile.bootstrapMs,
                llmApiMs: dayProfile.llmApiMs,
                toolExecMs: dayProfile.toolExecMs,
                llmCallProfiles: dayProfile.llmCallProfiles,
              } : undefined,
            })
            .catch(() => {});
        };

        rl.on("line", (line: string) => {
          // Parse [PROFILE] lines FIRST — they arrive after the progress line
          // for the same day, so we need them in the map before flushing.
          const profileMatch = line.match(profilePattern);
          if (profileMatch) {
            const day = parseInt(profileMatch[1], 10);
            dayProfiles.set(day, {
              wallMs: parseInt(profileMatch[3], 10),
              handlerMs: parseInt(profileMatch[4], 10),
              openclawMs: parseInt(profileMatch[5], 10),
              bootstrapMs: parseInt(profileMatch[6], 10),
              llmApiMs: parseInt(profileMatch[7], 10),
              toolExecMs: parseInt(profileMatch[8], 10),
            });
            // If there's a pending report for this day, flush it now with profile attached.
            // [PROFILE_CALLS] may follow on the next line and add llmCallProfiles to the
            // dayProfiles entry before the next progress line triggers a flush.
            if (pendingProgressReport && pendingProgressReport.day === day) {
              flushProgress(pendingProgressReport);
              pendingProgressReport = null;
            }
          }

          // Parse [PROFILE_CALLS] lines for per-LLM-call data
          const callsMatch = line.match(profileCallsPattern);
          if (callsMatch) {
            const day = parseInt(callsMatch[1], 10);
            try {
              const calls = JSON.parse(callsMatch[2]) as LlmCallProfileData[];
              const existing = dayProfiles.get(day);
              if (existing) {
                existing.llmCallProfiles = calls;
              }
            } catch {
              // Malformed JSON — skip
            }
          }

          // Try to match progress pattern
          const match = line.match(evalDef.progressPattern);
          if (match) {
            const current = parseInt(match[1], 10);
            const total = parseInt(match[2], 10);
            const scoreStr = match[3];
            const score = scoreStr
              ? parseFloat(scoreStr.replace(/,/g, ""))
              : undefined;

            const costState = this.monitor.costTracker.getState();
            const elapsedMs = Date.now() - startTime;

            this.lastProgress = {
              current,
              total,
              label: "day",
              score,
              costUsd: costState.estimatedUsd,
              elapsedMs,
            };

            // Report progress on every new day for chart granularity
            if (current > lastProgressReportDay) {
              // Flush any previous pending report (profile line may have been missed)
              if (pendingProgressReport) {
                flushProgress(pendingProgressReport);
              }
              lastProgressReportDay = current;
              // If we already have profile data for this day (unlikely but possible),
              // flush immediately; otherwise defer until [PROFILE] line arrives.
              const report = { day: current, total, score, costUsd: costState.estimatedUsd, elapsedMs };
              if (dayProfiles.has(current)) {
                flushProgress(report);
                pendingProgressReport = null;
              } else {
                pendingProgressReport = report;
              }
            }
          }

          // Log all stdout — buffer + stream to subscribers
          this.pushLog(line);
          console.log(`[eval-bridge] ${line}`);
        });

        // Capture stderr
        if (this.childProcess.stderr) {
          const errRl = createInterface({ input: this.childProcess.stderr });
          errRl.on("line", (line: string) => {
            this.pushLog(`[stderr] ${line}`);
            console.error(`[eval-bridge:stderr] ${line}`);
          });
        }

        this.childProcess.on("error", (err) => {
          reject(err);
        });

        this.childProcess.on("close", (code) => {
          // Flush any remaining pending progress report (last day's profile)
          if (pendingProgressReport) {
            flushProgress(pendingProgressReport);
            pendingProgressReport = null;
          }
          this.childProcess = null;
          if (code !== 0) {
            evalStatus = "failed";
            lastError = `Process exited with code ${code}`;
            console.error(`[eval-bridge] ${lastError}`);
          }
          resolve();
        });
      });
    } catch (err) {
      evalStatus = "failed";
      lastError = (err as Error).message;
      console.error(`[eval-bridge] Fatal error: ${lastError}`);
    }

    const durationMs = Date.now() - startTime;

    // Find and parse transcript
    let score = 0;
    let maxScore = evalDef.maxScore;
    let taskResults: Record<string, number> = {};
    let costUsd = 0;
    let runMetrics: RunMetrics | undefined;

    try {
      const transcriptPath = await this.findTranscript(logDir);
      if (transcriptPath) {
        const extracted = await evalDef.resultExtractor(transcriptPath);
        score = extracted.score;
        maxScore = extracted.maxScore;
        taskResults = extracted.taskResults;
        costUsd = extracted.costUsd;
        runMetrics = extracted.runMetrics;
      } else if (evalStatus !== "failed") {
        evalStatus = "failed";
        lastError = "No transcript file found in log directory";
        console.error(`[eval-bridge] ${lastError}`);
      }
    } catch (err) {
      if (evalStatus !== "failed") {
        evalStatus = "failed";
        lastError = `Failed to parse transcript: ${(err as Error).message}`;
        console.error(`[eval-bridge] ${lastError}`);
      }
    }

    if (lastError) {
      taskResults._error = 0;
    }

    // Reset chat handler after eval completes
    this.chatHandler.reset();

    this.running = false;
    this.currentRunId = null;
    this.childProcess = null;

    console.log(
      `[eval-bridge] ${evalDef.name} ${evalStatus}: score=${score} cost=$${costUsd.toFixed(2)} duration=${(durationMs / 1000).toFixed(1)}s`,
    );

    const result: EvalRunResult = {
      runId,
      evalId: evalDef.id,
      agentId: this.config.agentId,
      memoryVariant: this.config.memoryVariant,
      status: evalStatus,
      score,
      maxScore,
      taskResults,
      costUsd,
      durationMs,
      tokenUsage: {
        input: runMetrics?.tokenBreakdown?.agentInputTokens ?? 0,
        output: runMetrics?.tokenBreakdown?.agentOutputTokens ?? 0,
        cacheRead: 0,
      },
      runMetrics,
      transcripts: [],
      memorySnapshot: {
        variantId: this.config.memoryVariant,
        files: [],
        stats: { totalChunks: 0, totalFiles: 0, indexSizeBytes: 0 },
        graphState: { nodes: [], edges: [] },
      },
    };

    // Update monitor
    this.monitor.setEvalSummary({
      lastRun: {
        evalId: evalDef.id,
        evalName: evalDef.name,
        score,
        maxScore,
        completedAt: new Date().toISOString(),
        status: evalStatus,
      },
      variantBest: null,
    });

    // Report to farm
    try {
      await this.reporter.reportEvalResult(result);
      console.log("[eval-bridge] Result reported to farm");
    } catch (err) {
      console.error("[eval-bridge] Failed to report result:", err);
    }

    return result;
  }

  /** Resolve the eval directory from config's externalEvalDirs. */
  private resolveEvalDir(evalId: string): string {
    for (const dir of this.config.externalEvalDirs ?? []) {
      const resolved = path.isAbsolute(dir) ? dir : path.resolve(dir);
      const dirName = path.basename(resolved).toLowerCase();
      if (dirName.includes(evalId.replace(/-/g, "")) || dirName.includes(evalId)) {
        return resolved;
      }
    }
    for (const dir of this.config.externalEvalDirs ?? []) {
      return path.isAbsolute(dir) ? dir : path.resolve(dir);
    }
    return "";
  }

  /** Find the most recent transcript JSON in the log directory. */
  private async findTranscript(logDir: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(logDir);
      const transcripts = entries
        .filter((f) => f.includes("transcript") && f.endsWith(".json"))
        .sort()
        .reverse();
      if (transcripts.length > 0) {
        return path.join(logDir, transcripts[0]);
      }
    } catch {
      // Directory might not exist
    }
    return null;
  }
}
