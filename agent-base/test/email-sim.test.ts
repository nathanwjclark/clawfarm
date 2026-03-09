import { describe, it, expect, beforeEach } from "vitest";
import { EmailSim } from "../src/integrations/email-sim.js";
import type { IntegrationSimConfig, SimAction } from "../src/integrations/integration-sim.js";

describe("EmailSim", () => {
  let config: IntegrationSimConfig;
  let sim: EmailSim;

  beforeEach(() => {
    config = {
      type: "email",
      name: "work-email",
      responseMode: {
        type: "deterministic",
        responses: [
          {
            id: "resp-1",
            from: "alex@partner.com",
            subject: "Re: Meeting",
            content: "Sounds great, see you then!",
            timestamp: "",
          },
        ],
      },
      initialMessages: [
        {
          id: "email-1",
          from: "boss@company.com",
          subject: "Q1 Report Needed",
          content: "Please send the Q1 numbers by Friday.",
          timestamp: "2026-03-07T10:00:00Z",
          read: false,
        },
        {
          id: "email-2",
          from: "newsletter@tech.com",
          subject: "Weekly Digest",
          content: "Top stories this week...",
          timestamp: "2026-03-06T08:00:00Z",
          read: true,
        },
      ],
    };
    sim = new EmailSim(config);
  });

  it("has correct type and name", () => {
    expect(sim.type).toBe("email");
    expect(sim.name).toBe("work-email");
  });

  it("returns context injection with unread count", () => {
    const ctx = sim.getContextInjection();
    expect(ctx).toContain("Email (work-email)");
    expect(ctx).toContain("1 unread");
    expect(ctx).toContain("boss@company.com");
    expect(ctx).toContain("[UNREAD]");
    expect(ctx).toContain("Q1 Report Needed");
  });

  it("handles send action with deterministic response", () => {
    const action: SimAction = {
      type: "send_message",
      integration: "email",
      integrationName: "work-email",
      content: "Let's meet Thursday at 2pm.",
      target: "alex@partner.com",
    };

    const result = sim.handleAction(action);
    expect(result.success).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.response!.from).toBe("alex@partner.com");
  });

  it("handles reply action and marks original as read", () => {
    const action: SimAction = {
      type: "reply",
      integration: "email",
      integrationName: "work-email",
      content: "I'll have it ready by Thursday EOD.",
      replyTo: "email-1",
    };

    const result = sim.handleAction(action);
    expect(result.success).toBe(true);

    // The outgoing should have "Re:" subject
    const msgs = sim.getMessages();
    const outgoing = msgs.find((m) => m.from === "you");
    expect(outgoing).toBeDefined();
    expect(outgoing!.subject).toContain("Re:");

    // Original should be marked read
    const original = msgs.find((m) => m.id === "email-1");
    expect(original!.read).toBe(true);
  });

  it("resets to initial state", () => {
    sim.handleAction({
      type: "send_message",
      integration: "email",
      integrationName: "work-email",
      content: "test",
    });
    expect(sim.getMessages().length).toBeGreaterThan(2);

    sim.reset();
    expect(sim.getMessages().length).toBe(2);
    expect(sim.getActionLog().length).toBe(0);
  });

  it("processes scheduled events", () => {
    const simWithEvents = new EmailSim({
      ...config,
      scheduledEvents: [
        {
          type: "incoming_message",
          data: {
            id: "urgent-1",
            from: "ceo@company.com",
            subject: "Urgent Request",
            content: "Need this ASAP",
            timestamp: "2026-03-08T12:00:00Z",
          },
          trigger: { afterSessionIndex: 1 },
        },
      ],
    });

    simWithEvents.processScheduledEvents({ messageIndex: 0, sessionIndex: 0 });
    expect(simWithEvents.getMessages().length).toBe(2);

    simWithEvents.processScheduledEvents({ messageIndex: 0, sessionIndex: 1 });
    expect(simWithEvents.getMessages().length).toBe(3);
    expect(simWithEvents.getMessages()[2].subject).toBe("Urgent Request");
  });
});
