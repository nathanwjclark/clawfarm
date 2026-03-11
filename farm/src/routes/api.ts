import { Router } from "express";
import {
  getAgents, getAgent,
  getEvalTypes, getEvalType,
  getVariants, getVariant,
  getCostHistory, getCostConfig, getApiKeys,
  getMemoryGraph, getMessages,
  getAgentEvalSummary,
  getMemoryGraphAsync, getMessagesAsync, getAgentEvalSummaryAsync,
} from "../data-source.js";
import { simStart, simStop, simReset, simGetStatus } from "../sim-runner.js";
import { logAction, queryLogs, getLogFiles } from "../logger.js";
import { registerAgent, updateHeartbeat, isAgentLive, getAllRegisteredAgents, getAgentNameById } from "../agent-registry.js";
import { getFarmMode, includeLiveAgents, includeMockData } from "../farm-mode.js";
import { storeEvalResult, storeEvalMetadata, storeEvalProgress, getProgressHistory, getChartHistory, getRunProfile, getAllEvalRuns } from "../eval-store.js";
import type { AgentStatus } from "../types.js";
import type { EvalMetadata } from "../eval-store.js";
import { discoverAgentConfigs, spawnAgent, getSpawnedAgents } from "../agent-spawner.js";

// Track clockSpeed from eval start requests so we can attach it to results
const evalClockSpeeds = new Map<string, "fast" | "real-world" | "custom">();

const router = Router();

// Farm config — exposes mode to the frontend
router.get("/config", (_req, res) => {
  res.json({ mode: getFarmMode() });
});

// Agents

