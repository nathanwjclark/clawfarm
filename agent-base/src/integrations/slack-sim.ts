import type {
  IntegrationSim,
  IntegrationSimConfig,
  SimAction,
  SimActionResult,
  SimEvent,
  SimMessage,
} from "./integration-sim.js";

/**
 * Simulates a Slack workspace with channels and messages.
 * Injects channel history as context and captures agent send/reply actions.
 */
export class SlackSim implements IntegrationSim {
  readonly type = "slack" as const;
  readonly name: string;
  readonly config: IntegrationSimConfig;

  private messages: SimMessage[];
  private deterministicQueue: SimMessage[];
  private actionLog: Array<{ action: SimAction; result: SimActionResult; timestamp: string }> = [];
  private pendingEvents: SimEvent[];

  constructor(config: IntegrationSimConfig) {
    if (config.type !== "slack") {
      throw new Error(`SlackSim requires type "slack", got "${config.type}"`);
    }
    this.config = config;
    this.name = config.name;
    this.messages = [...config.initialMessages];
    this.deterministicQueue =
      config.responseMode.type === "deterministic"
        ? [...config.responseMode.responses]
        : [];
    this.pendingEvents = [...(config.scheduledEvents ?? [])];
  }

  getContextInjection(): string {
    if (this.messages.length === 0) return "";

    // Group messages by channel
    const byChannel = new Map<string, SimMessage[]>();
    for (const msg of this.messages) {
      const ch = msg.channel ?? "#general";
      if (!byChannel.has(ch)) byChannel.set(ch, []);
      byChannel.get(ch)!.push(msg);
    }

    const unread = this.messages.filter((m) => !m.read);
    const lines: string[] = [];
    lines.push(`**Slack (${this.name})** — ${unread.length} unread message(s)`);

    for (const [channel, msgs] of byChannel) {
      const channelUnread = msgs.filter((m) => !m.read);
      if (channelUnread.length === 0 && msgs.length > 5) {
        lines.push(`  ${channel}: ${msgs.length} messages (all read)`);
        continue;
      }

      lines.push(`  ${channel}:`);
      // Show recent messages (last 10 per channel)
      const recent = msgs.slice(-10);
      for (const msg of recent) {
        const unreadMarker = msg.read ? "" : " [NEW]";
        lines.push(`    [${msg.timestamp}] ${msg.from}: ${msg.content}${unreadMarker}`);
      }
    }

    return lines.join("\n");
  }

  handleAction(action: SimAction): SimActionResult {
    // Add the agent's outgoing message
    const outgoing: SimMessage = {
      id: `slack-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: "you",
      content: action.content,
      timestamp: new Date().toISOString(),
      channel: action.target ?? "#general",
      read: true,
    };
    this.messages.push(outgoing);

    // Generate a reply based on response mode
    let response: SimMessage | undefined;

    if (this.config.responseMode.type === "deterministic") {
      response = this.deterministicQueue.shift();
      if (response) {
        // Place the response in the same channel
        response = {
          ...response,
          channel: response.channel ?? outgoing.channel,
          timestamp: new Date().toISOString(),
        };
        this.messages.push(response);
      }
    } else {
      // LLM-automated mode — not yet implemented
      throw new Error("LLM-automated response mode is not yet implemented");
    }

    const result: SimActionResult = {
      success: true,
      response,
      description: response
        ? `Sent message to ${outgoing.channel}. ${response.from} replied: "${response.content.slice(0, 80)}..."`
        : `Sent message to ${outgoing.channel}. No reply.`,
    };

    this.actionLog.push({
      action,
      result,
      timestamp: new Date().toISOString(),
    });

    return result;
  }

  injectEvent(event: SimEvent): void {
    if (event.trigger === "immediate") {
      this.messages.push({ ...event.data, read: false });
    } else {
      this.pendingEvents.push(event);
    }
  }

  getMessages(): SimMessage[] {
    return [...this.messages];
  }

  getActionLog() {
    return [...this.actionLog];
  }

  reset(): void {
    this.messages = [...this.config.initialMessages];
    this.deterministicQueue =
      this.config.responseMode.type === "deterministic"
        ? [...this.config.responseMode.responses]
        : [];
    this.actionLog = [];
    this.pendingEvents = [...(this.config.scheduledEvents ?? [])];
  }

  processScheduledEvents(context: { messageIndex: number; sessionIndex: number }): void {
    const toFire: SimEvent[] = [];
    const remaining: SimEvent[] = [];

    for (const event of this.pendingEvents) {
      let shouldFire = false;
      if (event.trigger === "immediate") {
        shouldFire = true;
      } else if ("afterMessageIndex" in event.trigger) {
        shouldFire = context.messageIndex >= event.trigger.afterMessageIndex;
      } else if ("afterSessionIndex" in event.trigger) {
        shouldFire = context.sessionIndex >= event.trigger.afterSessionIndex;
      }

      if (shouldFire) {
        toFire.push(event);
      } else {
        remaining.push(event);
      }
    }

    this.pendingEvents = remaining;
    for (const event of toFire) {
      this.messages.push({ ...event.data, read: false });
    }
  }
}
