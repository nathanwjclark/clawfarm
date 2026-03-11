import express from "express";
import type { Server } from "node:http";
import type { AgentBaseConfig } from "../config.js";
import { createMemoryBackend } from "../memory/backend-factory.js";
import { registerMemoryBackendRoutes } from "../memory/memory-backend-bridge.js";
import type { MemoryBackend } from "../memory/memory-backend.js";
import { AgentMonitor } from "../monitoring/agent-monitor.js";
import { FarmReporter } from "../monitoring/farm-reporter.js";
import { ChatHandler } from "./chat-handler.js";
import { EvalRunner } from "./eval-runner.js";
import { getEvalDefinition, getAllEvalDefinitions, getExternalEvalDefinition, getAllExternalEvalDefinitions } from "../evals/registry.js";
import { ExternalEvalRunner } from "./external-eval-runner.js";
import { EvalBridge } from "./eval-bridge.js";

/**
 * Manages a single agent instance lifecycle.
 * - Starts an HTTP server exposing status/messages/graph/eval endpoints
 * - Registers with the farm dashboard
 * - Sends periodic heartbeats
 * - Handles live chat via openclaw agent CLI
 * - Runs evals on demand (scripted, external subprocess, or HTTP-bridged)
 * - Provides the AgentMonitor for recording events
 */
export class AgentProcess {
  readonly monitor: AgentMonitor;
  private reporter: FarmReporter;
  private backend: MemoryBackend;
  private chatHandler: ChatHandler;
  readonly evalRunner: EvalRunner;
  readonly externalEvalRunner: ExternalEvalRunner;
  readonly evalBridge: EvalBridge;
  private app: ReturnType<typeof express>;
  private server: Server | null = null;
  private actualPort = 0;

  constructor(private config: AgentBaseConfig) {
    this.monitor = new AgentMonitor(config);
    this.reporter = new FarmReporter(config.farmDashboardUrl, config.agentId);
    this.backend = createMemoryBackend(config.memoryVariant, config);
    this.chatHandler = new ChatHandler(config, this.monitor, this.backend);
    this.evalRunner = new EvalRunner(config, this.monitor, this.reporter, this.backend);
    this.externalEvalRunner = new ExternalEvalRunner(config, this.monitor, this.reporter);
    this.evalBridge = new EvalBridge(config, this.monitor, this.reporter, this.chatHandler, this.backend);
    this.app = this.createApp();
  }