// Spawner routes must come before /agents/:id to avoid matching "spawn"/"spawned" as an ID
router.post("/agents/spawn", (req, res) => {
  if (!includeLiveAgents()) {
    res.status(404).json({ error: "Agent spawning not available in demo mode" });
    return;
  }
  const { variantId } = req.body as { variantId?: string };
  if (!variantId) {
    res.status(400).json({ error: "variantId is required" });
    return;
  }
  try {
    const result = spawnAgent(variantId);
    logAction("agent_spawn", { variantId, agentId: result.agentId, port: result.port, alreadyRunning: result.alreadyRunning });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
router.get("/agents/spawned", (_req, res) => {
  res.json(getSpawnedAgents());
});

router.get("/agents", (_req, res) => { res.json(getAgents()); });
router.get("/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});
router.get("/agents/:id/eval-summary", async (req, res) => {
  if (isAgentLive(req.params.id)) {
    res.json(await getAgentEvalSummaryAsync(req.params.id));
  } else {
    res.json(getAgentEvalSummary(req.params.id));
  }
});
router.get("/agents/:id/memory-graph", async (req, res) => {
  if (isAgentLive(req.params.id)) {
    res.json(await getMemoryGraphAsync(req.params.id));
  } else {
    res.json(getMemoryGraph(req.params.id));
  }
});
router.get("/agents/:id/messages", async (req, res) => {
  if (isAgentLive(req.params.id)) {
    res.json(await getMessagesAsync(req.params.id));
  } else {
    res.json(getMessages(req.params.id));
  }
});

// Evals
router.get("/evals", (_req, res) => { res.json(getEvalTypes()); });
router.get("/evals/:id", (req, res) => {
  const evalType = getEvalType(req.params.id);
  if (!evalType) { res.status(404).json({ error: "Eval not found" }); return; }
  res.json(evalType);
});

// Variants
router.get("/variants", (_req, res) => { res.json(getVariants()); });
router.get("/variants/:id", (req, res) => {
  const variant = getVariant(req.params.id);
  if (!variant) { res.status(404).json({ error: "Variant not found" }); return; }
  res.json(variant);
});

// Cost
router.get("/cost/history", (_req, res) => { res.json(getCostHistory()); });
router.get("/cost/config", (_req, res) => { res.json(getCostConfig()); });
router.get("/cost/keys", (_req, res) => { res.json(getApiKeys()); });

// Simulation runner (demo/dev only)
router.get("/sim/status", (_req, res) => {
  if (!includeMockData()) { res.status(404).json({ error: "Sim not available in prod mode" }); return; }
  res.json(simGetStatus());
});
router.post("/sim/start", (_req, res) => {
  if (!includeMockData()) { res.status(404).json({ error: "Sim not available in prod mode" }); return; }
  res.json(simStart());
});
router.post("/sim/stop", (_req, res) => {
  if (!includeMockData()) { res.status(404).json({ error: "Sim not available in prod mode" }); return; }
  res.json(simStop());
});
router.post("/sim/reset", (_req, res) => {
  if (!includeMockData()) { res.status(404).json({ error: "Sim not available in prod mode" }); return; }
  res.json(simReset());
});

// ---------------------------------------------------------------------------
// Agent registration — live agents register themselves with the farm (dev/prod)
// ---------------------------------------------------------------------------
router.post("/agents/register", (req, res) => {
  if (!includeLiveAgents()) {
    res.status(404).json({ error: "Live agents not available in demo mode" });
    return;
  }
  const { agentId, baseUrl } = req.body as { agentId?: string; baseUrl?: string };
  if (!agentId || !baseUrl) {
    res.status(400).json({ error: "agentId and baseUrl are required" });
    return;
  }
  registerAgent(agentId, baseUrl);
  logAction("agent_register", { agentId, baseUrl });

  // Fire-and-forget: fetch eval metadata from newly registered agent
  fetchEvalMetadataFromAgent(baseUrl).catch(() => {});

  res.json({ success: true, agentId });
});

router.post("/agents/:id/heartbeat", (req, res) => {
  const status = req.body as AgentStatus;
  updateHeartbeat(req.params.id, status);
  res.json({ ok: true });
});

router.post("/agents/:id/eval-progress", (req, res) => {
  const { runId, evalId, memoryVariant, progress } = req.body as {
    runId?: string;
    evalId?: string;
    memoryVariant?: string;
    progress?: { current: number; total: number; label?: string; score?: number; costUsd?: number; elapsedMs?: number; memoryTokens?: number; turnProfile?: { wallMs: number; chatHandlerMs: number; openclawMs: number; bootstrapMs: number; llmApiMs: number; toolExecMs: number } };
  };
  if (!runId || !evalId || !progress) {
    res.status(400).json({ error: "runId, evalId, and progress are required" });
    return;
  }
  const agentName = getAgentNameById(req.params.id);
  const clockSpeed = evalClockSpeeds.get(req.params.id) || "fast";
  storeEvalProgress(runId, req.params.id, evalId, memoryVariant ?? "", agentName, clockSpeed, progress);
  res.json({ ok: true });
});

// Progress history for charting — returns time-series data for all active eval runs
router.get("/eval-progress-history", (_req, res) => {
  res.json(getProgressHistory());
});

// Chart history — combines live progress + persisted checkpoints from recent completed runs
// Use this for dashboard charts so they always show the most recent data
router.get("/eval-chart-history", (_req, res) => {
  res.json(getChartHistory());
});

// All eval runs (flat list for the Runs view)
router.get("/eval-runs", (_req, res) => {
  res.json(getAllEvalRuns(getAgentNameById, isAgentLive));
});

// Per-run profiling data (timing breakdown per day) — live from progress history
router.get("/eval-runs/:runId/profile", (req, res) => {
  const profile = getRunProfile(req.params.runId);
  if (!profile) {
    res.status(404).json({ error: "No profile data for this run" });
    return;
  }
  res.json(profile);
});

// Per-run profiling summary (persisted, available after completion)
router.get("/eval-runs/:runId/profiling-summary", (req, res) => {
  const runs = getAllEvalRuns(getAgentNameById);
  const run = runs.find((r) => r.id === req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (!run.profilingSummary) {
    res.status(404).json({ error: "No profiling data for this run" });
    return;
  }
  res.json(run.profilingSummary);
});

router.post("/agents/:id/eval-result", (req, res) => {
  const result = req.body;
  const agentName = getAgentNameById(req.params.id);
  const clockSpeed = evalClockSpeeds.get(req.params.id) || "fast";
  evalClockSpeeds.delete(req.params.id);
  storeEvalResult(result, agentName, clockSpeed);
  logAction("eval_result_stored", { agentId: req.params.id, runId: result.runId, score: result.score });
  res.json({ ok: true });
});

// Eval preflight — check if an eval can run (API key, paths, etc.)
router.post("/agents/:id/eval/preflight", async (req, res) => {
  const { evalId } = req.body as { evalId?: string };
  if (!evalId) {
    res.status(400).json({ ok: false, error: "evalId is required" });
    return;
  }
  if (!isAgentLive(req.params.id)) {
    res.status(404).json({ ok: false, error: "Agent is not live" });
    return;
  }
  try {
    const registry = getAllRegisteredAgents();
    const entry = registry.get(req.params.id);
    if (!entry) {
      res.status(404).json({ ok: false, error: "Agent not registered" });
      return;
    }
    const agentRes = await fetch(`${entry.baseUrl}/eval/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evalId }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await agentRes.json();
    res.status(agentRes.ok ? 200 : agentRes.status).json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Eval trigger — start an eval on a live agent
router.post("/agents/:id/eval/start", async (req, res) => {
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
  if (!isAgentLive(req.params.id)) {
    res.status(404).json({ error: "Agent is not live" });
    return;
  }
  try {
    const registry = getAllRegisteredAgents();
    const entry = registry.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "Agent not registered" });
      return;
    }
    // Track clockSpeed so we can attach it to the result when it arrives
    evalClockSpeeds.set(req.params.id, (clockSpeed as "fast" | "real-world" | "custom") || "fast");

    const agentRes = await fetch(`${entry.baseUrl}/eval/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evalId, clockSpeed, customDelayMs, days, seed, resetMemory }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await agentRes.json();
    if (!agentRes.ok) {
      res.status(agentRes.status).json(data);
      return;
    }
    logAction("eval_started", { agentId: req.params.id, evalId });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// SSE proxy for streaming eval logs from a live agent
router.get("/agents/:id/eval/logs", async (req, res) => {
  if (!isAgentLive(req.params.id)) {
    res.status(404).json({ error: "Agent is not live" });
    return;
  }
  const registry = getAllRegisteredAgents();
  const entry = registry.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: "Agent not registered" });
    return;
  }

  // Pipe SSE from agent to client
  try {
    const agentRes = await fetch(`${entry.baseUrl}/eval/logs`);
    if (!agentRes.ok || !agentRes.body) {
      res.status(502).json({ error: "Could not connect to agent log stream" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const reader = agentRes.body.getReader();
    const decoder = new TextDecoder();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } catch {}
      res.end();
    };
    pump();

    req.on("close", () => {
      reader.cancel().catch(() => {});
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// Get available evals from a live agent
router.get("/agents/:id/evals", async (req, res) => {
  if (!isAgentLive(req.params.id)) {
    res.status(404).json({ error: "Agent is not live" });
    return;
  }
  try {
    const registry = getAllRegisteredAgents();
    const entry = registry.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "Agent not registered" });
      return;
    }
    const agentRes = await fetch(`${entry.baseUrl}/evals`, {
      signal: AbortSignal.timeout(3_000),
    });
    const data = await agentRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Chat relay — forward a message to a live agent and return the response
router.post("/agents/:id/chat", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (!isAgentLive(req.params.id)) {
    res.status(404).json({ error: "Agent is not live" });
    return;
  }
  try {
    const registry = getAllRegisteredAgents();
    const entry = registry.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: "Agent not registered" });
      return;
    }
    const agentRes = await fetch(`${entry.baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(135_000),
    });
    const data = await agentRes.json();
    if (!agentRes.ok) {
      res.status(agentRes.status).json(data);
      return;
    }
    logAction("chat_message", { agentId: req.params.id, messageLength: message.length });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Stop all live agents by sending POST /stop to each
router.post("/stop-all", async (_req, res) => {
  const registry = getAllRegisteredAgents();
  const stopResults: Record<string, string> = {};
  for (const [agentId, entry] of registry) {
    if (!isAgentLive(agentId)) continue;
    try {
      await fetch(`${entry.baseUrl}/stop`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      stopResults[agentId] = "stopped";
    } catch {
      stopResults[agentId] = "failed";
    }
  }
  logAction("stop_all", { source: "dashboard", results: stopResults });
  res.json({ success: true, results: stopResults });
});

// ---------------------------------------------------------------------------
// Agent spawner — config discovery
// ---------------------------------------------------------------------------

router.get("/agent-configs", (_req, res) => {
  res.json(discoverAgentConfigs());
});

// ---------------------------------------------------------------------------
// Logs API — query the event log
// ---------------------------------------------------------------------------

// GET /api/logs?cat=sim&event=sim.tick&since=2026-03-07T00:00:00Z&limit=50
router.get("/logs", (req, res) => {
  const results = queryLogs({
    cat: req.query.cat as any,
    event: req.query.event as string | undefined,
    since: req.query.since as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
  });
  res.json(results);
});

// GET /api/logs/files — list all log files on disk
router.get("/logs/files", (_req, res) => {
  res.json(getLogFiles());
});

// Fetch eval definitions from an agent and store as metadata
async function fetchEvalMetadataFromAgent(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/evals`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return;
  const defs = (await res.json()) as Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    taskCount: number;
    maxScore: number;
  }>;
  for (const def of defs) {
    storeEvalMetadata({
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category as EvalMetadata["category"] ?? "recall",
      taskCount: def.taskCount,
      maxScore: def.maxScore,
    });
  }
}

export default router;
