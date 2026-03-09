/**
 * Interface for message sources that feed messages to the agent.
 * Implementations: EvalSource (scripted playback), ChannelSource (real channels, future).
 */

export interface EvalMessage {
  /** Which session this message belongs to (0-indexed). */
  sessionIndex: number;
  /** The user message content to send to the agent. */
  content: string;
  /** If true, start a new session before this message (memory persists, conversation resets). */
  expectNewSession?: boolean;
  /** Optional delay in ms before sending this message (for real-world pacing). */
  delayMs?: number;
}

export interface MessageSource {
  /** Get the next message to send, or null if done. */
  nextMessage(): Promise<EvalMessage | null>;
  /** Called after the agent responds. */
  onAgentResponse(response: string): void;
  /** True when all messages have been delivered. */
  isDone(): boolean;
}
