import { describe, it, expect } from "vitest";
import { getDemoIntegrationConfigs, DEMO_SLACK_CONFIG, DEMO_EMAIL_CONFIG } from "../src/integrations/demo-data.js";
import { SimRegistry } from "../src/integrations/sim-registry.js";

describe("demo integration data", () => {
  it("getDemoIntegrationConfigs returns slack and email", () => {
    const configs = getDemoIntegrationConfigs();
    expect(configs.length).toBe(2);
    expect(configs.map((c) => c.type)).toEqual(["slack", "email"]);
  });

  it("demo slack config has realistic messages", () => {
    expect(DEMO_SLACK_CONFIG.initialMessages.length).toBeGreaterThan(0);
    expect(DEMO_SLACK_CONFIG.scheduledEvents!.length).toBeGreaterThan(0);
    expect(DEMO_SLACK_CONFIG.responseMode.type).toBe("deterministic");
  });

  it("demo email config has realistic messages", () => {
    expect(DEMO_EMAIL_CONFIG.initialMessages.length).toBeGreaterThan(0);
    expect(DEMO_EMAIL_CONFIG.responseMode.type).toBe("deterministic");
  });

  it("demo configs can be loaded into SimRegistry", () => {
    const configs = getDemoIntegrationConfigs();
    const registry = new SimRegistry(configs);
    expect(registry.hasIntegrations()).toBe(true);
    expect(registry.getAllSims().length).toBe(2);

    const ctx = registry.getContextInjection();
    expect(ctx).toContain("Slack");
    expect(ctx).toContain("Email");
    expect(ctx.length).toBeGreaterThan(100);
  });
});
