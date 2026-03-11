import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { AgentBaseConfig } from "../config.js";
import type { SimRegistry } from "../integrations/sim-registry.js";
import type { MemoryBackend } from "../memory/memory-backend.js";
import type { AgentMonitor } from "../monitoring/agent-monitor.js";
import type { AgentMessage } from "../types.js";

/**
 * Handles chat messages by invoking openclaw's agent CLI.
 * Each message runs: node openclaw.mjs agent --local --json --session-id <id> --message <text>
 * This gives us the full openclaw agent with memory, tools, compaction, etc.
 *
 * When configured for eval mode via `configureForEval()`, the openclaw.json
 * includes plugin paths and tool allow-lists from the eval.
 */

interface AgentCliResult {
  payloads?: Array<{ text?: string; mediaUrl?: string | null }>;
  meta: {
    durationMs: number;
    agentMeta?: {
      sessionId: string;
      provider: string;
      model: string;
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
      toolCalls?: number;
      toolExecutions?: number;
      timing?: {
        bootstrapMs?: number;
        llmApiMs?: number;
        toolExecMs?: number;
        llmCallCount?: number;
        toolExecCount?: number;
      };
    };
    error?: { kind: string; message: string };
  };
}

/** Per-LLM-call profiling data from openclaw. */
export interface LlmCallProfile {
  callIndex: number;
  callType: "initial" | "tool_followup";
  totalMs: number;
  ttfcMs?: number;
  generationMs?: number;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  toolCallsRequested: number;
}

/** Profiling timing data from a single agent turn. All values in milliseconds. */
export interface TurnProfile {
  /** Total time in chat handler (handleMessage entry to exit). */
  chatHandlerMs: number;
  /** Total time in openclaw subprocess (execFile). */
  openclawMs?: number;
  /** Openclaw internal breakdown (from agentMeta.timing). */
  openclaw?: {
    bootstrapMs?: number;
    llmApiMs?: number;
    toolExecMs?: number;
    llmCallCount?: number;
    toolExecCount?: number;
    llmCallProfiles?: LlmCallProfile[];
  };
}

/** Rich return type from handleMessage — includes tool calls, token usage, and stderr. */
export interface MessageResult {
  text: string;
  toolCalls: number;
  tokenUsage?: { input: number; output: number; cacheRead?: number };
  stderr?: string;
  /** Profiling timing data for this turn. */
  profile?: TurnProfile;
}

/** Configuration for eval plugin support. */
export interface EvalPluginConfig {
  pluginDir: string;
  stateFilePath: string;
  tools: string[];
  identity?: string;
  /**
   * Workspace bootstrap files to write (e.g. AGENTS.md, SOUL.md, TOOLS.md).
   * Keys are filenames, values are contents. Always overwritten on configure.
   */
  workspaceFiles?: Record<string, string>;
}

// Path to the openclaw repo (sibling of clawfarm)
const OPENCLAW_DIR = path.resolve(import.meta.dirname, "../../../../openclaw");
const OPENCLAW_ENTRY = path.join(OPENCLAW_DIR, "openclaw.mjs");

export class ChatHandler {
  private sessionId: string;
  private sessionStarted = false;
  private msgCounter = 0;
  private busy = false;
  private openclawHomeReady: Promise<string> | null = null;

  private simRegistry: SimRegistry | null = null;
  private evalPluginConfig: EvalPluginConfig | null = null;
  private memoryBackendBaseUrl: string | null = null;

  constructor(
    private config: AgentBaseConfig,
    private monitor: AgentMonitor,
    private backend: MemoryBackend,
  ) {
    this.sessionId = `clawfarm-${config.agentId}-${Date.now().toString(36)}`;
  }

  /** Attach integration sims that will inject context into prompts. */
  setSimRegistry(registry: SimRegistry | null): void {
    this.simRegistry = registry;
  }

  setMemoryBackendBaseUrl(url: string | null): void {
    this.memoryBackendBaseUrl = url;
  }

  /**
   * Configure for eval mode: stores plugin config and invalidates
   * the openclaw home so the next call regenerates openclaw.json
   * with plugin paths and tool allow-lists.
   */
  configureForEval(opts: EvalPluginConfig): void {
    this.evalPluginConfig = opts;
    // Invalidate so next ensureOpenclawHome() regenerates config
    this.openclawHomeReady = null;
  }

