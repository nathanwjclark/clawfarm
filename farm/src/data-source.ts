import type { AgentStatus, EvalType, MemoryVariant, CostSnapshot, CostConfig, ApiKeyConfig, AgentMemoryGraph, AgentMessage, AgentEvalSummary } from "./types.js";
import {
  getSimulatedAgents, getSimulatedAgent,
  getSimulatedEvalTypes, getSimulatedEvalType,
  getSimulatedVariants, getSimulatedVariant,
  getSimulatedCostHistory, getSimulatedCostConfig, getSimulatedApiKeys,
  getSimulatedMemoryGraph, getSimulatedMessages,
  getSimulatedAgentEvalSummary,
} from "./mock-data.js";
import {
  simIsActive, simGetAgent, simGetMessages, simGetMemoryGraph, simGetEvalSummary,
} from "./sim-runner.js";
import { logAgentStateIfChanged, logDataAccess } from "./logger.js";
import {
  isAgentLive, getLiveAgentStatus,
  fetchAgentMessages, fetchAgentMemoryGraph, fetchAgentEvalSummary,
  getLiveAgentIds, getAgentNameById,
} from "./agent-registry.js";
import { includeMockData, includeLiveAgents } from "./farm-mode.js";
import { getStoredEvalTypes, getStoredEvalType, getStoredVariantPerformance } from "./eval-store.js";
import { getLiveCostSnapshots } from "./cost-accumulator.js";

// This module is the abstraction layer between API routes and data.
// Behavior depends on farm mode:
//   demo: mock data + sim runner only
//   dev:  mock data + sim runner + live agents overlaid
//   prod: live agents only

const SIM_AGENT_ID = "agent-01";

export function getAgents(): AgentStatus[] {
  let result: AgentStatus[] = [];

  // Include mock agents in demo/dev modes
  if (includeMockData()) {
    const agents = getSimulatedAgents();
    if (simIsActive()) {
      result = agents.map(a => a.id === SIM_AGENT_ID ? simGetAgent() : a);
    } else {
      result = [...agents];
    }
  }

  // Overlay live agents in dev/prod modes
  if (includeLiveAgents()) {
    const liveIds = getLiveAgentIds();
    for (const liveId of liveIds) {
      const liveStatus = getLiveAgentStatus(liveId);
      if (!liveStatus) continue;
      const idx = result.findIndex(a => a.id === liveId);
      if (idx >= 0) {
        result[idx] = liveStatus;
      } else {
        result.push(liveStatus);
      }
    }
  }

  for (const a of result) {
    logAgentStateIfChanged(a.id, a.status, null);
  }

  return result;
}

export function getAgent(id: string): AgentStatus | undefined {
  // Check live registry first (dev/prod)
  if (includeLiveAgents() && isAgentLive(id)) {
    const live = getLiveAgentStatus(id);
    if (live) {
      logAgentStateIfChanged(live.id, live.status, null);
      return live;
    }
  }

  // Fall back to mock/sim data (demo/dev)
  if (includeMockData()) {
    let agent: AgentStatus | undefined;
    if (simIsActive() && id === SIM_AGENT_ID) {
      agent = simGetAgent();
    } else {
      agent = getSimulatedAgent(id);
    }
    if (agent) {
      logAgentStateIfChanged(agent.id, agent.status, null);
    }
    return agent;
  }

  return undefined;
}

export function getEvalTypes(): EvalType[] {
  let result: EvalType[] = [];
  if (includeMockData()) {
    result = [...getSimulatedEvalTypes()];
  }
  if (includeLiveAgents()) {
    const realEvals = getStoredEvalTypes(getAgentNameById);
    for (const real of realEvals) {
      const idx = result.findIndex((e) => e.id === real.id);
      if (idx >= 0) {
        result[idx] = mergeEvalType(result[idx], real);
      } else {
        result.push(real);
      }
    }
  }
  return result;
}

export function getEvalType(id: string): EvalType | undefined {
  if (includeLiveAgents()) {
    const real = getStoredEvalType(id, getAgentNameById);
    if (real) {
      if (includeMockData()) {
        const mock = getSimulatedEvalType(id);
        return mock ? mergeEvalType(mock, real) : real;
      }
      return real;
    }
  }
  return includeMockData() ? getSimulatedEvalType(id) : undefined;
}

function mergeEvalType(mock: EvalType, real: EvalType): EvalType {
  // Prepend real runs to mock runs
  const mergedRuns = [...real.recentRuns, ...mock.recentRuns].slice(0, 20);
  // Take whichever highScore is better
  let highScore = mock.highScore;
  if (real.highScore) {
    if (!highScore || real.highScore.score > highScore.score) {
      highScore = real.highScore;
    }
  }
  return {
    ...mock,
    highScore,
    recentRuns: mergedRuns,
  };
}

