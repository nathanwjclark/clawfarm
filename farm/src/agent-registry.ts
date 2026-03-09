import type { AgentStatus, AgentMemoryGraph, AgentMessage, AgentEvalSummary } from "./types.js";
import { logSystem } from "./logger.js";

interface RegisteredAgent {
  agentId: string;
  baseUrl: string;
  lastHeartbeat: number;
  lastStatus: AgentStatus | null;
}

const OFFLINE_THRESHOLD_MULTIPLIER = 3;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

// In-memory registry of live agent processes
const registry = new Map<string, RegisteredAgent>();

export function registerAgent(agentId: string, baseUrl: string): void {
  registry.set(agentId, {
    agentId,
    baseUrl: baseUrl.replace(/\/$/, ""),
    lastHeartbeat: Date.now(),
    lastStatus: null,
  });
  logSystem(`Agent registered: ${agentId} at ${baseUrl}`);
}

export function updateHeartbeat(agentId: string, status: AgentStatus): void {
  const entry = registry.get(agentId);
  if (entry) {
    entry.lastHeartbeat = Date.now();
    entry.lastStatus = status;
  }
}

export function isAgentLive(agentId: string): boolean {
  const entry = registry.get(agentId);
  if (!entry) return false;
  const elapsed = Date.now() - entry.lastHeartbeat;
  return elapsed < DEFAULT_HEARTBEAT_INTERVAL_MS * OFFLINE_THRESHOLD_MULTIPLIER;
}

export function getLiveAgentStatus(agentId: string): AgentStatus | null {
  const entry = registry.get(agentId);
  if (!entry || !isAgentLive(agentId)) return null;
  return entry.lastStatus;
}

export function getLiveAgentIds(): string[] {
  return [...registry.keys()].filter(isAgentLive);
}

/** Fetch data from a live agent's HTTP endpoint. Returns null on failure. */
async function fetchFromAgent<T>(agentId: string, path: string): Promise<T | null> {
  const entry = registry.get(agentId);
  if (!entry || !isAgentLive(agentId)) return null;
  try {
    const res = await fetch(`${entry.baseUrl}${path}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export async function fetchAgentMessages(agentId: string): Promise<AgentMessage[] | null> {
  return fetchFromAgent<AgentMessage[]>(agentId, "/messages");
}

export async function fetchAgentMemoryGraph(agentId: string): Promise<AgentMemoryGraph | null> {
  return fetchFromAgent<AgentMemoryGraph>(agentId, "/memory-graph");
}

export async function fetchAgentEvalSummary(agentId: string): Promise<AgentEvalSummary | null> {
  return fetchFromAgent<AgentEvalSummary>(agentId, "/eval-summary");
}

export function getAllRegisteredAgents(): Map<string, RegisteredAgent> {
  return registry;
}

export function unregisterAgent(agentId: string): void {
  registry.delete(agentId);
}

/** Get agent name from last heartbeat status, falls back to agentId. */
export function getAgentNameById(agentId: string): string {
  const entry = registry.get(agentId);
  return entry?.lastStatus?.name ?? agentId;
}

/** Get cost estimates for all live agents: {agentId: costEstimatedUsd}. */
export function getLiveAgentCosts(): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const [agentId, entry] of registry) {
    if (!isAgentLive(agentId)) continue;
    costs[agentId] = entry.lastStatus?.costEstimatedUsd ?? 0;
  }
  return costs;
}
