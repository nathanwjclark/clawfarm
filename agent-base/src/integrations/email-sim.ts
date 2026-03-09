import type {
  IntegrationSim,
  IntegrationSimConfig,
  SimAction,
  SimActionResult,
  SimEvent,
  SimMessage,
} from "./integration-sim.js";

/**
 * Simulates an email inbox.
 * Injects inbox contents as context and captures agent send/reply actions.
 */
export class EmailSim implements IntegrationSim {
  readonly type = "email" as const;
  readonly name: string;
  readonly config: IntegrationSimConfig;

  private messages: SimMessage[];
  private deterministicQueue: SimMessage[];
  private actionLog: Array<{ action: SimAction; result: SimActionResult; timestamp: string }> = [];
  private pendingEvents: SimEvent[];

  constructor(config: IntegrationSimConfig) {
    if (config.type !== "email") {
      throw new Error(`EmailSim requires type "email", got "${config.type}"`);
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

    const unread = this.messages.filter((m) => !m.read);
    const lines: string[] = [];
    lines.push(`**Email (${this.name})** — ${unread.length} unread, ${this.messages.length} total`);

    // Show unread first, then recent read
    const toShow = [
      ...unread,
      ...this.messages.filter((m) => m.read).slice(-5),
    ];

    for (const msg of toShow) {
      const unreadMarker = msg.read ? "" : " [UNREAD]";
      const subject = msg.subject ? ` — ${msg.subject}` : "";
      lines.push(`  From: ${msg.from}${subject}${unreadMarker}`);
      lines.push(`    ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
      lines.push(`    (${msg.timestamp})`);
    }

    return lines.join("\n");
  }

  handleAction(action: SimAction): SimActionResult {
    // Record the outgoing email
    const outgoing: SimMessage = {
      id: `email-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: "you",
      content: action.content,
      timestamp: new Date().toISOString(),
      subject: action.replyTo
        ? `Re: ${this.messages.find((m) => m.id === action.replyTo)?.subject ?? "No subject"}`
        : undefined,
      read: true,
      metadata: { to: action.target },
    };
    this.messages.push(outgoing);

    // Mark the original as read if replying
    if (action.replyTo) {
      const original = this.messages.find((m) => m.id === action.replyTo);
      if (original) original.read = true;
    }

    // Generate reply based on response mode
    let response: SimMessage | undefined;

    if (this.config.responseMode.type === "deterministic") {
      response = this.deterministicQueue.shift();
      if (response) {
        response = {
          ...response,
          timestamp: new Date().toISOString(),
          read: false,
        };
        this.messages.push(response);
      }
    } else {
      throw new Error("LLM-automated response mode is not yet implemented");
    }

    const result: SimActionResult = {
      success: true,
      response,
      description: response
        ? `Email sent to ${action.target ?? "unknown"}. Reply received from ${response.from}.`
        : `Email sent to ${action.target ?? "unknown"}.`,
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
