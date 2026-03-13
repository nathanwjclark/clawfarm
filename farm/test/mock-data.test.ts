import { describe, it, expect } from "vitest";
import { getImplementedVariants, getSimulatedVariants } from "../src/mock-data.js";

describe("mock-data variant catalog", () => {
  it("derives implemented variants from discovered agent configs", () => {
    const variants = getImplementedVariants();
    const variantIds = variants.map((variant) => variant.id);

    expect(variantIds).toContain("native-0d");
    expect(variantIds).toContain("three-layer-1d");
    expect(variantIds).toContain("five-day-1d");
    expect(variantIds).toContain("five-day-1d-cerebras-glm47");
  });

  it("includes discovered implemented variants alongside mock-only variants", () => {
    const variants = getSimulatedVariants();
    const variantIds = variants.map((variant) => variant.id);

    expect(variantIds).toContain("five-day-1d-cerebras-glm47");
    expect(variantIds).toContain("mem0-1d");
  });
});
