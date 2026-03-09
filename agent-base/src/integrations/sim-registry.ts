import type {
  IntegrationSim,
  IntegrationSimConfig,
  IntegrationType,
  SimAction,
  SimActionResult,
} from "./integration-sim.js";
import { SlackSim } from "./slack-sim.js";
import { EmailSim } from "./email-sim.js";

/**
 * Creates an IntegrationSim from config.
 */
function createSim(config: IntegrationSimConfig): IntegrationSim {
  switch (config.type) {
    case "slack":
      return new SlackSim(config);
    case "email":
      return new EmailSim(config);
    case "discord":
      throw new Error(`Integration sim "${config.type}" not yet implemented`);
    case "telegram":
      throw new Error(`Integration sim "${config.type}" not yet implemented`);
    case "calendar":
      throw new Error(`Integration sim "${config.type}" not yet implemented`);
    default:
      throw new Error(`Unknown integration type: "${config.type}"`);
  }
}

/**
 * Manages a set of active integration sims for a session or eval run.
 * Aggregates context injection across all sims and routes actions to the right sim.
 */
export class SimRegistry {
  private sims = new Map<string, IntegrationSim>();

  constructor(configs?: IntegrationSimConfig[]) {
    if (configs) {
      for (const config of configs) {
        this.register(config);
      }
    }
  }

  /** Register a new integration sim from config. */
  register(config: IntegrationSimConfig): void {
    const key = `${config.type}:${config.name}`;
    if (this.sims.has(key)) {
      throw new Error(`Integration sim "${key}" already registered`);
    }
    this.sims.set(key, createSim(config));
  }

  /** Get a specific sim by type and name. */
  getSim(type: IntegrationType, name: string): IntegrationSim | undefined {
    return this.sims.get(`${type}:${name}`);
  }

  /** Get all registered sims. */
  getAllSims(): IntegrationSim[] {
    return Array.from(this.sims.values());
  }

  /**
   * Get combined context injection text from all sims.
   * Returns empty string if no sims have content to inject.
   */
  getContextInjection(): string {
    const parts: string[] = [];
    for (const sim of this.sims.values()) {
      const ctx = sim.getContextInjection();
      if (ctx) parts.push(ctx);
    }
    return parts.join("\n\n");
  }

  /**
   * Route an action to the appropriate sim.
   * Matches by integration type and name (or first sim of that type if name not specified).
   */
  handleAction(action: SimAction): SimActionResult {
    // Try exact match first
    const exactKey = `${action.integration}:${action.integrationName}`;
    let sim = this.sims.get(exactKey);

    // Fall back to first sim of that type
    if (!sim) {
      for (const s of this.sims.values()) {
        if (s.type === action.integration) {
          sim = s;
          break;
        }
      }
    }

    if (!sim) {
      return {
        success: false,
        description: `No sim registered for integration "${action.integration}:${action.integrationName}"`,
      };
    }

    return sim.handleAction(action);
  }

  /**
   * Process scheduled events across all sims for the given eval progress.
   */
  processScheduledEvents(context: { messageIndex: number; sessionIndex: number }): void {
    for (const sim of this.sims.values()) {
      sim.processScheduledEvents(context);
    }
  }

  /**
   * Get combined action log from all sims.
   */
  getFullActionLog(): Array<{
    simType: IntegrationType;
    simName: string;
    action: SimAction;
    result: SimActionResult;
    timestamp: string;
  }> {
    const log: Array<{
      simType: IntegrationType;
      simName: string;
      action: SimAction;
      result: SimActionResult;
      timestamp: string;
    }> = [];

    for (const sim of this.sims.values()) {
      for (const entry of sim.getActionLog()) {
        log.push({
          simType: sim.type,
          simName: sim.name,
          ...entry,
        });
      }
    }

    return log.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /** Reset all sims to initial state. */
  reset(): void {
    for (const sim of this.sims.values()) {
      sim.reset();
    }
  }

  /** True if any sims are registered. */
  hasIntegrations(): boolean {
    return this.sims.size > 0;
  }
}
