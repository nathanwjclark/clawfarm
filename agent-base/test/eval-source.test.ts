import { describe, it, expect } from "vitest";
import { EvalSource } from "../src/messaging/eval-source.js";
import type { EvalMessage } from "../src/messaging/message-source.js";

const MESSAGES: EvalMessage[] = [
  { sessionIndex: 0, content: "Hello, I need a camera." },
  { sessionIndex: 0, content: "Go with your top pick." },
  { sessionIndex: 1, content: "Pick a lens now.", expectNewSession: true },
  { sessionIndex: 2, content: "Now accessories.", expectNewSession: true },
];

describe("EvalSource", () => {
  it("delivers messages in order", async () => {
    const source = new EvalSource({ messages: MESSAGES, clockSpeed: "fast" });
    const delivered: EvalMessage[] = [];
    let msg: EvalMessage | null;
    while ((msg = await source.nextMessage()) !== null) {
      delivered.push(msg);
    }
    expect(delivered).toHaveLength(4);
    expect(delivered[0].content).toBe("Hello, I need a camera.");
    expect(delivered[2].expectNewSession).toBe(true);
  });

  it("isDone returns true after all messages", async () => {
    const source = new EvalSource({ messages: MESSAGES, clockSpeed: "fast" });
    expect(source.isDone()).toBe(false);
    while (await source.nextMessage()) {}
    expect(source.isDone()).toBe(true);
  });

  it("tracks responses", async () => {
    const source = new EvalSource({ messages: MESSAGES, clockSpeed: "fast" });
    await source.nextMessage();
    source.onAgentResponse("Here are camera options...");
    await source.nextMessage();
    source.onAgentResponse("Great choice!");
    expect(source.getResponses()).toHaveLength(2);
    expect(source.getResponses()[0]).toBe("Here are camera options...");
  });

  it("reports progress", async () => {
    const source = new EvalSource({ messages: MESSAGES, clockSpeed: "fast" });
    expect(source.getProgress()).toEqual({ current: 0, total: 4 });
    await source.nextMessage();
    expect(source.getProgress()).toEqual({ current: 1, total: 4 });
    await source.nextMessage();
    expect(source.getProgress()).toEqual({ current: 2, total: 4 });
  });

  it("returns null for empty messages", async () => {
    const source = new EvalSource({ messages: [], clockSpeed: "fast" });
    expect(await source.nextMessage()).toBeNull();
    expect(source.isDone()).toBe(true);
  });
});
