import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AgentBaseConfig } from "../config.js";
import { createMemoryBackend } from "../memory/backend-factory.js";
import type { MemoryBackend } from "../memory/memory-backend.js";
import type { AgentMonitor } from "../monitoring/agent-monitor.js";
import type { FarmReporter } from "../monitoring/farm-reporter.js";
import type { EvalDefinition, ScoringContext } from "../evals/eval-definition.js";
import type { EvalRunResult, AgentMessage } from "../types.js";
import type { ClockSpeed } from "../messaging/eval-source.js";
import { EvalSource } from "../messaging/eval-source.js";
import { SimRegistry } from "../integrations/sim-registry.js";
import { ChatHandler } from "./chat-handler.js";
import { seedWorkspace } from "./workspace-seed.js";

export interface EvalRunOptions {
  clockSpeed?: ClockSpeed;
  customDelayMs?: number;
}

interface SessionTranscript {
  sessionIndex: number;
  messages: AgentMessage[];
  exchanges: Array<{ userMessage: string; agentResponse: string }>;
}

/**
 * Orchestrates a full eval run:
 * 1. Create fresh workspace
 * 2. Inject messages via EvalSource → ChatHandler → openclaw CLI
 * 3. Handle multi-session (new session-id, same workspace)
 * 4. Score responses
 * 5. Capture state and report results
 */
export class EvalRunner {
  private running = false;
  private currentRunId: string | null = null;

