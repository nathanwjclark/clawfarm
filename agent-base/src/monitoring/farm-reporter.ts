import type { AgentStatus, EvalRunResult } from "../types.js";
import type { ExternalEvalProgress } from "../evals/external-eval-definition.js";

/**
 * HTTP client that reports agent status to the farm dashboard.
 * Handles registration, periodic heartbeats, and eval result submission.
 */
export class FarmReporter {
  private farmUrl: string;
  private agentId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private registered = false;

  constructor(farmUrl: string, agentId: string) {
    this.farmUrl = farmUrl.replace(/\/$/, "");
    this.agentId = agentId;
  }

  /** Register this agent with the farm dashboard. */
  async register(agentPort: number): Promise<void> {
    try {
      const res = await fetch(`${this.farmUrl}/api/agents/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: this.agentId,
          baseUrl: `http://localhost:${agentPort}`,
        }),
      });
      if (!res.ok) {
        console.error(`[farm-reporter] Registration failed: ${res.status} ${res.statusText}`);
        return;
      }
      this.registered = true;
      console.log(`[farm-reporter] Registered with farm at ${this.farmUrl}`);
    } catch (err) {
      console.error(`[farm-reporter] Failed to reach farm:`, (err as Error).message);
    }
  }

  /** Start periodic heartbeat reporting. */
  startHeartbeat(intervalMs: number, getStatus: () => AgentStatus): void {
    // Send initial heartbeat immediately
    this.sendHeartbeat(getStatus());

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat(getStatus());
    }, intervalMs);
  }

  /** Stop heartbeat reporting. */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Send a single heartbeat with current agent status. */
  private async sendHeartbeat(status: AgentStatus): Promise<void> {
    try {
      await fetch(`${this.farmUrl}/api/agents/${this.agentId}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status),
      });
    } catch {
      // Silently fail — farm might be down temporarily
    }
  }

  /** Report a completed eval run to the farm. */
  async reportEvalResult(result: EvalRunResult): Promise<void> {
    try {
      const res = await fetch(`${this.farmUrl}/api/agents/${this.agentId}/eval-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      if (!res.ok) {
        console.error(`[farm-reporter] Eval result submission failed: ${res.status}`);
      }
    } catch (err) {
      console.error(`[farm-reporter] Failed to report eval result:`, (err as Error).message);
    }
  }

  /** Report eval progress (for long-running external evals). */
  async reportEvalProgress(
    runId: string,
    evalId: string,
    memoryVariant: string,
    progress: ExternalEvalProgress,
  ): Promise<void> {
    try {
      const res = await fetch(`${this.farmUrl}/api/agents/${this.agentId}/eval-progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, evalId, memoryVariant, progress }),
      });
      if (!res.ok) {
        console.error(`[farm-reporter] Progress report failed: ${res.status}`);
      }
    } catch {
      // Silently fail — farm might be down temporarily
    }
  }

  isRegistered(): boolean {
    return this.registered;
  }
}
