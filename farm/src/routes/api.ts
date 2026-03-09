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
import { storeEvalResult, storeEvalMetadata, storeEvalProgress } from "../eval-store.js";
import type { AgentStatus } from "../types.js";
import type { EvalMetadata } from "../eval-store.js";

// Track clockSpeed from eval start requests so we can attach it to results
const evalClockSpeeds = new Map<string, "fast" | "real-world" | "custom">();

const router = Router();

// Farm config — exposes mode to the frontend
router.get("/config", (_req, res) => {
  res.json({ mode: getFarmMode() });
});

// Agents
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
    progress?: { current: number; total: number; label?: string; score?: number };
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
  const { evalId, clockSpeed, customDelayMs, days } = req.body as {
    evalId?: string;
    clockSpeed?: string;
    customDelayMs?: number;
    days?: number;
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
      body: JSON.stringify({ evalId, clockSpeed, customDelayMs, days }),
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
