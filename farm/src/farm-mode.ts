/**
 * Farm operating mode.
 *
 * - demo: Mock data + sim runner only. No live agent connections. For demoing the dashboard UI.
 * - dev:  Mock data as backdrop + live agents overlay on top. For development and testing.
 * - prod: Live agents only. No mock data. For production use.
 */
export type FarmMode = "demo" | "dev" | "prod";

let currentMode: FarmMode = "dev";

export function setFarmMode(mode: FarmMode): void {
  if (!["demo", "dev", "prod"].includes(mode)) {
    console.error(`[farm-mode] Invalid mode "${mode}", defaulting to "dev"`);
    currentMode = "dev";
    return;
  }
  currentMode = mode;
}

export function getFarmMode(): FarmMode {
  return currentMode;
}

/** Whether mock/simulated data should be included. */
export function includeMockData(): boolean {
  return currentMode === "demo" || currentMode === "dev";
}

/** Whether live agent connections should be accepted. */
export function includeLiveAgents(): boolean {
  return currentMode === "dev" || currentMode === "prod";
}
