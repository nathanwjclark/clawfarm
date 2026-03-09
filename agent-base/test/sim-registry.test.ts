import { describe, it, expect } from "vitest";
import { SimRegistry } from "../src/integrations/sim-registry.js";
import type { IntegrationSimConfig, SimAction } from "../src/integrations/integration-sim.js";

const slackConfig: IntegrationSimConfig = {
  type: "slack",
  name: "work-slack",
  responseMode: { type: "deterministic", responses: [] },
  initialMessages: [
    {
      id: "s1",
      from: "Alice",
      content: "Hello",
      timestamp: "2026-03-08T09:00:00Z",
      channel: "#general",
      read: false,
    },
  ],
};

const emailConfig: IntegrationSimConfig = {
  type: "email",
  name: "work-email",
  responseMode: { type: "deterministic", responses: [] },
  initialMessages: [
    {
      id: "e1",
      from: "boss@co.com",
      subject: "Update",
      content: "Status please",
      timestamp: "2026-03-08T08:00:00Z",
      read: false,
    },
  ],
};

describe("SimRegistry", () => {
  it("creates from config array", () => {
    const reg = new SimRegistry([slackConfig, emailConfig]);
    expect(reg.getAllSims().length).toBe(2);
    expect(reg.hasIntegrations()).toBe(true);
  });

  it("gets sim by type and name", () => {
    const reg = new SimRegistry([slackConfig, emailConfig]);
    const slack = reg.getSim("slack", "work-slack");
    expect(slack).toBeDefined();
    expect(slack!.type).toBe("slack");

    const email = reg.getSim("email", "work-email");
    expect(email).toBeDefined();
    expect(email!.type).toBe("email");

    expect(reg.getSim("slack", "nonexistent")).toBeUndefined();
  });

  it("returns combined context injection", () => {
    const reg = new SimRegistry([slackConfig, emailConfig]);
    const ctx = reg.getContextInjection();
    expect(ctx).toContain("Slack");
    expect(ctx).toContain("Email");
    expect(ctx).toContain("Alice");
    expect(ctx).toContain("boss@co.com");
  });

  it("returns empty string when no sims have content", () => {
    const reg = new SimRegistry([
      { ...slackConfig, initialMessages: [] },
      { ...emailConfig, initialMessages: [] },
    ]);
    expect(reg.getContextInjection()).toBe("");
  });

  it("routes actions to correct sim by type", () => {
    const reg = new SimRegistry([slackConfig, emailConfig]);
    const action: SimAction = {
      type: "send_message",
      integration: "slack",
      integrationName: "work-slack",
      content: "Hello!",
      target: "#general",
    };
    const result = reg.handleAction(action);
    expect(result.success).toBe(true);
  });

  it("returns failure for unregistered integration", () => {
    const reg = new SimRegistry([slackConfig]);
    const action: SimAction = {
      type: "send_message",
      integration: "telegram",
      integrationName: "personal",
      content: "Hello",
    };
    const result = reg.handleAction(action);
    expect(result.success).toBe(false);
  });

  it("prevents duplicate registration", () => {
    const reg = new SimRegistry([slackConfig]);
    expect(() => reg.register(slackConfig)).toThrow("already registered");
  });

  it("resets all sims", () => {
    const reg = new SimRegistry([slackConfig, emailConfig]);
    reg.handleAction({
      type: "send_message",
      integration: "slack",
      integrationName: "work-slack",
      content: "test",
    });
    expect(reg.getFullActionLog().length).toBe(1);

    reg.reset();
    expect(reg.getFullActionLog().length).toBe(0);
  });

  it("processes scheduled events across all sims", () => {
    const configWithEvents: IntegrationSimConfig = {
      ...slackConfig,
      scheduledEvents: [
        {
          type: "incoming_message",
          data: {
            id: "evt-1",
            from: "Bot",
            content: "Alert!",
            timestamp: "2026-03-08T10:00:00Z",
            channel: "#alerts",
          },
          trigger: { afterMessageIndex: 2 },
        },
      ],
    };
    const reg = new SimRegistry([configWithEvents]);
    const slack = reg.getSim("slack", "work-slack")!;

    reg.processScheduledEvents({ messageIndex: 0, sessionIndex: 0 });
    expect(slack.getMessages().length).toBe(1);

    reg.processScheduledEvents({ messageIndex: 2, sessionIndex: 0 });
    expect(slack.getMessages().length).toBe(2);
  });

  it("throws for unimplemented integration types", () => {
    expect(
      () =>
        new SimRegistry([
          {
            type: "discord",
            name: "test",
            responseMode: { type: "deterministic", responses: [] },
            initialMessages: [],
          },
        ]),
    ).toThrow("not yet implemented");
  });

  it("hasIntegrations returns false when empty", () => {
    const reg = new SimRegistry();
    expect(reg.hasIntegrations()).toBe(false);
  });
});
