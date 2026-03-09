import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Structured logging system for Clawfarm
// ---------------------------------------------------------------------------
// Captures all events visible in the dashboard so they can be reviewed later.
// Logs are JSONL (one JSON object per line) for easy parsing and grep.
//
// Log categories:
//   api        — every HTTP request/response (method, path, status, duration)
//   sim        — simulation lifecycle (start, stop, reset, tick, complete)
//   agent      — agent state changes (status transitions, eval scores)
//   data       — data access patterns (which data was fetched, sizes)
//   action     — user-triggered mutations (stop-all, config changes)
//   system     — server lifecycle (startup, shutdown, errors)

export type LogCategory = "api" | "sim" | "agent" | "data" | "action" | "system";

export interface LogEntry {
  ts: string;          // ISO timestamp
  cat: LogCategory;    // category
  event: string;       // event name (e.g. "api.request", "sim.start")
  data?: Record<string, unknown>;  // event-specific payload
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LOG_DIR = path.join(process.cwd(), "logs");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file before rotation

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentStream: fs.WriteStream | null = null;
let currentFilePath: string | null = null;
let currentFileSize = 0;
let initialized = false;

// In-memory ring buffer for recent events (queryable via API)
const RING_BUFFER_SIZE = 1000;
const recentEvents: LogEntry[] = [];

// Track agent state for change detection
const lastAgentState: Record<string, { status: string; evalScore: number | null }> = {};

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function ensureInit() {
  if (initialized) return;
  initialized = true;

  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  openNewLogFile();

  log("system", "logger.init", {
    logDir: LOG_DIR,
    maxFileSize: MAX_FILE_SIZE,
    ringBufferSize: RING_BUFFER_SIZE,
  });
}

function openNewLogFile() {
  if (currentStream) {
    currentStream.end();
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  currentFilePath = path.join(LOG_DIR, `clawfarm-${timestamp}.jsonl`);
  currentStream = fs.createWriteStream(currentFilePath, { flags: "a" });
  currentFileSize = 0;
}

function rotateIfNeeded() {
  if (currentFileSize >= MAX_FILE_SIZE) {
    openNewLogFile();
    log("system", "log.rotated", { newFile: currentFilePath });
  }
}

// ---------------------------------------------------------------------------
// Core logging
// ---------------------------------------------------------------------------

export function log(cat: LogCategory, event: string, data?: Record<string, unknown>) {
  ensureInit();

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    cat,
    event,
    data,
  };

  // Write to file
  const line = JSON.stringify(entry) + "\n";
  if (currentStream) {
    currentStream.write(line);
    currentFileSize += Buffer.byteLength(line);
    rotateIfNeeded();
  }

  // Add to ring buffer
  recentEvents.push(entry);
  if (recentEvents.length > RING_BUFFER_SIZE) {
    recentEvents.shift();
  }
}

// ---------------------------------------------------------------------------
// Query interface
// ---------------------------------------------------------------------------

export interface LogQuery {
  cat?: LogCategory;
  event?: string;       // prefix match (e.g. "sim" matches "sim.start", "sim.tick")
  since?: string;       // ISO timestamp
  limit?: number;       // max results (default 100)
}

export function queryLogs(query: LogQuery): LogEntry[] {
  let results = recentEvents;

  if (query.cat) {
    results = results.filter(e => e.cat === query.cat);
  }

  if (query.event) {
    results = results.filter(e => e.event.startsWith(query.event));
  }

  if (query.since) {
    results = results.filter(e => e.ts >= query.since);
  }

  const limit = query.limit ?? 100;
  return results.slice(-limit);
}

// Get all log files for full-history queries
export function getLogFiles(): string[] {
  ensureInit();
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith(".jsonl"))
    .sort()
    .map(f => path.join(LOG_DIR, f));
}

// ---------------------------------------------------------------------------
// Specialized loggers
// ---------------------------------------------------------------------------

// API request/response logging (used as Express middleware)
export function logApiRequest(method: string, path: string, statusCode: number, durationMs: number, meta?: Record<string, unknown>) {
  log("api", "api.request", {
    method,
    path,
    status: statusCode,
    durationMs: Math.round(durationMs * 100) / 100,
    ...meta,
  });
}

// Simulation events
export function logSimEvent(event: string, state: Record<string, unknown>) {
  log("sim", `sim.${event}`, state);
}

// Agent state change detection
export function logAgentStateIfChanged(agentId: string, status: string, evalScore: number | null) {
  const prev = lastAgentState[agentId];
  const changed = !prev || prev.status !== status || prev.evalScore !== evalScore;

  if (changed) {
    log("agent", "agent.state_change", {
      agentId,
      status,
      evalScore,
      prevStatus: prev?.status ?? null,
      prevEvalScore: prev?.evalScore ?? null,
    });
    lastAgentState[agentId] = { status, evalScore };
  }
}

// Data access logging
export function logDataAccess(source: string, agentId: string | null, resultSize: number) {
  log("data", "data.access", { source, agentId, resultSize });
}

// User action logging
export function logAction(action: string, details?: Record<string, unknown>) {
  log("action", `action.${action}`, details);
}

// System events
export function logSystem(event: string, details?: Record<string, unknown>) {
  log("system", `system.${event}`, details);
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

export function flushAndClose() {
  if (currentStream) {
    log("system", "logger.shutdown", {});
    currentStream.end();
    currentStream = null;
  }
}

process.on("SIGINT", () => { flushAndClose(); process.exit(0); });
process.on("SIGTERM", () => { flushAndClose(); process.exit(0); });
