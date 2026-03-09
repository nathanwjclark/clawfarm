import type { AgentStatus, AgentMemoryGraph, AgentMessage, AgentEvalSummary } from "./types.js";
import { SIM_MESSAGES, SIM_MEMORY_GRAPH } from "./sim-data.js";
import { logSimEvent } from "./logger.js";

// SIMULATED: E2E test runner that plays back SIM_MESSAGES one step per second.
// Provides live-updating agent state, messages, memory graph, and eval progress.

interface SimState {
  status: "idle" | "running" | "paused" | "completed";
  step: number;           // current message index (0-based)
  totalSteps: number;
  startedAt: string | null;
  uptimeSeconds: number;
  evalScore: number | null;
  evalMaxScore: number | null;
}

let state: SimState = {
  status: "idle",
  step: 0,
  totalSteps: SIM_MESSAGES.length,
  startedAt: null,
  uptimeSeconds: 0,
  evalScore: null,
  evalMaxScore: null,
};

let tickTimer: ReturnType<typeof setInterval> | null = null;

function tick() {
  if (state.status !== "running") return;

  state.uptimeSeconds++;

  if (state.step < SIM_MESSAGES.length) {
    const msg = SIM_MESSAGES[state.step];

    // Log each message delivery
    logSimEvent("tick", {
      step: state.step,
      totalSteps: state.totalSteps,
      messageId: msg.id,
      role: msg.role,
      tokenCount: msg.tokenCount,
      uptimeSeconds: state.uptimeSeconds,
      contentPreview: msg.content.slice(0, 120),
    });

    // Check for eval completion in this message
    if (msg.role === "system" && msg.content.includes("[Eval Complete]")) {
      const scoreMatch = msg.content.match(/Score: ([\d.]+)\/([\d.]+)/);
      if (scoreMatch) {
        state.evalScore = parseFloat(scoreMatch[1]);
        state.evalMaxScore = parseFloat(scoreMatch[2]);
        logSimEvent("eval_complete", {
          score: state.evalScore,
          maxScore: state.evalMaxScore,
          pct: ((state.evalScore / state.evalMaxScore) * 100).toFixed(1),
          step: state.step,
        });
      }
    }

    // Log session boundaries
    if (msg.role === "system" && msg.content.includes("[Session Start]")) {
      const sessionMatch = msg.content.match(/Session (\d+) of (\d+)/);
      logSimEvent("session_start", {
        session: sessionMatch ? parseInt(sessionMatch[1]) : null,
        totalSessions: sessionMatch ? parseInt(sessionMatch[2]) : null,
        step: state.step,
      });
    }

    state.step++;
  }

  // Complete after delivering the last message
  if (state.step >= SIM_MESSAGES.length) {
    state.status = "completed";
    logSimEvent("complete", {
      totalSteps: state.totalSteps,
      uptimeSeconds: state.uptimeSeconds,
      evalScore: state.evalScore,
      evalMaxScore: state.evalMaxScore,
    });
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
}

export function simStart(): SimState {
  if (state.status === "running") return state;

  const prevStatus = state.status;

  if (state.status === "idle" || state.status === "completed") {
    state = {
      status: "running",
      step: 0,
      totalSteps: SIM_MESSAGES.length,
      startedAt: new Date().toISOString(),
      uptimeSeconds: 0,
      evalScore: null,
      evalMaxScore: null,
    };
  } else if (state.status === "paused") {
    state.status = "running";
  }

  logSimEvent("start", { prevStatus, step: state.step, totalSteps: state.totalSteps });

  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);

  return state;
}

