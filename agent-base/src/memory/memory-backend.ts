import type { AgentMemoryGraph, AgentMessage, MemorySnapshot } from "../types.js";

/**
 * Central memory abstraction. Each variant (0D, 1D, 2D, etc.) implements
 * this interface with its own write/read/storage logic.
 *
 * The backend is an active participant in the prompt cycle — triggered on
 * every turn, receiving the conversation history, and emitting text to be
 * injected into the agent's prompt as memory context.
 */
export interface MemoryBackend {
  readonly variantId: string;
  readonly dimensionality: "0D" | "1D" | "2D" | "2D+";

  /**
   * Called BEFORE each agent turn. Receives the conversation so far.
   * Returns text to inject into the agent's prompt as memory context.
   * Returns empty string if the backend manages injection natively (e.g., 0D).
   */
  recall(conversation: AgentMessage[]): Promise<string>;

  /**
   * Called AFTER each agent turn. Processes the exchange for consolidation/storage.
   * This is where facts get extracted, graphs get updated, adapters get queued, etc.
   */
  consolidate(
    userMessage: string,
    agentResponse: string,
    conversation: AgentMessage[],
  ): Promise<void>;

  /**
   * Extract graph representation for dashboard visualization.
   * Each backend produces graphs from its own storage format.
   */
  extractGraph(): Promise<AgentMemoryGraph>;

  /**
   * Capture full memory snapshot (files, stats, graph) for eval results.
   */
  captureSnapshot(): Promise<MemorySnapshot>;

  /**
   * Clean wipe of memory state for eval lifecycle.
   */
  reset(): Promise<void>;

  /**
   * Generate openclaw config object (written as openclaw.json).
   * Non-0D backends should disable openclaw's native memory tools
   * since they handle memory externally.
   */
  generateOpenclawConfig(workspaceDir: string): Record<string, unknown>;

  /**
   * Initialize the backend with a workspace directory.
   * Called once when the agent process starts or when a new eval workspace is created.
   */
  init(workspaceDir: string): Promise<void>;
}
