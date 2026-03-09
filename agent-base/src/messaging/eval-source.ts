import type { EvalMessage, MessageSource } from "./message-source.js";

export type ClockSpeed = "fast" | "real-world" | "custom";

export interface EvalSourceOptions {
  messages: EvalMessage[];
  clockSpeed: ClockSpeed;
  /** Only used when clockSpeed is "custom". Default inter-message delay in ms. */
  customDelayMs?: number;
}

/**
 * Replays a scripted sequence of eval messages.
 * Respects clock speed: fast = no delay, real-world = use delayMs from messages, custom = fixed delay.
 */
export class EvalSource implements MessageSource {
  private messages: EvalMessage[];
  private clockSpeed: ClockSpeed;
  private customDelayMs: number;
  private cursor = 0;
  private responses: string[] = [];

  constructor(options: EvalSourceOptions) {
    this.messages = options.messages;
    this.clockSpeed = options.clockSpeed;
    this.customDelayMs = options.customDelayMs ?? 1000;
  }

  async nextMessage(): Promise<EvalMessage | null> {
    if (this.cursor >= this.messages.length) return null;

    const msg = this.messages[this.cursor];

    // Apply delay based on clock speed
    const delay = this.getDelay(msg);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.cursor++;
    return msg;
  }

  onAgentResponse(response: string): void {
    this.responses.push(response);
  }

  isDone(): boolean {
    return this.cursor >= this.messages.length;
  }

  getResponses(): string[] {
    return this.responses;
  }

  getProgress(): { current: number; total: number } {
    return { current: this.cursor, total: this.messages.length };
  }

  private getDelay(msg: EvalMessage): number {
    switch (this.clockSpeed) {
      case "fast":
        return 0;
      case "real-world":
        return msg.delayMs ?? 2000;
      case "custom":
        return this.customDelayMs;
    }
  }
}