export function getVariants(): MemoryVariant[] {
  let result: MemoryVariant[] = [];
  if (includeMockData()) {
    result = [...getSimulatedVariants()];
  }
  if (includeLiveAgents()) {
    const realPerf = getStoredVariantPerformance();
    const liveAgents = getLiveAgentIds()
      .map((id) => getLiveAgentStatus(id))
      .filter(Boolean) as AgentStatus[];

    for (const [variantId, perf] of realPerf) {
      const liveAgentIds = liveAgents
        .filter((a) => a.memoryVariant === variantId)
        .map((a) => a.id);
      const idx = result.findIndex((v) => v.id === variantId);
      if (idx >= 0) {
        const merged = { ...result[idx] };
        merged.evalPerformance = { ...merged.evalPerformance, ...perf };
        merged.agents = [...new Set([...merged.agents, ...liveAgentIds])];
        result[idx] = merged;
      } else {
        // Real-only variant (prod mode)
        result.push({
          id: variantId,
          name: variantId,
          dimensionality: "0D",
          description: "",
          writePolicy: "",
          storageType: "",
          retrievalMethod: "",
          agents: liveAgentIds,
          evalPerformance: perf,
        });
      }
    }
  }
  return result;
}

export function getVariant(id: string): MemoryVariant | undefined {
  return getVariants().find((v) => v.id === id);
}

export function getCostHistory(): CostSnapshot[] {
  if (includeLiveAgents()) {
    const realSnapshots = getLiveCostSnapshots();
    if (realSnapshots.length > 0) {
      if (includeMockData()) {
        // Merge: mock snapshots first, then real snapshots appended
        return [...getSimulatedCostHistory(), ...realSnapshots];
      }
      return realSnapshots;
    }
  }
  return includeMockData() ? getSimulatedCostHistory() : [];
}

export function getCostConfig(): CostConfig {
  return includeMockData() ? getSimulatedCostConfig() : {
    globalCapUsd: 100,
    perEvalRunCapUsd: 10,
    warningThresholdPct: 80,
    autoStopOnCap: true,
  };
}

export function getApiKeys(): ApiKeyConfig[] {
  return includeMockData() ? getSimulatedApiKeys() : [];
}

// Memory graph: live agent > sim > mock
export async function getMemoryGraphAsync(agentId: string): Promise<AgentMemoryGraph> {
  if (includeLiveAgents() && isAgentLive(agentId)) {
    const live = await fetchAgentMemoryGraph(agentId);
    if (live) {
      logDataAccess("memory_graph", agentId, live.nodes.length);
      return live;
    }
  }
  return getMemoryGraphSync(agentId);
}

export function getMemoryGraph(agentId: string): AgentMemoryGraph {
  return getMemoryGraphSync(agentId);
}

function getMemoryGraphSync(agentId: string): AgentMemoryGraph {
  if (!includeMockData()) {
    return { nodes: [], edges: [] };
  }
  let graph: AgentMemoryGraph;
  if (simIsActive() && agentId === SIM_AGENT_ID) {
    graph = simGetMemoryGraph();
  } else {
    graph = getSimulatedMemoryGraph(agentId);
  }
  logDataAccess("memory_graph", agentId, graph.nodes.length);
  return graph;
}

// Messages: live agent > sim > mock
export async function getMessagesAsync(agentId: string): Promise<AgentMessage[]> {
  if (includeLiveAgents() && isAgentLive(agentId)) {
    const live = await fetchAgentMessages(agentId);
    if (live) {
      logDataAccess("messages", agentId, live.length);
      return live;
    }
  }
  return getMessagesSync(agentId);
}

export function getMessages(agentId: string): AgentMessage[] {
  return getMessagesSync(agentId);
}

function getMessagesSync(agentId: string): AgentMessage[] {
  if (!includeMockData()) {
    return [];
  }
  let messages: AgentMessage[];
  if (simIsActive() && agentId === SIM_AGENT_ID) {
    messages = simGetMessages();
  } else {
    messages = getSimulatedMessages(agentId);
  }
  logDataAccess("messages", agentId, messages.length);
  return messages;
}

// Eval summary: live agent > sim > mock
export async function getAgentEvalSummaryAsync(agentId: string): Promise<AgentEvalSummary> {
  if (includeLiveAgents() && isAgentLive(agentId)) {
    const live = await fetchAgentEvalSummary(agentId);
    if (live) {
      if (live.lastRun && live.lastRun.status === "completed") {
        logAgentStateIfChanged(agentId, "eval_complete", live.lastRun.score);
      }
      return live;
    }
  }
  return getAgentEvalSummarySync(agentId);
}

export function getAgentEvalSummary(agentId: string): AgentEvalSummary {
  return getAgentEvalSummarySync(agentId);
}

function getAgentEvalSummarySync(agentId: string): AgentEvalSummary {
  if (!includeMockData()) {
    return { lastRun: null, variantBest: null };
  }
  let summary: AgentEvalSummary;
  if (simIsActive() && agentId === SIM_AGENT_ID) {
    summary = simGetEvalSummary();
  } else {
    summary = getSimulatedAgentEvalSummary(agentId);
  }

  if (summary.lastRun && summary.lastRun.status === "completed") {
    logAgentStateIfChanged(agentId, "eval_complete", summary.lastRun.score);
  }

  return summary;
}
