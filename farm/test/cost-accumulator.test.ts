import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  recordSnapshot,
  getLiveCostSnapshots,
  resetCostAccumulator,
  startCostAccumulator,
  stopCostAccumulator,
} from "../src/cost-accumulator.js";

describe("cost-accumulator", () => {
  beforeEach(() => {
    resetCostAccumulator();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetCostAccumulator();
  });

  it("records a snapshot and retrieves it", () => {
    recordSnapshot({ "agent-01": 0.5, "agent-02": 0.3 });

    const snapshots = getLiveCostSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].totalUsd).toBeCloseTo(0.8);
    expect(snapshots[0].byAgent).toEqual({ "agent-01": 0.5, "agent-02": 0.3 });
    expect(typeof snapshots[0].timestamp).toBe("string");
  });

  it("accumulates multiple snapshots", () => {
    recordSnapshot({ "agent-01": 0.1 });
    recordSnapshot({ "agent-01": 0.2, "agent-02": 0.1 });
    recordSnapshot({ "agent-01": 0.3, "agent-02": 0.2 });

    const snapshots = getLiveCostSnapshots();
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].totalUsd).toBeCloseTo(0.1);
    expect(snapshots[2].totalUsd).toBeCloseTo(0.5);
  });

  it("enforces max buffer of 17 snapshots", () => {
    for (let i = 0; i < 20; i++) {
      recordSnapshot({ "agent-01": i * 0.01 });
    }

    const snapshots = getLiveCostSnapshots();
    expect(snapshots).toHaveLength(17);
    // Oldest 3 should have been dropped (i=0,1,2)
    expect(snapshots[0].totalUsd).toBeCloseTo(0.03);
  });

  it("skips empty snapshots with no agents", () => {
    recordSnapshot({});

    const snapshots = getLiveCostSnapshots();
    expect(snapshots).toHaveLength(0);
  });

  it("returns a copy, not a reference", () => {
    recordSnapshot({ "agent-01": 0.1 });
    const snap1 = getLiveCostSnapshots();
    const snap2 = getLiveCostSnapshots();
    expect(snap1).not.toBe(snap2);
    expect(snap1).toEqual(snap2);
  });

  it("startCostAccumulator triggers snapshots on interval", () => {
    vi.useFakeTimers();

    const getCosts = vi.fn().mockReturnValue({ "agent-01": 0.1 });
    startCostAccumulator(getCosts);

    // No immediate snapshot
    expect(getLiveCostSnapshots()).toHaveLength(0);

    // Advance 15 minutes
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(getLiveCostSnapshots()).toHaveLength(1);
    expect(getCosts).toHaveBeenCalledTimes(1);

    // Advance another 15 minutes
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(getLiveCostSnapshots()).toHaveLength(2);

    stopCostAccumulator();
    vi.useRealTimers();
  });

  it("stopCostAccumulator stops the timer", () => {
    vi.useFakeTimers();

    const getCosts = vi.fn().mockReturnValue({ "agent-01": 0.1 });
    startCostAccumulator(getCosts);

    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(getLiveCostSnapshots()).toHaveLength(1);

    stopCostAccumulator();

    vi.advanceTimersByTime(15 * 60 * 1000);
    // Should not have added more snapshots
    expect(getLiveCostSnapshots()).toHaveLength(1);

    vi.useRealTimers();
  });

  it("resetCostAccumulator clears all state", () => {
    recordSnapshot({ "agent-01": 0.1 });
    expect(getLiveCostSnapshots()).toHaveLength(1);

    resetCostAccumulator();
    expect(getLiveCostSnapshots()).toHaveLength(0);
  });
});