export function simStop(): SimState {
  if (state.status === "running") {
    state.status = "paused";
    logSimEvent("pause", { step: state.step, uptimeSeconds: state.uptimeSeconds });
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  return state;
}

export function simReset(): SimState {
  logSimEvent("reset", { prevStep: state.step, prevUptime: state.uptimeSeconds, prevStatus: state.status });
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  state = {
    status: "idle",
    step: 0,
    totalSteps: SIM_MESSAGES.length,
    startedAt: null,
    uptimeSeconds: 0,
    evalScore: null,
    evalMaxScore: null,
  };
  return state;
}

export function simGetStatus(): SimState {
  return { ...state };
}

export function simIsActive(): boolean {
  return state.status === "running" || state.status === "paused" || state.status === "completed";
}

// ---------------------------------------------------------------------------
// Data overlays — when sim is active, agent-01 data comes from here
// ---------------------------------------------------------------------------

export function simGetAgent(): AgentStatus {
  const deliveredMessages = SIM_MESSAGES.slice(0, state.step);
  const totalTokens = deliveredMessages.reduce((s, m) => s + m.tokenCount, 0);
  const sessions = new Set(deliveredMessages.map(m => m.id.split("-")[0]));

  // Count non-tool, non-system messages as "processed"
  const processed = deliveredMessages.filter(m => m.role !== "system").length;

  // Estimate cost: rough Claude pricing — $3/M input, $15/M output, $0.30/M cache
  const inputTokens = totalTokens;
  const outputTokens = deliveredMessages.filter(m => m.role === "assistant").reduce((s, m) => s + m.tokenCount, 0);
  const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  return {
    id: "agent-01",
    name: "native-baseline",
    memoryVariant: "native-0d",
    status: state.status === "running" ? "online" : state.status === "paused" ? "online" : "offline",
    uptimeSeconds: state.uptimeSeconds,
    lastHeartbeat: new Date().toISOString(),
    mode: "eval",
    messagesProcessed: processed,
    sessionsTotal: sessions.size,
    sessionsActive: state.status === "running" ? 1 : 0,
    contextTokensUsed: totalTokens,
    contextTokensAvailable: 200_000,
    costInputTokens: inputTokens,
    costOutputTokens: outputTokens,
    costCacheReadTokens: 0,
    costEstimatedUsd: parseFloat(costUsd.toFixed(4)),
    metrics: {
      avg_response_ms: processed > 0 ? 850 + Math.floor(Math.random() * 200) : 0,
      memory_recall_accuracy: state.evalScore !== null ? state.evalScore / state.evalMaxScore! : 0,
      fact_retention_rate: state.step > 20 ? 1.0 : state.step > 10 ? 0.5 : 0,
      compaction_events: 0,
    },
    integrations: [
      { name: "Eval Runner", type: "api", status: state.status === "running" ? "connected" : "disconnected", lastCheck: new Date().toISOString() },
    ],
  };
}

export function simGetMessages(): AgentMessage[] {
  // Return delivered messages with real timestamps relative to sim start
  const delivered = SIM_MESSAGES.slice(0, state.step);
  if (!state.startedAt) return delivered;

  const startMs = new Date(state.startedAt).getTime();
  return delivered.map((m, i) => ({
    ...m,
    // Space timestamps 1 second apart from sim start
    timestamp: new Date(startMs + i * 1000).toISOString(),
  }));
}

export function simGetMemoryGraph(): AgentMemoryGraph {
  // Progressively reveal graph nodes based on which messages have been delivered
  // Session 1 (s1-*): core + daily + camera topic + mount/sensor facts
  // Session 2 (s2-*): + lens topic + use case
  // Session 3 (s3-*): + accessories topic + cards/battery/hotshoe facts + budget

  const delivered = SIM_MESSAGES.slice(0, state.step);
  const sessionIds = new Set(delivered.map(m => m.id.split("-")[0]));

  const allNodes = SIM_MEMORY_GRAPH.nodes;
  const allEdges = SIM_MEMORY_GRAPH.edges;

  let visibleNodeIds: Set<string>;

  if (sessionIds.has("s3")) {
    // All nodes visible
    visibleNodeIds = new Set(allNodes.map(n => n.id));
  } else if (sessionIds.has("s2")) {
    visibleNodeIds = new Set(["core", "daily-0307", "topic-camera", "topic-lens", "topic-usecase", "fact-mount", "fact-sensor"]);
  } else if (sessionIds.has("s1")) {
    // Check if we've gotten to the memory_write messages
    const hasWrites = delivered.some(m => m.content.includes("memory_write"));
    if (hasWrites) {
      visibleNodeIds = new Set(["core", "daily-0307", "topic-camera", "fact-mount", "fact-sensor"]);
    } else {
      visibleNodeIds = new Set(["core", "daily-0307"]);
    }
  } else {
    visibleNodeIds = new Set(["core"]);
  }

  const nodes = allNodes.filter(n => visibleNodeIds.has(n.id));
  const edges = allEdges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));

  return { nodes, edges };
}

export function simGetEvalSummary(): AgentEvalSummary {
  if (state.evalScore !== null) {
    return {
      lastRun: {
        evalId: "eval-constraint-prop",
        evalName: "Constraint Propagation",
        score: state.evalScore,
        maxScore: state.evalMaxScore!,
        completedAt: new Date().toISOString(),
        status: "completed",
      },
      variantBest: {
        evalId: "eval-constraint-prop",
        evalName: "Constraint Propagation",
        score: state.evalScore,
        maxScore: state.evalMaxScore!,
        agentName: "native-baseline",
        achievedAt: new Date().toISOString(),
      },
    };
  }

  if (state.status === "running" || state.status === "paused") {
    return {
      lastRun: {
        evalId: "eval-constraint-prop",
        evalName: "Constraint Propagation",
        score: 0,
        maxScore: 8,
        completedAt: "",
        status: "running",
      },
      variantBest: null,
    };
  }

  return { lastRun: null, variantBest: null };
}
