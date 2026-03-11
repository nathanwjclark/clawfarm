import { spawn, type ChildProcess } from "node:child_process";
import { platform } from "node:os";
import { logSystem } from "./logger.js";

/**
 * Prevents macOS idle sleep while agents are running.
 * Spawns `caffeinate -i` when agents come online, kills it when all go offline.
 * Screen can still turn off; only idle sleep is blocked.
 * No-op on non-macOS platforms.
 */

let caffeinateProc: ChildProcess | null = null;
let checkInterval: ReturnType<typeof setInterval> | null = null;
let liveAgentCheck: (() => boolean) | null = null;

export function startSleepGuard(hasLiveAgents: () => boolean): void {
  if (platform() !== "darwin") return;
  liveAgentCheck = hasLiveAgents;

  // Check every 10 seconds whether we need caffeinate
  checkInterval = setInterval(syncCaffeinate, 10_000);
}

export function stopSleepGuard(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  killCaffeinate();
}

/** Called when an agent registers — immediately start caffeinate if needed. */
export function onAgentActivity(): void {
  if (platform() !== "darwin") return;
  if (!caffeinateProc && liveAgentCheck?.()) {
    spawnCaffeinate();
  }
}

function syncCaffeinate(): void {
  const live = liveAgentCheck?.() ?? false;
  if (live && !caffeinateProc) {
    spawnCaffeinate();
  } else if (!live && caffeinateProc) {
    killCaffeinate();
  }
}

function spawnCaffeinate(): void {
  if (caffeinateProc) return;
  try {
    // -i = prevent idle sleep, -w = tied to this PID (auto-cleanup if farm crashes)
    caffeinateProc = spawn("caffeinate", ["-i", "-w", String(process.pid)], {
      stdio: "ignore",
      detached: false,
    });
    caffeinateProc.on("exit", () => { caffeinateProc = null; });
    logSystem("sleep-guard: caffeinate started (idle sleep prevented while agents are running)");
  } catch {
    // caffeinate not available — ignore silently
    caffeinateProc = null;
  }
}

function killCaffeinate(): void {
  if (!caffeinateProc) return;
  caffeinateProc.kill();
  caffeinateProc = null;
  logSystem("sleep-guard: caffeinate stopped (no agents running, sleep allowed)");
}
