/**
 * Agent Spawner — starts agent-base processes from the farm dashboard.
 *
 * Scans agent-base/configs/ for JSON config files, maps variant IDs to configs,
 * and can spawn agent-base processes on demand.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// agent-base lives at ../../agent-base relative to farm/src/
const AGENT_BASE_DIR = path.resolve(__dirname, "../../agent-base");
const CONFIGS_DIR = path.join(AGENT_BASE_DIR, "configs");
const RUNNER_ENTRY = path.join(AGENT_BASE_DIR, "src/runner.ts");

interface AgentConfig {
  agentId: string;
  agentName: string;
  memoryVariant: string;
  port: number;
  [key: string]: unknown;
}

interface SpawnedAgent {
  agentId: string;
  memoryVariant: string;
  port: number;
  configPath: string;
  process: ChildProcess;
  startedAt: string;
}

/** Currently running agent processes spawned by the farm. */
const spawnedAgents = new Map<string, SpawnedAgent>();

/**
 * Discover all agent configs and return a map of variantId -> config info.
 */
export function discoverAgentConfigs(): Array<{
  variantId: string;
  agentId: string;
  configFile: string;
  port: number;
}> {
  const results: Array<{
    variantId: string;
    agentId: string;
    configFile: string;
    port: number;
  }> = [];

  if (!fs.existsSync(CONFIGS_DIR)) return results;

  const files = fs.readdirSync(CONFIGS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(CONFIGS_DIR, file), "utf-8");
      const config = JSON.parse(raw) as AgentConfig;
      results.push({
        variantId: config.memoryVariant,
        agentId: config.agentId,
        configFile: file,
        port: config.port,
      });
    } catch {
      // Skip malformed configs
    }
  }

  return results;
}

/**
 * Spawn an agent-base process for the given variant.
 * Returns the agent ID and port, or throws if no config found.
 */
export function spawnAgent(variantId: string): {
  agentId: string;
  port: number;
  alreadyRunning: boolean;
} {
  // Check if already spawned
  const existing = [...spawnedAgents.values()].find(
    (a) => a.memoryVariant === variantId,
  );
  if (existing) {
    return {
      agentId: existing.agentId,
      port: existing.port,
      alreadyRunning: true,
    };
  }

  // Find config for this variant
  const configs = discoverAgentConfigs();
  const config = configs.find((c) => c.variantId === variantId);
  if (!config) {
    throw new Error(
      `No agent config found for variant "${variantId}". Available: ${configs.map((c) => c.variantId).join(", ")}`,
    );
  }

  const configPath = path.join(CONFIGS_DIR, config.configFile);

  // Spawn the agent-base process
  const child = spawn("npx", ["tsx", RUNNER_ENTRY, "--config", configPath], {
    cwd: AGENT_BASE_DIR,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const entry: SpawnedAgent = {
    agentId: config.agentId,
    memoryVariant: variantId,
    port: config.port,
    configPath,
    process: child,
    startedAt: new Date().toISOString(),
  };

  spawnedAgents.set(config.agentId, entry);

  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.log(`[spawner:${config.agentId}] ${line}`);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.error(`[spawner:${config.agentId}:err] ${line}`);
    }
  });

  child.on("exit", (code) => {
    console.log(
      `[spawner] ${config.agentId} exited with code ${code}`,
    );
    spawnedAgents.delete(config.agentId);
  });

  return {
    agentId: config.agentId,
    port: config.port,
    alreadyRunning: false,
  };
}

/**
 * Get status of all spawned agents.
 */
export function getSpawnedAgents(): Array<{
  agentId: string;
  memoryVariant: string;
  port: number;
  startedAt: string;
}> {
  return [...spawnedAgents.values()].map((a) => ({
    agentId: a.agentId,
    memoryVariant: a.memoryVariant,
    port: a.port,
    startedAt: a.startedAt,
  }));
}

/**
 * Kill all spawned agent processes (for graceful shutdown).
 */
export function killAllSpawnedAgents(): void {
  for (const [id, entry] of spawnedAgents) {
    try {
      entry.process.kill("SIGTERM");
    } catch {}
    spawnedAgents.delete(id);
  }
}
