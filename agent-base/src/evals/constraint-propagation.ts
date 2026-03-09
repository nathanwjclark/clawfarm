import type { EvalDefinition, ScoringContext } from "./eval-definition.js";

/**
 * Constraint Propagation eval — Camera Kit Shopping.
 *
 * Tests whether the agent can:
 * 1. Research and select a camera body meeting constraints
 * 2. Store key specs to memory (mount, sensor, cards, battery, hot shoe)
 * 3. In a new session, recall specs to select a compatible lens
 * 4. In a third session, recall specs to select compatible accessories
 *
 * The agent uses its real memory system — this eval tests cross-session recall.
 */

function responseContainsAny(response: string, terms: string[]): boolean {
  const lower = response.toLowerCase();
  return terms.some((t) => lower.includes(t.toLowerCase()));
}

export const constraintPropagationEval: EvalDefinition = {
  id: "constraint-propagation",
  name: "Constraint Propagation — Camera Kit",
  description:
    "Multi-session camera shopping where the agent must remember product specs across sessions to ensure compatibility of lens and accessories with the camera body.",
  category: "recall",
  defaultClockSpeed: "fast",
  maxScore: 8,

  messages: [
    // --- Session 1: Camera body research and purchase ---
    {
      sessionIndex: 0,
      content:
        "I need to buy a mirrorless camera body for professional video work. Budget is $2000-3000. Must have 4K60 video, weather sealing, and dual card slots. What are the best options right now?",
    },
    {
      sessionIndex: 0,
      content:
        "Let's go with whatever you recommend as the best option. Please finalize the choice and remember all the important specs — mount type, sensor size, card slot types, battery model, hot shoe type, and dimensions. I'll need these for lens and accessory shopping later.",
    },
    {
      sessionIndex: 0,
      content:
        "Great. I primarily shoot interviews and documentary-style content. Keep that in mind for lens selection. That's all for now.",
    },

    // --- Session 2: Lens selection (must recall mount + sensor from session 1) ---
    {
      sessionIndex: 1,
      expectNewSession: true,
      content:
        "I'm ready to pick a lens for the camera I bought last session. I want something versatile for my interview and documentary work. What do you recommend that's compatible with my camera?",
    },
    {
      sessionIndex: 1,
      content:
        "Go with your top recommendation. Make sure it's compatible with my camera's mount and sensor size.",
    },

    // --- Session 3: Accessories (must recall card types, battery, hot shoe from session 1) ---
    {
      sessionIndex: 2,
      expectNewSession: true,
      content:
        "I'm back to finish the camera kit. I need memory cards that fit my camera's card slots, a spare battery that matches my camera, and if budget allows, a small on-camera LED light. What works with my specific setup?",
    },
    {
      sessionIndex: 2,
      content:
        "Go ahead and finalize all the accessories. Make sure everything is compatible with my camera.",
    },
  ],

  scoring: [
    {
      taskId: "camera-selection",
      description: "Selected a camera meeting all stated constraints (4K60, weather sealed, dual card slots, within budget)",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s1 = ctx.transcripts.find((t) => t.sessionIndex === 0);
        if (!s1) return 0;
        const allResponses = s1.exchanges.map((e) => e.agentResponse).join(" ");
        // Should mention a real camera model
        const hasCamera = responseContainsAny(allResponses, [
          "A7IV", "A7 IV", "R6", "Z6", "S5", "X-H2", "GH6", "a7iv",
        ]);
        return hasCamera ? 1 : 0;
      },
    },
    {
      taskId: "spec-storage",
      description: "Explicitly mentioned storing/remembering key specs (mount, sensor, card types, battery)",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s1 = ctx.transcripts.find((t) => t.sessionIndex === 0);
        if (!s1) return 0;
        const allResponses = s1.exchanges.map((e) => e.agentResponse).join(" ");
        const specTerms = ["mount", "sensor", "card", "battery"];
        const mentioned = specTerms.filter((t) =>
          allResponses.toLowerCase().includes(t)
        );
        // Need at least 3 of 4 spec categories mentioned
        return mentioned.length >= 3 ? 1 : 0;
      },
    },
    {
      taskId: "lens-mount-compat",
      description: "Selected a lens with compatible mount (recalled mount type from session 1)",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s2 = ctx.transcripts.find((t) => t.sessionIndex === 1);
        if (!s2) return 0;
        const allResponses = s2.exchanges.map((e) => e.agentResponse).join(" ");
        // Agent should mention mount compatibility
        return responseContainsAny(allResponses, [
          "mount", "E-mount", "RF mount", "Z mount", "L-mount", "compatible",
        ])
          ? 1
          : 0;
      },
    },
    {
      taskId: "lens-sensor-compat",
      description: "Selected a lens covering the camera's sensor size (full frame lens for full frame body)",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s2 = ctx.transcripts.find((t) => t.sessionIndex === 1);
        if (!s2) return 0;
        const allResponses = s2.exchanges.map((e) => e.agentResponse).join(" ");
        return responseContainsAny(allResponses, [
          "full frame", "full-frame", "sensor", "coverage", "APS-C",
        ])
          ? 1
          : 0;
      },
    },
    {
      taskId: "card-type-compat",
      description: "Selected memory cards matching the camera's card slot types (recalled from session 1)",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s3 = ctx.transcripts.find((t) => t.sessionIndex === 2);
        if (!s3) return 0;
        const allResponses = s3.exchanges.map((e) => e.agentResponse).join(" ");
        // Should mention specific card types
        return responseContainsAny(allResponses, [
          "CFexpress", "SD", "UHS", "Type A", "Type B", "card slot",
        ])
          ? 1
          : 0;
      },
    },
    {
      taskId: "battery-compat",
      description: "Selected a spare battery matching the camera's battery model (recalled from session 1)",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s3 = ctx.transcripts.find((t) => t.sessionIndex === 2);
        if (!s3) return 0;
        const allResponses = s3.exchanges.map((e) => e.agentResponse).join(" ");
        // Should mention the specific battery model
        return responseContainsAny(allResponses, [
          "NP-FZ100", "NP-FW50", "EN-EL15", "LP-E6", "BLK22", "battery",
        ])
          ? 1
          : 0;
      },
    },
    {
      taskId: "hotshoe-compat",
      description: "Addressed hot shoe compatibility for LED light (recalled from session 1)",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s3 = ctx.transcripts.find((t) => t.sessionIndex === 2);
        if (!s3) return 0;
        const allResponses = s3.exchanges.map((e) => e.agentResponse).join(" ");
        return responseContainsAny(allResponses, [
          "hot shoe", "hotshoe", "MI shoe", "cold shoe", "shoe mount", "Multi Interface",
        ])
          ? 1
          : 0;
      },
    },
    {
      taskId: "budget-tracking",
      description: "Tracked cumulative budget across sessions",
      maxScore: 1,
      score(ctx: ScoringContext): number {
        const s3 = ctx.transcripts.find((t) => t.sessionIndex === 2);
        if (!s3) return 0;
        const allResponses = s3.exchanges.map((e) => e.agentResponse).join(" ");
        // Should mention total cost or budget
        return responseContainsAny(allResponses, [
          "total", "budget", "$", "spent", "remaining",
        ])
          ? 1
          : 0;
      },
    },
  ],
};
