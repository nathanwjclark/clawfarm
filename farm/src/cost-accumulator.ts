import fs from "node:fs";
import path from "node:path";
import type { CostSnapshot } from "./types.js";

/**
 * Accumulates CostSnapshot time series from live agent heartbeats.
 * Snapshots every 15 minutes, keeps up to 17 entries (4+ hours).
 * Persists to disk so data survives restarts.
 */

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_SNAPSHOTS = 17;
const DATA_DIR = path.join(process.cwd(), "data");
const PERSIST_FILE = path.join(DATA_DIR, "cost-snapshots.json");

const snapshots: CostSnapshot[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let costCallback: (() => Record<string, number>) | null = null;
let persistEnabled = false;

/** Start accumulating cost snapshots on a 15-minute interval. */
export function startCostAccumulator(
  getAgentCosts: () => Record<string, number>,
): void {
  costCallback = getAgentCosts;
  persistEnabled = true;
  loadFromDisk();
  timer = setInterval(() => {
    recordSnapshot(getAgentCosts());
  }, INTERVAL_MS);
}

/** Stop the accumulator timer. */
export function stopCostAccumulator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  costCallback = null;
}

/** Take an immediate snapshot (e.g. on first agent registration). */
export function recordSnapshot(agentCosts: Record<string, number>): void {
  const totalUsd = Object.values(agentCosts).reduce((sum, c) => sum + c, 0);

  // Skip if no agents have costs
  if (totalUsd === 0 && Object.keys(agentCosts).length === 0) return;

  snapshots.push({
    timestamp: new Date().toISOString(),
    totalUsd,
    byAgent: { ...agentCosts },
  });

  // Trim oldest if over capacity
  while (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.shift();
  }

  saveToDisk();
}

/** Get all accumulated snapshots. */
export function getLiveCostSnapshots(): CostSnapshot[] {
  return [...snapshots];
}

/** Reset all snapshots (for testing). */
export function resetCostAccumulator(): void {
  snapshots.length = 0;
  stopCostAccumulator();
  // Clean up persisted file if it exists (test cleanup)
  try {
    if (fs.existsSync(PERSIST_FILE)) fs.unlinkSync(PERSIST_FILE);
  } catch { /* ignore */ }
  persistEnabled = false;
}

function loadFromDisk(): void {
  if (!persistEnabled) return;
  try {
    if (fs.existsSync(PERSIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(PERSIST_FILE, "utf-8")) as CostSnapshot[];
      snapshots.length = 0;
      snapshots.push(...data.slice(-MAX_SNAPSHOTS));
    }
  } catch {
    // Corrupted file — start fresh
  }
}

function saveToDisk(): void {
  if (!persistEnabled) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PERSIST_FILE, JSON.stringify(snapshots, null, 2));
  } catch {
    // Best-effort — don't crash on write failure
  }
}