  /**
   * Send a message, invoke openclaw, return rich result.
   * The /chat endpoint extracts .text for backward compatibility.
   */
  async handleMessage(userContent: string): Promise<MessageResult> {
    if (this.busy) {
      throw new Error("Agent is busy processing a previous message");
    }
    this.busy = true;
    const handleStart = Date.now();

    try {
      // Start session on first message
      if (!this.sessionStarted) {
        this.sessionStarted = true;
        this.monitor.recordSessionStart();
      }

      // Record user message
      const userMsg = this.createMessage("user", userContent);
      this.monitor.recordMessageProcessed(userMsg);

      // Ask memory backend for context to inject
      const memoryContext = await this.backend.recall(this.monitor.getMessages());

      // Get integration context if sims are active
      const integrationContext = this.simRegistry?.getContextInjection() ?? "";

      // Build prompt — inject context before the user message
      let prompt = userContent;
      const contextParts: string[] = [];
      if (memoryContext) {
        contextParts.push(`[Memory Context]\n${memoryContext}\n[End Memory Context]`);
      }
      if (integrationContext) {
        contextParts.push(`[Integration Context]\n${integrationContext}\n[End Integration Context]`);
      }
      if (contextParts.length > 0) {
        prompt = `${contextParts.join("\n\n")}\n\n${userContent}`;
      }

      // Call openclaw agent CLI
      const { result, stderr, openclawMs } = await this.callOpenClawAgent(prompt);

      // Extract response text
      const responseText = result.payloads
        ?.map(p => p.text)
        .filter(Boolean)
        .join("\n") || "(no response)";

      // Count tool calls from meta
      let toolCalls = 0;
      const agentMeta = result.meta.agentMeta;
      if (agentMeta) {
        if (typeof agentMeta.toolCalls === "number") toolCalls = agentMeta.toolCalls;
        if (typeof agentMeta.toolExecutions === "number" && agentMeta.toolExecutions > toolCalls) {
          toolCalls = agentMeta.toolExecutions;
        }
      }
      // Estimate from payloads if not reported
      if (toolCalls === 0 && result.payloads && result.payloads.length > 1) {
        toolCalls = result.payloads.length - 1;
      }
      // Fallback: count tool call evidence from stderr
      if (toolCalls === 0 && stderr) {
        const toolExecPattern = /executing.*tool|tool.*execute|→.*tool/gi;
        const matches = stderr.match(toolExecPattern);
        if (matches) toolCalls = matches.length;
      }

      // Record token usage from the real API call
      const usage = agentMeta?.usage;
      if (usage) {
        this.monitor.recordTokenUsage({
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
        });
      }

      // Record assistant message
      const assistantMsg = this.createMessage("assistant", responseText);
      this.monitor.recordMessageProcessed(assistantMsg);

      // Consolidate memory (fire-and-forget)
      this.backend
        .consolidate(userContent, responseText, this.monitor.getMessages())
        .catch((err) => console.error("[chat-handler] Consolidation error:", err));

      // Update graph for dashboard (fire-and-forget)
      this.backend
        .extractGraph()
        .then((graph) => this.monitor.setMemoryGraph(graph))
        .catch((err) => console.error("[chat-handler] Graph extraction error:", err));

      // Build profiling data
      const chatHandlerMs = Date.now() - handleStart;
      const openclawTiming = agentMeta?.timing;
      const profile: TurnProfile = {
        chatHandlerMs,
        openclawMs,
        openclaw: openclawTiming ? {
          bootstrapMs: openclawTiming.bootstrapMs,
          llmApiMs: openclawTiming.llmApiMs,
          toolExecMs: openclawTiming.toolExecMs,
          llmCallCount: openclawTiming.llmCallCount,
          toolExecCount: openclawTiming.toolExecCount,
          llmCallProfiles: openclawTiming.llmCallProfiles,
        } : undefined,
      };

      return {
        text: responseText,
        toolCalls,
        tokenUsage: usage
          ? { input: usage.input ?? 0, output: usage.output ?? 0, cacheRead: usage.cacheRead }
          : undefined,
        stderr: stderr || undefined,
        profile,
      };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Ensure we have an OPENCLAW_HOME directory with openclaw.json
   * that points at the agent's workspace. This makes openclaw read/write
   * memory files in our controlled directory instead of ~/.openclaw/workspace.
   *
   * When eval plugin is configured, includes plugins.load.paths and tools.alsoAllow.
   *
   * Config goes to $OPENCLAW_HOME/.openclaw/openclaw.json (openclaw's state dir).
   */
  private async ensureOpenclawHome(): Promise<string> {
    if (!this.openclawHomeReady) {
      this.openclawHomeReady = (async () => {
        const homeDir = path.join(this.config.workspaceDir, ".openclaw-home");
        const stateDir = path.join(homeDir, ".openclaw");
        await fs.mkdir(stateDir, { recursive: true });

        // Base config from memory backend
        const configObj: Record<string, unknown> = {
          ...this.backend.generateOpenclawConfig(this.config.workspaceDir),
        };

        // Set model from agent-base config (e.g. "anthropic/claude-sonnet-4-6")
        const agentDefaults = (configObj.agents as Record<string, any>)?.defaults ?? {};
        agentDefaults.model = { primary: `${this.config.provider}/${this.config.model}` };
        (configObj.agents as Record<string, any>).defaults = agentDefaults;

        // If eval plugin is configured, add plugin paths and tool allow-list
        if (this.evalPluginConfig) {
          const pluginDir = path.resolve(this.evalPluginConfig.pluginDir);
          configObj.plugins = {
            enabled: true,
            load: { paths: [pluginDir] },
          };
          configObj.tools = {
            profile: "full",
            alsoAllow: this.evalPluginConfig.tools,
          };
        }

        await fs.writeFile(
          path.join(stateDir, "openclaw.json"),
          JSON.stringify(configObj, null, 2),
        );

        // Provision auth profiles so openclaw can authenticate
        await this.provisionAuthProfiles(homeDir);

        // Seed workspace files for eval (bootstrap marker, identity, persona files)
        if (this.evalPluginConfig) {
          await this.seedEvalWorkspace(this.evalPluginConfig);
        }

        return homeDir;
      })();
    }
    return this.openclawHomeReady;
  }

  private async callOpenClawAgent(message: string): Promise<{ result: AgentCliResult; stderr: string; openclawMs: number }> {
    const openclawHome = await this.ensureOpenclawHome();
    const spawnStart = Date.now();

    return new Promise((resolve, reject) => {
      const args = [
        OPENCLAW_ENTRY,
        "agent",
        "--local",
        "--json",
        "--session-id", this.sessionId,
        "--message", message,
        "--timeout", "300",
      ];

      const env: Record<string, string | undefined> = {
        ...process.env,
        // Point openclaw at our controlled home dir with workspace config
        OPENCLAW_HOME: openclawHome,
      };
      if (this.memoryBackendBaseUrl) {
        env.OPENCLAW_EXTERNAL_MEMORY_URL = this.memoryBackendBaseUrl;
      }

      // Pass state file path for eval plugin tools
      if (this.evalPluginConfig?.stateFilePath) {
        env.VENDING_STATE_FILE = path.resolve(this.evalPluginConfig.stateFilePath);
      }

      execFile("node", args, {
        cwd: OPENCLAW_DIR,
        env,
        maxBuffer: 10 * 1024 * 1024, // 10MB for large responses
        timeout: 310_000, // slightly over the agent timeout
        killSignal: "SIGKILL", // ensure child dies on timeout
      }, (err, stdout, stderr) => {
        if (err) {
          const execErr = err as ExecFileException;
          if (execErr.killed || execErr.signal === "SIGKILL") {
            reject(new Error("openclaw agent timed out"));
            return;
          }
          if (!stdout) {
            reject(new Error(`openclaw agent failed: ${stderr || err.message}`));
            return;
          }
        }

        try {
          // stdout may contain non-JSON lines before the JSON envelope
          // (e.g. ANSI-colored "[plugins] vending-bench: registered 14 tools").
          // The JSON envelope may be pretty-printed (multi-line).
          // Strategy: strip ANSI codes, find the first '{' that starts a JSON object,
          // then parse from there to the end.
          const clean = stdout.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI
          let result: AgentCliResult | null = null;

          // Try parsing the whole output first
          try {
            result = JSON.parse(clean) as AgentCliResult;
          } catch {
            // Find the first top-level '{' that starts the JSON envelope
            const jsonStart = clean.indexOf("\n{");
            if (jsonStart >= 0) {
              try {
                result = JSON.parse(clean.slice(jsonStart + 1)) as AgentCliResult;
              } catch {
                // Try from the very first '{'
                const firstBrace = clean.indexOf("{");
                if (firstBrace >= 0) {
                  try {
                    result = JSON.parse(clean.slice(firstBrace)) as AgentCliResult;
                  } catch {
                    // give up
                  }
                }
              }
            }
          }

          if (!result) {
            reject(new Error(`Failed to parse openclaw output: ${stdout.slice(0, 500)}`));
            return;
          }
          if (result.meta?.error) {
            reject(new Error(`Agent error (${result.meta.error.kind}): ${result.meta.error.message}`));
            return;
          }
          resolve({ result, stderr: stderr || "", openclawMs: Date.now() - spawnStart });
        } catch {
          reject(new Error(`Failed to parse openclaw output: ${stdout.slice(0, 500)}`));
        }
      });
    });
  }

  /**
   * Provision openclaw's auth-profiles.json from the ANTHROPIC_API_KEY env var.
   * Adapted from vending-bench's battle-tested chat-handler.
   */
  private async provisionAuthProfiles(openclawHome: string): Promise<void> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;

    const agentDir = path.join(openclawHome, ".openclaw", "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true });

    const authStore = {
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: apiKey,
        },
      },
    };

    const authPath = path.join(agentDir, "auth-profiles.json");
    await fs.writeFile(authPath, JSON.stringify(authStore, null, 2), { mode: 0o600 });
  }

  /**
   * Seed workspace with eval bootstrap files.
   * Adapted from vending-bench's battle-tested seedWorkspace().
   *
   * Creates:
   * - .openclaw/workspace-state.json bootstrap marker (once)
   * - memory/ directory
   * - IDENTITY.md if identity string provided
   * - Any files from workspaceFiles (e.g. AGENTS.md, SOUL.md, TOOLS.md)
   *   These are always overwritten to ensure correct persona per run.
   */
  private async seedEvalWorkspace(evalConfig: EvalPluginConfig): Promise<void> {
    const ws = this.config.workspaceDir;

    // Create workspace bootstrap marker (only if it doesn't exist)
    const statePath = path.join(ws, ".openclaw", "workspace-state.json");
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    try {
      await fs.access(statePath);
    } catch {
      await fs.writeFile(
        statePath,
        JSON.stringify({ bootstrapped: true, createdAt: new Date().toISOString() }),
      );
    }

    // Ensure memory directory exists
    await fs.mkdir(path.join(ws, "memory"), { recursive: true });

    const composedFiles = await this.backend.composeEvalWorkspaceFiles({
      identity: evalConfig.identity,
      workspaceFiles: evalConfig.workspaceFiles,
    });

    for (const [filename, content] of Object.entries(composedFiles)) {
      await fs.mkdir(path.dirname(path.join(ws, filename)), { recursive: true });
      await fs.writeFile(path.join(ws, filename), content);
    }
  }

  private createMessage(role: "user" | "assistant", content: string): AgentMessage {
    this.msgCounter++;
    const tokenEstimate = Math.ceil(content.length / 4);
    return {
      id: `chat-${this.msgCounter}`,
      timestamp: new Date().toISOString(),
      role,
      content,
      tokenCount: tokenEstimate,
    };
  }

  isBusy(): boolean {
    return this.busy;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** Whether the handler is currently configured for eval mode. */
  isConfiguredForEval(): boolean {
    return this.evalPluginConfig !== null;
  }

  reset(): void {
    this.sessionId = `clawfarm-${this.config.agentId}-${Date.now().toString(36)}`;
    this.sessionStarted = false;
    this.msgCounter = 0;
    this.busy = false;
    this.openclawHomeReady = null;
    this.evalPluginConfig = null;
    // Don't reset simRegistry — it persists across session resets within an eval
  }
}
