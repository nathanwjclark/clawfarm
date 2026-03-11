import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { discoverAgentConfigs, spawnAgent, getSpawnedAgents, killAllSpawnedAgents } from "../src/agent-spawner.js";

describe("Agent Spawner", () => {
  it("discovers agent configs from agent-base/configs/", () => {
    const configs = discoverAgentConfigs();
    expect(configs.length).toBeGreaterThanOrEqual(3);

    const variantIds = configs.map((c) => c.variantId);
    expect(variantIds).toContain("native-0d");
    expect(variantIds).toContain("three-layer-1d");
    expect(variantIds).toContain("five-day-1d");

    // Each config has required fields
    for (const c of configs) {
      expect(c.agentId).toBeTruthy();
      expect(c.configFile).toMatch(/\.json$/);
      expect(c.port).toBeGreaterThan(0);
    }
  });

  it("throws when spawning unknown variant", () => {
    expect(() => spawnAgent("nonexistent-variant")).toThrow(/No agent config found/);
  });

  describe("spawn and register flow", () => {
    const FARM_PORT = 3860; // Use a non-standard port so we don't conflict
    let farmServer: ReturnType<typeof import("express")["default"]> extends (...args: any) => infer R ? R : never;
    let httpServer: import("http").Server;

    // Minimal farm server that accepts agent registration
    beforeAll(async () => {
      const express = (await import("express")).default;
      const app = express();
      app.use(express.json());

      // Minimal registration endpoint
      app.post("/api/agents/register", (req, res) => {
        res.json({ success: true, agentId: req.body.agentId });
      });

      // Minimal heartbeat endpoint
      app.post("/api/agents/:id/heartbeat", (_req, res) => {
        res.json({ ok: true });
      });

      await new Promise<void>((resolve) => {
        httpServer = app.listen(FARM_PORT, resolve);
      });
    });

    afterAll(async () => {
      killAllSpawnedAgents();
      // Wait a bit for processes to exit
      await new Promise((r) => setTimeout(r, 500));
      if (httpServer) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });

    it("spawns an agent and it becomes reachable", async () => {
      // Note: this test requires agent-base configs to point farmDashboardUrl
      // to a reachable server. The spawned agent will try to register with
      // http://localhost:3847. We use port 3860 so registration will fail,
      // but the agent's own HTTP server should still come up.

      const result = spawnAgent("native-0d");
      expect(result.agentId).toBe("agent-live-01");
      expect(result.port).toBe(3900);
      expect(result.alreadyRunning).toBe(false);

      // Second spawn should return alreadyRunning
      const result2 = spawnAgent("native-0d");
      expect(result2.alreadyRunning).toBe(true);

      // Check spawned list
      const spawned = getSpawnedAgents();
      expect(spawned.length).toBe(1);
      expect(spawned[0].agentId).toBe("agent-live-01");

      // Wait for the agent's HTTP server to come up
      let agentReachable = false;
      for (let i = 0; i < 15; i++) {
        try {
          const res = await fetch(`http://localhost:${result.port}/health`, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) {
            agentReachable = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }

      expect(agentReachable).toBe(true);
    }, 20000);
  });
});
