import { z } from "zod";

export const ModelPricingSchema = z.object({
  inputPerMillion: z.number().default(3),
  outputPerMillion: z.number().default(15),
  cacheReadPerMillion: z.number().default(0.30),
  cacheWritePerMillion: z.number().default(3.75),
});

export const CostCapSchema = z.object({
  perEvalRunUsd: z.number().default(10),
  totalUsd: z.number().default(100),
});

export const AgentBaseConfigSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  memoryVariant: z.string().default("native-0d"),
  mode: z.enum(["eval", "real-world"]).default("eval"),

  // Farm connection
  farmDashboardUrl: z.string().default("http://localhost:3847"),
  reportIntervalMs: z.number().default(5000),

  // Agent workspace (isolated per agent)
  workspaceDir: z.string(),

  // OpenClaw config path (optional override)
  openclawConfigPath: z.string().optional(),

  // Model settings
  provider: z.string().default("anthropic"),
  model: z.string().default("claude-sonnet-4-6"),
  pricing: ModelPricingSchema.default({}),

  // Cost caps
  costCap: CostCapSchema.default({}),

  // Agent HTTP server port (0 = auto-assign)
  port: z.number().default(0),

  // Context window size
  contextTokensAvailable: z.number().default(200_000),

  // Path to openclaw installation (for external evals)
  openclawDir: z.string().optional(),

  // Paths to external eval projects (e.g. vending-bench-openclaw)
  externalEvalDirs: z.array(z.string()).default([]),
});

export type AgentBaseConfig = z.infer<typeof AgentBaseConfigSchema>;

export function parseConfig(raw: unknown): AgentBaseConfig {
  return AgentBaseConfigSchema.parse(raw);
}
