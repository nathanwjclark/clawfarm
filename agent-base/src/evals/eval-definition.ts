import type { IntegrationSimConfig } from "../integrations/integration-sim.js";
import type { EvalMessage } from "../messaging/message-source.js";
import type { ClockSpeed } from "../messaging/eval-source.js";

/**
 * A scoring criterion that checks the agent's response against expected behavior.
 * The scorer receives all transcripts and returns a score for each task.
 */
export interface ScoringCriterion {
  /** Unique task ID within this eval. */
  taskId: string;
  /** Human-readable description of what's being tested. */
  description: string;
  /** Max points for this task. */
  maxScore: number;
  /**
   * Score this criterion given the full transcript of agent responses.
   * Returns 0 to maxScore.
   */
  score(context: ScoringContext): number;
}

export interface ScoringContext {
  /** All agent responses indexed by session. */
  transcripts: Array<{
    sessionIndex: number;
    exchanges: Array<{ userMessage: string; agentResponse: string }>;
  }>;
}

export interface EvalDefinition {
  /** Unique eval ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description. */
  description: string;
  /** Category. */
  category: "recall" | "reasoning" | "integration" | "robustness";
  /** The scripted messages to inject. */
  messages: EvalMessage[];
  /** Scoring criteria — each becomes a task result. */
  scoring: ScoringCriterion[];
  /** Default clock speed. */
  defaultClockSpeed: ClockSpeed;
  /** Max score (sum of all criteria maxScores). */
  maxScore: number;
  /** Optional integration simulations active during this eval. */
  integrations?: IntegrationSimConfig[];
}
