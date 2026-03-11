import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import apiRouter from "./routes/api.js";
import { logApiRequest, logSystem } from "./logger.js";
import { setFarmMode, getFarmMode } from "./farm-mode.js";
import { startCostAccumulator, stopCostAccumulator } from "./cost-accumulator.js";
import { getLiveAgentCosts, getLiveAgentIds } from "./agent-registry.js";
import { loadEvalStore } from "./eval-store.js";
import { killAllSpawnedAgents } from "./agent-spawner.js";
import { startSleepGuard, stopSleepGuard } from "./sleep-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (two levels up from farm/src/)
// __dirname = farm/src/ → project root = ../../
dotenv.config({ path: path.resolve(__dirname, "../..", ".env") });
const PORT = 3847;

// Parse mode from FARM_MODE env var or --mode CLI flag
const modeArg = process.argv.indexOf("--mode");
const mode = (modeArg >= 0 && process.argv[modeArg + 1])
  ? process.argv[modeArg + 1]
  : process.env.FARM_MODE || "dev";
setFarmMode(mode as any);

const app = express();

app.use(express.json());

// Request logging middleware — captures every API call with timing
app.use("/api", (req, res, next) => {
  const start = performance.now();
  const originalEnd = res.end.bind(res);

  res.end = function (...args: Parameters<typeof res.end>) {
    const duration = performance.now() - start;
    logApiRequest(req.method, req.originalUrl, res.statusCode, duration);
    return originalEnd(...args);
  } as typeof res.end;

  next();
});

app.use("/api", apiRouter);
app.use(express.static(path.join(__dirname, "public")));

// Load persisted eval data and start cost accumulator for live agent modes
if (getFarmMode() !== "demo") {
  loadEvalStore();
  startCostAccumulator(getLiveAgentCosts);
  startSleepGuard(() => getLiveAgentIds().length > 0);
}

const server = app.listen(PORT, () => {
  logSystem("startup", { port: PORT, mode: getFarmMode() });
  console.log(`Clawfarm dashboard running at http://localhost:${PORT} [mode: ${getFarmMode()}]`);
});

// Graceful shutdown
const shutdown = () => {
  killAllSpawnedAgents();
  stopCostAccumulator();
  stopSleepGuard();
  server.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
