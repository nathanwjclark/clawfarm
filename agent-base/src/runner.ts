import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { parseConfig } from "./config.js";
import { AgentProcess } from "./lifecycle/agent-process.js";

/**
 * Load .env from the project root (clawfarm/) so the agent process
 * inherits API keys even when started independently of start.sh.
 * Only sets vars that aren't already in the environment.
 */
function loadEnvFile(): void {
  // Walk up from agent-base/src to find the project root .env
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),  // if cwd is agent-base/ or farm/
    path.resolve(import.meta.dirname, "../../.env"),  // relative to agent-base/src/
  ];

  for (const envPath of candidates) {
    if (fsSync.existsSync(envPath)) {
      const content = fsSync.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        // Only set if not already in environment
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      break;
    }
  }
}

/**
 * Main entry point for the agent base image.
 * Usage: tsx src/runner.ts --config <path-to-config.json>
 *
 * Starts an agent process, registers with the farm, and begins the eval/run loop.
 */

async function main() {
  // Load .env before anything else
  loadEnvFile();
  // Parse CLI args
  const configArg = process.argv.indexOf("--config");
  if (configArg === -1 || !process.argv[configArg + 1]) {
    console.error("Usage: tsx src/runner.ts --config <path-to-config.json>");
    process.exit(1);
  }
  const configPath = path.resolve(process.argv[configArg + 1]);

  // Load and parse config
  const rawConfig = JSON.parse(await fs.readFile(configPath, "utf-8"));
  const config = parseConfig(rawConfig);

  // Ensure workspace dir exists
  await fs.mkdir(config.workspaceDir, { recursive: true });

  // Warn if API key is missing (external evals like vending-bench need it)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[runner] WARNING: ANTHROPIC_API_KEY is not set. External evals will fail.");
    console.warn("[runner] Add ANTHROPIC_API_KEY=sk-ant-... to your .env file in the project root.");
  }

  // Start agent process (HTTP server + monitoring + farm registration)
  const agent = new AgentProcess(config);
  await agent.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[runner] Shutting down...");
    await agent.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Evals are triggered via HTTP from the farm dashboard (POST /eval/start).
  // The agent sits online reporting status until commands arrive.
  console.log(`[runner] Agent ${config.agentId} is online. Waiting for eval commands...`);
  console.log(`[runner] Reporting to farm at ${config.farmDashboardUrl}`);
}

main().catch((err) => {
  console.error("[runner] Fatal error:", err);
  process.exit(1);
});
