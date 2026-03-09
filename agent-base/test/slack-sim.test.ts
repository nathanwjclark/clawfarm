import { describe, it, expect, beforeEach } from "vitest";
import { SlackSim } from "../src/integrations/slack-sim.js";
import type { IntegrationSimConfig, SimAction } from "../src/integrations/integration-sim.js";

describe("SlackSim", () => {
  let config: IntegrationSimConfig;
  let sim: SlackSim;

  beforeEach(() => {
    config = {
      type: "slack",
      name: "test-slack",
      responseMode: {
        type: "deterministic",
        responses: [
          {
            id: "resp-1",
            from: "Bob",
            content: "Got it, thanks!",
            timestamp: "",
            channel: "#general",
          },
          {
            id: "resp-2",
            from: "Alice",
            content: "Sounds good.",
            timestamp: "",
            channel: "#design",
          },
        ],
      },
      initialMessages: [
        {
          id: "msg-1",
          from: "Alice",
          content: "Hey team, standup in 5",
          timestamp: "2026-03-08T09:00:00Z",
          channel: "#general",
          read: false,
        },
        {
          id: "msg-2",
          from: "Bob",
          content: "New mockups ready for review",
          timestamp: "2026-03-08T09:15:00Z",
          channel: "#design",
          read: true,
        },
      ],
      scheduledEvents: [
        {
          type: "incoming_message",
          data: {
            id: "event-1",
            from: "Carol",
            content: "Deploy is live!",
            timestamp: "2026-03-08T10:00:00Z",
            channel: "#alerts",
          },
          trigger: { afterMessageIndex: 1 },
        },
      ],
    };
    sim = new SlackSim(config);
  });

  it("has correct type and name", () => {
    expect(sim.type).toBe("slack");
    expect(sim.name).toBe("test-slack");
  });

  it("rejects non-slack config", () => {
    expect(() => new SlackSim({ ...config, type: "email" })).toThrow(
      'SlackSim requires type "slack"',
    );
  });

  it("returns context injection with channel grouping", () => {
    const ctx = sim.getContextInjection();
    expect(ctx).toContain("Slack (test-slack)");
    expect(ctx).toContain("1 unread");
    expect(ctx).toContain("#general");
    expect(ctx).toContain("#design");
    expect(ctx).toContain("Alice");
    expect(ctx).toContain("[NEW]");
  });

  it("returns empty context when no messages", () => {
    const emptySim = new SlackSim({
      ...config,
      initialMessages: [],
    });
    expect(emptySim.getContextInjection()).toBe("");
  });

  it("handles send_message action with deterministic response", () => {
    const action: SimAction = {
      type: "send_message",
      integration: "slack",
      integrationName: "test-slack",
      content: "Hello team!",
      target: "#general",
    };

    const result = sim.handleAction(action);
    expect(result.success).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.response!.from).toBe("Bob");
    expect(result.response!.content).toBe("Got it, thanks!");

    // Should have added both the outgoing and response to messages
    const msgs = sim.getMessages();
    expect(msgs.length).toBe(4); // 2 initial + outgoing + response
    expect(msgs[2].from).toBe("you");
    expect(msgs[3].from).toBe("Bob");
  });

  it("returns no response when deterministic queue is empty", () => {
    const action: SimAction = {
      type: "send_message",
      integration: "slack",
      integrationName: "test-slack",
      content: "msg 1",
    };
    sim.handleAction(action); // consumes resp-1
    sim.handleAction(action); // consumes resp-2
    const result = sim.handleAction(action); // queue empty
    expect(result.success).toBe(true);
    expect(result.response).toBeUndefined();
  });

  it("records actions in the action log", () => {
    const action: SimAction = {
      type: "send_message",
      integration: "slack",
      integrationName: "test-slack",
      content: "Hello",
    };
    sim.handleAction(action);
    const log = sim.getActionLog();
    expect(log.length).toBe(1);
    expect(log[0].action.content).toBe("Hello");
    expect(log[0].result.success).toBe(true);
  });

  it("processes scheduled events at correct message index", () => {
    // Before threshold — should not fire
    sim.processScheduledEvents({ messageIndex: 0, sessionIndex: 0 });
    expect(sim.getMessages().length).toBe(2);

    // At threshold — should fire
    sim.processScheduledEvents({ messageIndex: 1, sessionIndex: 0 });
    expect(sim.getMessages().length).toBe(3);
    const newMsg = sim.getMessages()[2];
    expect(newMsg.from).toBe("Carol");
    expect(newMsg.content).toBe("Deploy is live!");
    expect(newMsg.read).toBe(false);

    // Should not fire again
    sim.processScheduledEvents({ messageIndex: 5, sessionIndex: 0 });
    expect(sim.getMessages().length).toBe(3);
  });

  it("injects immediate events", () => {
    sim.injectEvent({
      type: "incoming_message",
      data: {
        id: "injected-1",
        from: "DevOps",
        content: "Alert!",
        timestamp: "2026-03-08T11:00:00Z",
        channel: "#alerts",
      },
      trigger: "immediate",
    });
    expect(sim.getMessages().length).toBe(3);
    expect(sim.getMessages()[2].from).toBe("DevOps");
  });

  it("resets to initial state", () => {
    sim.handleAction({
      type: "send_message",
      integration: "slack",
      integrationName: "test-slack",
      content: "test",
    });
    expect(sim.getMessages().length).toBeGreaterThan(2);
    expect(sim.getActionLog().length).toBe(1);

    sim.reset();
    expect(sim.getMessages().length).toBe(2);
    expect(sim.getActionLog().length).toBe(0);
  });
});
