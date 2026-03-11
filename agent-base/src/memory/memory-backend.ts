import type {
  AgentMemoryGraph,
  AgentMessage,
  MemoryReadResult,
  MemorySearchResult,
  MemorySnapshot,
  MemoryWriteResult,
} from "../types.js";

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
   * Compose workspace bootstrap files for eval runs.
   * Variants own how base templates and eval persona files are merged.
   */
  composeEvalWorkspaceFiles(input: {
    identity?: string;
    workspaceFiles?: Record<string, string>;
  }): Promise<Record<string, string>>;

  /**
   * In-turn memory search routed through the backend implementation.
   */
  searchMemory(input: {
    query: string;
    maxResults?: number;
    minScore?: number;
  }): Promise<MemorySearchResult[]>;

  /**
   * In-turn targeted memory read routed through the backend implementation.
   */
  readMemory(input: {
    path: string;
    from?: number;
    lines?: number;
  }): Promise<MemoryReadResult>;

  /**
   * In-turn memory write routed through the backend implementation.
   */
  writeMemory(input: {
    path: string;
    content: string;
    mode?: "append" | "replace";
  }): Promise<MemoryWriteResult>;

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
   * Variants should configure OpenClaw to use the external memory bridge
   * whenever storage and retrieval live inside the backend.
   */
  generateOpenclawConfig(workspaceDir: string): Record<string, unknown>;

  /**
   * Initialize the backend with a workspace directory.
   * Called once when the agent process starts or when a new eval workspace is created.
   */
  init(workspaceDir: string): Promise<void>;
}
