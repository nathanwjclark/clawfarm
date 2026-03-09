import type { EvalDefinition } from "./eval-definition.js";
import type { ExternalEvalDefinition } from "./external-eval-definition.js";
import { constraintPropagationEval } from "./constraint-propagation.js";
import { vendingBenchEval } from "./vending-bench.js";

// Scripted evals (messages[] + scoring[])
const EVALS = new Map<string, EvalDefinition>();

// External evals (subprocess-based)
const EXTERNAL_EVALS = new Map<string, ExternalEvalDefinition>();

function register(def: EvalDefinition) {
  EVALS.set(def.id, def);
}

export function registerExternal(def: ExternalEvalDefinition) {
  EXTERNAL_EVALS.set(def.id, def);
}

// Register all built-in evals
register(constraintPropagationEval);

// Register external evals
registerExternal(vendingBenchEval);

// --- Scripted eval accessors ---

export function getEvalDefinition(id: string): EvalDefinition | undefined {
  return EVALS.get(id);
}

export function getAllEvalDefinitions(): EvalDefinition[] {
  return Array.from(EVALS.values());
}

// --- External eval accessors ---

export function getExternalEvalDefinition(id: string): ExternalEvalDefinition | undefined {
  return EXTERNAL_EVALS.get(id);
}

export function getAllExternalEvalDefinitions(): ExternalEvalDefinition[] {
  return Array.from(EXTERNAL_EVALS.values());
}