  private createApp(): ReturnType<typeof express> {
    const app = express();
    app.use(express.json());
    registerMemoryBackendRoutes(app, this.backend);

    // Status endpoint — farm pulls this
    app.get("/status", (_req, res) => {
      res.json(this.monitor.getStatus());
    });

    // Messages endpoint
    app.get("/messages", (_req, res) => {
      res.json(this.monitor.getMessages());
    });

    // Memory graph endpoint
    app.get("/memory-graph", (_req, res) => {
      res.json(this.monitor.getMemoryGraph());
    });

    // Eval summary endpoint
    app.get("/eval-summary", (_req, res) => {
      res.json(this.monitor.getEvalSummary());
    });

    // List available evals (both scripted and external)
    app.get("/evals", (_req, res) => {
      const scripted = getAllEvalDefinitions().map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        category: d.category,
        maxScore: d.maxScore,
        messageCount: d.messages.length,
        taskCount: d.scoring.length,
        type: "scripted" as const,
      }));
      const external = getAllExternalEvalDefinitions().map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        category: d.category,
        maxScore: d.maxScore,
        messageCount: 0,
        taskCount: 0,
        type: "external" as const,
        defaultDays: d.defaultDays,
      }));
      res.json([...scripted, ...external]);
    });

    // Start an eval run (scripted or external)
    app.post("/eval/start", async (req, res) => {
      const { evalId, clockSpeed, customDelayMs, days, seed, resetMemory } = req.body as {
        evalId?: string;
        clockSpeed?: string;
        customDelayMs?: number;
        days?: number;
        seed?: number;
        resetMemory?: boolean;
      };

      if (!evalId) {
        res.status(400).json({ error: "evalId is required" });
        return;
      }

      // Check if any eval is currently running
      if (this.evalRunner.isRunning() || this.externalEvalRunner.isRunning() || this.evalBridge.isRunning()) {
        res.status(409).json({
          error: "An eval is already running",
          runId: this.evalRunner.getCurrentRunId() ?? this.externalEvalRunner.getCurrentRunId() ?? this.evalBridge.getCurrentRunId(),
        });
        return;
      }

      // Check external evals first, then scripted
      const externalDef = getExternalEvalDefinition(evalId);
      if (externalDef) {
        // Use EvalBridge for agent-mode evals, ExternalEvalRunner for legacy mode
        if (externalDef.agentMode) {
          const runPromise = this.evalBridge.runEval(externalDef, { days, seed, resetMemory });
          runPromise.catch((err) => {
            console.error("[agent-process] Eval bridge run failed:", err);
          });

          await new Promise((resolve) => setTimeout(resolve, 10));

          res.json({
            started: true,
            runId: this.evalBridge.getCurrentRunId(),
            evalId: externalDef.id,
            evalName: externalDef.name,
            type: "external-bridged",
          });
        } else {
          const runPromise = this.externalEvalRunner.runExternalEval(externalDef, { days });
          runPromise.catch((err) => {
            console.error("[agent-process] External eval run failed:", err);
          });

          await new Promise((resolve) => setTimeout(resolve, 10));

          res.json({
            started: true,
            runId: this.externalEvalRunner.getCurrentRunId(),
            evalId: externalDef.id,
            evalName: externalDef.name,
            type: "external",
          });
        }
        return;
      }

      const evalDef = getEvalDefinition(evalId);
      if (!evalDef) {
        res.status(404).json({ error: `Eval "${evalId}" not found` });
        return;
      }

      // Start scripted eval in background
      const runPromise = this.evalRunner.runEval(evalDef, {
        clockSpeed: clockSpeed as any,
        customDelayMs,
      });

      runPromise.catch((err) => {
        console.error("[agent-process] Eval run failed:", err);
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      res.json({
        started: true,
        runId: this.evalRunner.getCurrentRunId(),
        evalId: evalDef.id,
        evalName: evalDef.name,
        type: "scripted",
      });
    });

    // Preflight check for an eval
    app.post("/eval/preflight", async (req, res) => {
      const { evalId } = req.body as { evalId?: string };
      if (!evalId) {
        res.status(400).json({ error: "evalId is required" });
        return;
      }

      const externalDef = getExternalEvalDefinition(evalId);
      if (externalDef) {
        if (externalDef.agentMode) {
          const result = await this.evalBridge.preflight(externalDef);
          res.json(result);
        } else {
          const result = await this.externalEvalRunner.preflight(externalDef);
          res.json(result);
        }
        return;
      }

      const evalDef = getEvalDefinition(evalId);
      if (evalDef) {
        res.json({ ok: true, type: "scripted" });
        return;
      }

      res.status(404).json({ ok: false, error: `Eval "${evalId}" not found` });
    });

    // Get eval run status (covers all runners)
    app.get("/eval/status", (_req, res) => {
      const scriptedRunning = this.evalRunner.isRunning();
      const externalRunning = this.externalEvalRunner.isRunning();
      const bridgeRunning = this.evalBridge.isRunning();
      res.json({
        running: scriptedRunning || externalRunning || bridgeRunning,
        runId: this.evalRunner.getCurrentRunId() ?? this.externalEvalRunner.getCurrentRunId() ?? this.evalBridge.getCurrentRunId(),
        type: bridgeRunning ? "external-bridged" : externalRunning ? "external" : scriptedRunning ? "scripted" : null,
        progress: externalRunning ? this.externalEvalRunner.getProgress() : bridgeRunning ? this.evalBridge.getProgress() : null,
      });
    });

    // SSE endpoint for streaming eval logs
    app.get("/eval/logs", (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send buffered lines as catch-up
      for (const line of this.evalBridge.getLogBuffer()) {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      }

      // Subscribe to new lines
      const unsub = this.evalBridge.subscribeLogs((line) => {
        res.write(`data: ${JSON.stringify(line)}\n\n`);
      });

      req.on("close", unsub);
    });

    // -----------------------------------------------------------------------
    // Eval HTTP contract: eval subprocess ↔ agent-base
    // These endpoints are called by the eval process (e.g., vending-bench --mode agent)
    // -----------------------------------------------------------------------

    // POST /eval/configure — eval tells agent-base where its plugin lives
    app.post("/eval/configure", (req, res) => {
      const { pluginDir, stateFilePath, tools, identity, workspaceFiles } = req.body as {
        pluginDir?: string;
        stateFilePath?: string;
        tools?: string[];
        identity?: string;
        workspaceFiles?: Record<string, string>;
      };

      if (!pluginDir || !stateFilePath || !tools) {
        res.status(400).json({ error: "pluginDir, stateFilePath, and tools are required" });
        return;
      }

      this.chatHandler.configureForEval({ pluginDir, stateFilePath, tools, identity, workspaceFiles });
      const sessionId = this.chatHandler.getSessionId();

      const fileCount = workspaceFiles ? Object.keys(workspaceFiles).length : 0;
      console.log(`[agent-process] Eval configured: plugin=${pluginDir}, tools=${tools.length}, workspaceFiles=${fileCount}`);
      res.json({ ok: true, sessionId });
    });

    // POST /eval/message — eval sends a message, agent-base forwards to openclaw
    app.post("/eval/message", async (req, res) => {
      const { message } = req.body as { message?: string };
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      try {
        const result = await this.chatHandler.handleMessage(message);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // POST /eval/reset — reset the conversation for a new eval run
    app.post("/eval/reset", (_req, res) => {
      this.chatHandler.reset();
      const sessionId = this.chatHandler.getSessionId();
      res.json({ ok: true, sessionId });
    });

    // GET /eval/agent-status — eval checks if agent-base is ready
    app.get("/eval/agent-status", (_req, res) => {
      res.json({
        ready: !this.chatHandler.isBusy(),
        busy: this.chatHandler.isBusy(),
        sessionId: this.chatHandler.getSessionId(),
        evalConfigured: this.chatHandler.isConfiguredForEval(),
      });
    });

    // -----------------------------------------------------------------------
    // Chat endpoint — receive a message, call LLM, return response
    // Uses result.text for backward compatibility with existing callers
    // -----------------------------------------------------------------------
    app.post("/chat", async (req, res) => {
      const { message } = req.body as { message?: string };
      if (!message) {
        res.status(400).json({ error: "message is required" });
        return;
      }
      if (this.evalRunner.isRunning() || this.externalEvalRunner.isRunning() || this.evalBridge.isRunning()) {
        res.status(409).json({ error: "Agent is running an eval — chat disabled" });
        return;
      }
      try {
        const result = await this.chatHandler.handleMessage(message);
        res.json({ reply: result.text });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // Graceful shutdown endpoint — farm can request agent to stop
    app.post("/stop", (_req, res) => {
      res.json({ ok: true, message: "Shutting down" });
      setTimeout(() => this.stop().then(() => process.exit(0)), 100);
    });

    // Health check
    app.get("/health", (_req, res) => {
      res.json({ ok: true, agentId: this.config.agentId });
    });

    return app;
  }

  /** Start the agent process: HTTP server, registration, heartbeat. */
  async start(): Promise<void> {
    // Initialize memory backend with workspace
    await this.backend.init(this.config.workspaceDir);

    // Start HTTP server
    await new Promise<void>((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        const addr = this.server!.address();
        this.actualPort = typeof addr === "object" && addr ? addr.port : this.config.port;
        this.chatHandler.setMemoryBackendBaseUrl(`http://127.0.0.1:${this.actualPort}`);
        console.log(`[agent-process] ${this.config.agentId} listening on port ${this.actualPort}`);
        resolve();
      });
    });

    // Start monitoring
    this.monitor.start();

    // Register with farm
    await this.reporter.register(this.actualPort);

    // Start heartbeat
    this.reporter.startHeartbeat(this.config.reportIntervalMs, () => this.monitor.getStatus());

    console.log(`[agent-process] ${this.config.agentId} (${this.config.memoryVariant}) started`);
  }

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    this.reporter.stopHeartbeat();
    this.monitor.stop();

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
      this.server = null;
    }

    console.log(`[agent-process] ${this.config.agentId} stopped`);
  }

  getPort(): number {
    return this.actualPort;
  }

  getReporter(): FarmReporter {
    return this.reporter;
  }
}