  constructor(
    private config: AgentBaseConfig,
    private monitor: AgentMonitor,
    private reporter: FarmReporter,
    private backend: MemoryBackend,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  getCurrentRunId(): string | null {
    return this.currentRunId;
  }

  async runEval(
    evalDef: EvalDefinition,
    options: EvalRunOptions = {},
  ): Promise<EvalRunResult> {
    if (this.running) {
      throw new Error("An eval is already running");
    }

    this.running = true;
    const runId = `run-${crypto.randomBytes(4).toString("hex")}`;
    this.currentRunId = runId;
    const startTime = Date.now();

    console.log(`[eval-runner] Starting eval "${evalDef.name}" (${runId})`);

    // Reset monitor for fresh eval
    this.monitor.reset();

    // Create fresh workspace for this eval run
    const evalWorkspace = path.join(
      this.config.workspaceDir,
      "eval-runs",
      runId,
    );
    await fs.mkdir(evalWorkspace, { recursive: true });

    // Pre-seed workspace files so openclaw skips bootstrap
    await seedWorkspace(evalWorkspace, this.config);

    // Create eval config with the fresh workspace
    const evalConfig = { ...this.config, workspaceDir: evalWorkspace };

    // Create a fresh memory backend for this eval run
    const evalBackend = createMemoryBackend(this.config.memoryVariant, evalConfig);
    await evalBackend.init(evalWorkspace);

    // Set up message source
    const clockSpeed = options.clockSpeed ?? evalDef.defaultClockSpeed;
    const source = new EvalSource({
      messages: evalDef.messages,
      clockSpeed,
      customDelayMs: options.customDelayMs,
    });

    // Track transcripts per session
    const transcripts = new Map<number, SessionTranscript>();
    let chatHandler = new ChatHandler(evalConfig, this.monitor, evalBackend);
    let currentSessionIndex = -1;

    // Set up integration sims if the eval defines them
    let simRegistry: SimRegistry | null = null;
    if (evalDef.integrations && evalDef.integrations.length > 0) {
      simRegistry = new SimRegistry(evalDef.integrations);
      chatHandler.setSimRegistry(simRegistry);
      console.log(
        `[eval-runner] Integration sims active: ${evalDef.integrations.map((i) => `${i.type}:${i.name}`).join(", ")}`,
      );
    }

    // Update eval summary to show running state
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

    try {
      // Main eval loop
      while (!source.isDone()) {
        const msg = await source.nextMessage();
        if (!msg) break;

        // Process any scheduled integration events at this point
        const messageIndex = Array.from(transcripts.values()).reduce(
          (sum, t) => sum + t.exchanges.length,
          0,
        );
        simRegistry?.processScheduledEvents({
          messageIndex,
          sessionIndex: msg.sessionIndex,
        });

        // Handle session transitions
        if (msg.sessionIndex !== currentSessionIndex) {
          // End previous session if any
          if (currentSessionIndex >= 0) {
            this.monitor.recordSessionEnd();
          }

          // Start new session — fresh ChatHandler (new session-id) but same workspace
          if (msg.expectNewSession || currentSessionIndex === -1) {
            chatHandler.reset();
            // Re-attach sim registry after reset (persists across sessions)
            if (simRegistry) chatHandler.setSimRegistry(simRegistry);
            currentSessionIndex = msg.sessionIndex;

            if (!transcripts.has(currentSessionIndex)) {
              transcripts.set(currentSessionIndex, {
                sessionIndex: currentSessionIndex,
                messages: [],
                exchanges: [],
              });
            }

            console.log(
              `[eval-runner] Session ${currentSessionIndex} started`,
            );
          }
        }

        const transcript = transcripts.get(currentSessionIndex)!;

        // Record system message noting the eval context
        const systemMsg: AgentMessage = {
          id: `eval-sys-${runId}-s${currentSessionIndex}`,
          timestamp: new Date().toISOString(),
          role: "system",
          content: `[Eval] ${evalDef.name} — Session ${currentSessionIndex + 1}, Message ${transcript.exchanges.length + 1}`,
          tokenCount: 20,
        };
        this.monitor.recordMessageProcessed(systemMsg);
        transcript.messages.push(systemMsg);

        // Send message to agent
        const progress = source.getProgress();
        console.log(
          `[eval-runner] [${progress.current}/${progress.total}] Sending: "${msg.content.slice(0, 80)}..."`,
        );

        try {
          const response = await chatHandler.handleMessage(msg.content);
          source.onAgentResponse(response);

          // Record in transcript
          const userMsg: AgentMessage = {
            id: `eval-user-${transcript.exchanges.length}`,
            timestamp: new Date().toISOString(),
            role: "user",
            content: msg.content,
            tokenCount: Math.ceil(msg.content.length / 4),
          };
          const assistantMsg: AgentMessage = {
            id: `eval-asst-${transcript.exchanges.length}`,
            timestamp: new Date().toISOString(),
            role: "assistant",
            content: response,
            tokenCount: Math.ceil(response.length / 4),
          };
          transcript.messages.push(userMsg, assistantMsg);
          transcript.exchanges.push({
            userMessage: msg.content,
            agentResponse: response,
          });

          console.log(
            `[eval-runner] Response: "${response.slice(0, 100)}..."`,
          );

          // Check cost cap
          if (this.monitor.costTracker.isOverEvalCap()) {
            console.log("[eval-runner] Cost cap exceeded — stopping eval");
            evalStatus = "failed";
            lastError = "Cost cap exceeded";
            break;
          }
        } catch (err) {
          const errorMsg = (err as Error).message;
          console.error(`[eval-runner] Agent error: ${errorMsg}`);

          // Record error but continue to next message
          const errorRecord: AgentMessage = {
            id: `eval-err-${transcript.exchanges.length}`,
            timestamp: new Date().toISOString(),
            role: "system",
            content: `[Error] ${errorMsg}`,
            tokenCount: Math.ceil(errorMsg.length / 4),
          };
          transcript.messages.push(errorRecord);
          transcript.exchanges.push({
            userMessage: msg.content,
            agentResponse: `[ERROR: ${errorMsg}]`,
          });
        }
      }

      // End final session
      if (currentSessionIndex >= 0) {
        this.monitor.recordSessionEnd();
      }
    } catch (err) {
      evalStatus = "failed";
      lastError = (err as Error).message;
      console.error(`[eval-runner] Fatal eval error: ${lastError}`);
    }

    this.running = false;
    this.currentRunId = null;
    const durationMs = Date.now() - startTime;

    // Score the eval
    const scoringCtx: ScoringContext = {
      transcripts: Array.from(transcripts.values()).map((t) => ({
        sessionIndex: t.sessionIndex,
        exchanges: t.exchanges,
      })),
    };

    const taskResults: Record<string, number> = {};
    let totalScore = 0;
    for (const criterion of evalDef.scoring) {
      try {
        const score = criterion.score(scoringCtx);
        taskResults[criterion.taskId] = score;
        totalScore += score;
        const status = score >= criterion.maxScore ? "PASS" : score > 0 ? "PARTIAL" : "FAIL";
        console.log(
          `[eval-runner] ${status} ${criterion.taskId}: ${score}/${criterion.maxScore} — ${criterion.description}`,
        );
      } catch (err) {
        console.error(
          `[eval-runner] Scoring error for ${criterion.taskId}:`,
          err,
        );
        taskResults[criterion.taskId] = 0;
      }
    }

    console.log(
      `[eval-runner] Final score: ${totalScore}/${evalDef.maxScore} (${((totalScore / evalDef.maxScore) * 100).toFixed(1)}%)`,
    );

    // Capture memory state via backend
    const memorySnapshot = await evalBackend.captureSnapshot();

    // Build cost summary
    const costState = this.monitor.costTracker.getState();

    const result: EvalRunResult = {
      runId,
      evalId: evalDef.id,
      agentId: this.config.agentId,
      memoryVariant: this.config.memoryVariant,
      status: evalStatus,
      score: totalScore,
      maxScore: evalDef.maxScore,
      taskResults,
      costUsd: costState.estimatedUsd,
      durationMs,
      tokenUsage: {
        input: costState.totalInputTokens,
        output: costState.totalOutputTokens,
        cacheRead: costState.totalCacheReadTokens,
      },
      transcripts: Array.from(transcripts.values()).map((t) => ({
        sessionIndex: t.sessionIndex,
        messages: t.messages,
      })),
      memorySnapshot,
    };

    // Update eval summary on monitor
    this.monitor.setEvalSummary({
      lastRun: {
        evalId: evalDef.id,
        evalName: evalDef.name,
        score: totalScore,
        maxScore: evalDef.maxScore,
        completedAt: new Date().toISOString(),
        status: evalStatus,
      },
      variantBest: null,
    });

    // Report to farm
    try {
      await this.reporter.reportEvalResult(result);
      console.log("[eval-runner] Result reported to farm");
    } catch (err) {
      console.error("[eval-runner] Failed to report result:", err);
    }

    return result;
  }
}

