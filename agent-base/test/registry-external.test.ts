import { describe, it, expect } from "vitest";
import {
  getEvalDefinition,
  getAllEvalDefinitions,
  getExternalEvalDefinition,
  getAllExternalEvalDefinitions,
} from "../src/evals/registry.js";

describe("eval registry", () => {
  describe("scripted evals", () => {
    it("has constraint-propagation registered", () => {
      const def = getEvalDefinition("constraint-propagation");
      expect(def).toBeDefined();
      expect(def!.name).toContain("Camera Kit");
      expect(def!.category).toBe("recall");
    });

    it("getAllEvalDefinitions returns scripted evals", () => {
      const defs = getAllEvalDefinitions();
      expect(defs.length).toBeGreaterThanOrEqual(1);
      expect(defs.some((d) => d.id === "constraint-propagation")).toBe(true);
    });

    it("does not include external evals in scripted registry", () => {
      const def = getEvalDefinition("vending-bench");
      expect(def).toBeUndefined();
    });
  });

  describe("external evals", () => {
    it("has vending-bench registered", () => {
      const def = getExternalEvalDefinition("vending-bench");
      expect(def).toBeDefined();
      expect(def!.name).toBe("Vending Bench");
      expect(def!.category).toBe("simulation");
      expect(def!.maxScore).toBe(-1);
      expect(def!.defaultDays).toBe(365);
    });

    it("getAllExternalEvalDefinitions returns external evals", () => {
      const defs = getAllExternalEvalDefinitions();
      expect(defs.length).toBeGreaterThanOrEqual(1);
      expect(defs.some((d) => d.id === "vending-bench")).toBe(true);
    });

    it("does not include scripted evals in external registry", () => {
      const def = getExternalEvalDefinition("constraint-propagation");
      expect(def).toBeUndefined();
    });
  });
});
