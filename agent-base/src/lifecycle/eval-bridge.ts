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
  RunMetrics,
} from "../evals/external-eval-definition.js";
import type { EvalRunResult } from "../types.js";
import type { ChatHandler } from "./chat-handler.js";

export interface EvalBridgeRunOptions {
  days?: number;
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
export class EvalBridge {
  private running = false;
  private currentRunId: string | null = null;
  private childProcess: ChildProcess | null = null;
  private lastProgress: ExternalEvalProgress | null = null;

  constructor(
    private config: AgentBaseConfig,
    private monitor: AgentMonitor,
    private reporter: FarmReporter,
    private chatHandler: ChatHandler,
  ) {}

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
    const runId = `run-${crypto.randomBytes(4).toString("hex")}`;
    this.currentRunId = runId;
    this.lastProgress = null;
    const startTime = Date.now();

    console.log(`[eval-bridge] Starting "${evalDef.name}" (${runId}) in agent mode`);

    // Create eval workspace
    const evalWorkspace = path.join(this.config.workspaceDir, "eval-runs", runId);
    const logDir = path.join(evalWorkspace, "logs");
    await fs.mkdir(logDir, { recursive: true });

    const days = options.days ?? evalDef.defaultDays;
    const evalDir = this.resolveEvalDir(evalDef.id);

    // Build the agent URL that the eval subprocess will call back to
    // We need to figure out what port agent-base is listening on.
    // The port is available on the config, but if it was 0 (auto-assign),
    // we rely on the caller having set it correctly.
    const agentPort = this.config.port || 3900; // fallback

    // Resolve command args — replace placeholders
    const resolvedArgs = evalDef.args.map((arg) =>
      arg
        .replace("{days}", String(days))
        .replace("{logDir}", logDir)
        .replace("{evalDir}", evalDir)
        .replace("{openclawDir}", this.config.openclawDir ?? "")
        .replace("{workspaceDir}", evalWorkspace)
        .replace("{agentPort}", String(agentPort))
        .replace("{agentUrl}", `http://localhost:${agentPort}`)
        .replace("{farmUrl}", this.config.farmDashboardUrl)
        .replace("{agentId}", this.config.agentId),
    );

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

    // Track when we last reported progress
    let lastProgressReportTime = 0;
    let lastProgressReportDay = 0;
    const PROGRESS_REPORT_INTERVAL_MS = 30_000;
    const PROGRESS_REPORT_DAY_INTERVAL = 5;

    try {
      await new Promise<void>((resolve, reject) => {
        this.childProcess = spawn(evalDef.command, resolvedArgs, {
          cwd: evalWorkspace,
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
        });

        const rl = createInterface({ input: this.childProcess.stdout! });

        rl.on("line", (line: string) => {
          // Try to match progress pattern
          const match = line.match(evalDef.progressPattern);
          if (match) {
            const current = parseInt(match[1], 10);
            const total = parseInt(match[2], 10);
            const netWorthStr = match[3];
            const netWorth = netWorthStr
              ? parseFloat(netWorthStr.replace(/,/g, ""))
              : undefined;

            this.lastProgress = {
              current,
              total,
              label: "day",
              score: netWorth,
            };

            // Report progress to farm periodically
            const now = Date.now();
            const shouldReport =
              now - lastProgressReportTime >= PROGRESS_REPORT_INTERVAL_MS ||
              current - lastProgressReportDay >= PROGRESS_REPORT_DAY_INTERVAL;

            if (shouldReport) {
              lastProgressReportTime = now;
              lastProgressReportDay = current;
              this.reporter
                .reportEvalProgress(runId, evalDef.id, this.config.memoryVariant, {
                  current,
                  total,
                  label: "day",
                  score: netWorth,
                })
                .catch(() => {});
            }
          }

          // Log all stdout
          console.log(`[eval-bridge] ${line}`);
        });

        // Capture stderr
        if (this.childProcess.stderr) {
          const errRl = createInterface({ input: this.childProcess.stderr });
          errRl.on("line", (line: string) => {
            console.error(`[eval-bridge:stderr] ${line}`);
          });
        }

        this.childProcess.on("error", (err) => {
          reject(err);
        });

        this.childProcess.on("close", (code) => {
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
