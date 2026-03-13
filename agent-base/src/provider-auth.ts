import type { AgentBaseConfig } from "./config.js";

const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
  together: "TOGETHER_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
};

export function resolveProviderApiKeyEnvVar(provider: string): string | null {
  return PROVIDER_ENV_VARS[provider.trim().toLowerCase()] ?? null;
}

export function resolveProviderApiKey(provider: string): string | undefined {
  const envVar = resolveProviderApiKeyEnvVar(provider);
  if (!envVar) {
    return undefined;
  }
  const value = process.env[envVar]?.trim();
  return value || undefined;
}

export function getRequiredEvalProviderEnvVars(config: AgentBaseConfig): string[] {
  const envVars = new Set<string>();

  const agentEnvVar = resolveProviderApiKeyEnvVar(config.provider);
  if (agentEnvVar) {
    envVars.add(agentEnvVar);
  }

  if (config.evalUseLlmSuppliers !== false) {
    const supplierProvider = config.evalSupplierProvider ?? config.provider;
    const supplierEnvVar = resolveProviderApiKeyEnvVar(supplierProvider);
    if (supplierEnvVar) {
      envVars.add(supplierEnvVar);
    }
  }

  return [...envVars];
}
