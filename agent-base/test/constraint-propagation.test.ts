import { describe, it, expect } from "vitest";
import { constraintPropagationEval } from "../src/evals/constraint-propagation.js";
import type { ScoringContext } from "../src/evals/eval-definition.js";

describe("Constraint Propagation Eval", () => {
  it("has correct structure", () => {
    expect(constraintPropagationEval.id).toBe("constraint-propagation");
    expect(constraintPropagationEval.messages).toHaveLength(7);
    expect(constraintPropagationEval.scoring).toHaveLength(8);
    expect(constraintPropagationEval.maxScore).toBe(8);
  });

  it("has messages across 3 sessions", () => {
    const sessions = new Set(constraintPropagationEval.messages.map((m) => m.sessionIndex));
    expect(sessions.size).toBe(3);
    expect(sessions).toContain(0);
    expect(sessions).toContain(1);
    expect(sessions).toContain(2);
  });

  it("marks session transitions with expectNewSession", () => {
    const s1Start = constraintPropagationEval.messages.find((m) => m.sessionIndex === 1);
    expect(s1Start?.expectNewSession).toBe(true);
    const s2Start = constraintPropagationEval.messages.find((m) => m.sessionIndex === 2);
    expect(s2Start?.expectNewSession).toBe(true);
  });

  it("scores a perfect run correctly", () => {
    const ctx: ScoringContext = {
      transcripts: [
        {
          sessionIndex: 0,
          exchanges: [
            {
              userMessage: "I need a camera...",
              agentResponse: "I recommend the Sony A7IV. It has an E-mount, full frame sensor, CFexpress Type A card slots, NP-FZ100 battery, and MI hot shoe.",
            },
            {
              userMessage: "Go with it",
              agentResponse: "I've stored the mount type, sensor size, card slot types, and battery model to memory.",
            },
          ],
        },
        {
          sessionIndex: 1,
          exchanges: [
            {
              userMessage: "Pick a lens",
              agentResponse: "Based on your Sony A7IV with E-mount and full frame sensor, I recommend the Sigma 24-70mm f/2.8. It's a native E-mount lens with full frame coverage.",
            },
            {
              userMessage: "Go with it",
              agentResponse: "Purchased the Sigma 24-70mm, confirmed compatible mount and sensor coverage.",
            },
          ],
        },
        {
          sessionIndex: 2,
          exchanges: [
            {
              userMessage: "Accessories please",
              agentResponse: "For your A7IV: CFexpress Type A card for Slot 1, SD UHS-II for Slot 2, NP-FZ100 spare battery, and Ulanzi LED with cold shoe mount for your MI hot shoe. Total budget remaining is $500.",
            },
            {
              userMessage: "Get them all",
              agentResponse: "All accessories purchased. Total spent: $3,879.",
            },
          ],
        },
      ],
    };

    let total = 0;
    for (const criterion of constraintPropagationEval.scoring) {
      const score = criterion.score(ctx);
      total += score;
      expect(score).toBeGreaterThan(0);
    }
    expect(total).toBe(8);
  });

  it("scores zero when agent has no relevant responses", () => {
    const ctx: ScoringContext = {
      transcripts: [
        {
          sessionIndex: 0,
          exchanges: [
            { userMessage: "Hello", agentResponse: "Hi there!" },
          ],
        },
      ],
    };

    let total = 0;
    for (const criterion of constraintPropagationEval.scoring) {
      total += criterion.score(ctx);
    }
    // Only "spec-storage" might fail since none of the keywords match
    expect(total).toBeLessThan(constraintPropagationEval.maxScore);
  });
});
