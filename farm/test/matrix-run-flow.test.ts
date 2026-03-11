/**
 * Integration test: Matrix "Run" flow
 *
 * Tests the full cycle that the matrix UI performs:
 * 1. Farm starts in prod mode on port 3847 (matching agent configs)
 * 2. Spawn an offline agent via POST /api/agents/spawn
 * 3. Wait for the agent to register (poll GET /api/agents)
 * 4. Start an eval via POST /api/agents/:id/eval/start
 * 5. Verify the eval is accepted (or returns a clear error, not "fetch failed")
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import apiRouter from "../src/routes/api.js";
import { setFarmMode } from "../src/farm-mode.js";
import { loadEvalStore } from "../src/eval-store.js";
import { killAllSpawnedAgents } from "../src/agent-spawner.js";
import { registerAgent, isAgentLive, unregisterAgent } from "../src/agent-registry.js";

// Use a random available port for the test server to avoid conflicts with running farm.
// Note: spawned agents hardcode farmDashboardUrl=3847 in their configs, so the spawn→register
// integration test only works when port 3847 is free. Tests that rely on actual agent registration
// are skipped when port 3847 is unavailable.
let FARM_PORT = 0;

describe("Matrix Run Flow", () => {
  let server: Server;
  let portIs3847 = false;

  beforeAll(async () => {
    setFarmMode("prod");
    loadEvalStore();

    const app = express();
    app.use(express.json());
    app.use("/api", apiRouter);

    // Try port 3847 first (needed for spawn→register integration); fall back to random port
    await new Promise<void>((resolve) => {
      const tryServer = app.listen(3847);
      tryServer.on("listening", () => {
        server = tryServer;
        FARM_PORT = 3847;
        portIs3847 = true;
        resolve();
      });
      tryServer.on("error", () => {
        // Port 3847 in use — use random port for non-spawn tests
        const fallback = app.listen(0, () => {
          server = fallback;
          FARM_PORT = (fallback.address() as any).port;
          resolve();
        });
      });
    });
  });

  afterAll(async () => {
    killAllSpawnedAgents();
    await new Promise((r) => setTimeout(r, 1500));
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("GET /api/agent-configs returns available configs", async () => {
    const res = await fetch(`http://localhost:${FARM_PORT}/api/agent-configs`);
    expect(res.ok).toBe(true);
    const configs = await res.json();
    expect(Array.isArray(configs)).toBe(true);

    const variantIds = configs.map((c: any) => c.variantId);
    expect(variantIds).toContain("native-0d");
  });

  it("GET /api/agents/spawned returns array", async () => {
    const res = await fetch(`http://localhost:${FARM_PORT}/api/agents/spawned`);
    expect(res.ok).toBe(true);
    const spawned = await res.json();
    expect(Array.isArray(spawned)).toBe(true);
  });

  it("registered agent appears in GET /api/agents immediately", async () => {
    // Simulate agent registration (without actually spawning a process)
    registerAgent("test-agent-123", "http://localhost:9999");

    const res = await fetch(`http://localhost:${FARM_PORT}/api/agents`);
    expect(res.ok).toBe(true);
    const agents = (await res.json()) as any[];
    const testAgent = agents.find((a: any) => a.id === "test-agent-123");
    expect(testAgent).toBeTruthy();
    expect(testAgent.status).toBe("online");

    // Also verify isAgentLive
    expect(isAgentLive("test-agent-123")).toBe(true);

    // Cleanup
    unregisterAgent("test-agent-123");
  });

  it("eval/start returns 404 for unregistered agent (not fetch-failed crash)", async () => {
    const evalRes = await fetch(
      `http://localhost:${FARM_PORT}/api/agents/nonexistent-agent/eval/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evalId: "vending-bench", days: 1, clockSpeed: "fast" }),
      },
    );
    expect(evalRes.status).toBe(404);
    const data = await evalRes.json();
    expect(data.error).toContain("not live");
  });

  it("POST /api/agents/spawn starts agent that registers and becomes live", async () => {
    if (!portIs3847) return; // Skip — agents register to port 3847, need that port

    const spawnRes = await fetch(`http://localhost:${FARM_PORT}/api/agents/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: "native-0d" }),
    });
    expect(spawnRes.ok).toBe(true);
    const spawnData = await spawnRes.json();
    expect(spawnData.agentId).toBe("agent-live-01");
    expect(spawnData.port).toBe(3900);

    // Poll until the agent registers with our farm (up to 45s — npx tsx cold start can be slow)
    let agentOnline = false;
    for (let i = 0; i < 45; i++) {
      try {
        const agentsRes = await fetch(`http://localhost:${FARM_PORT}/api/agents`);
        const agents = (await agentsRes.json()) as any[];
        const agent = agents.find((a: any) => a.id === spawnData.agentId);
        if (agent && agent.status === "online") {
          agentOnline = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(agentOnline).toBe(true);

    // Now that agent is registered, eval/start should proxy to the agent
    const evalRes = await fetch(
      `http://localhost:${FARM_PORT}/api/agents/${spawnData.agentId}/eval/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evalId: "vending-bench", days: 1, clockSpeed: "fast" }),
      },
    );
    // Should be proxied to agent — not 404 "not live"
    expect(evalRes.status).not.toBe(404);
    const evalData = await evalRes.json();
    if (evalData.error) {
      expect(evalData.error).not.toContain("not live");
    }
  }, 60000);

  it("POST /api/agents/spawn rejects unknown variant", async () => {
    const res = await fetch(`http://localhost:${FARM_PORT}/api/agents/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: "nonexistent" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No agent config found");
  });

  it("POST /api/agents/spawn rejects missing variantId", async () => {
    const res = await fetch(`http://localhost:${FARM_PORT}/api/agents/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("variantId is required");
  });
});
