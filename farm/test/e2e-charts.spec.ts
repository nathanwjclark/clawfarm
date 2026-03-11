/**
 * E2E test: Spawn agents, run 5-day evals, verify dashboard charts render.
 *
 * Prerequisites:
 * - Farm server running on port 3847
 * - Ports 3900-3902 available (for agents)
 * - ANTHROPIC_API_KEY set in environment
 *
 * Run: npx playwright test test/e2e-charts.spec.ts
 */
import { test, expect } from "@playwright/test";

const FARM = "http://localhost:3847";
const VARIANTS = ["native-0d", "three-layer-1d", "five-day-1d"];
const EVAL_ID = "vending-bench";
const DAYS = 3;

/** Helper: poll a condition with timeout, return immediately on failure detection */
async function pollUntil(
  check: () => Promise<{ done: boolean; failed?: string }>,
  { intervalMs = 3000, timeoutMs = 300_000, label = "condition" } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { done, failed } = await check();
    if (failed) throw new Error(`${label}: ${failed}`);
    if (done) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`${label}: timed out after ${timeoutMs / 1000}s`);
}

test.describe("Dashboard charts E2E", () => {
  test.setTimeout(600_000); // 10 minutes total

  test("spawn agents, run 5-day evals, verify charts", async ({ page }) => {
    // ---------------------------------------------------------------
    // Step 1: Spawn all agents
    // ---------------------------------------------------------------
    const agentIds: string[] = [];
    for (const variantId of VARIANTS) {
      const res = await fetch(`${FARM}/api/agents/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId }),
      });
      const data = await res.json();
      expect(res.ok, `spawn ${variantId}: ${JSON.stringify(data)}`).toBe(true);
      agentIds.push(data.agentId);
      console.log(`Spawned ${variantId} → ${data.agentId}:${data.port}`);
    }

    // ---------------------------------------------------------------
    // Step 2: Wait for all agents to register
    // ---------------------------------------------------------------
    await pollUntil(async () => {
      const agents = await (await fetch(`${FARM}/api/agents`)).json() as any[];
      const live = agentIds.filter(id => agents.some((a: any) => a.id === id && a.status === "online"));
      console.log(`  Agents registered: ${live.length}/${agentIds.length}`);
      return { done: live.length === agentIds.length };
    }, { timeoutMs: 60_000, label: "agent registration" });

    // ---------------------------------------------------------------
    // Step 3: Start 5-day eval on each agent
    // ---------------------------------------------------------------
    const runIds: string[] = [];
    for (const agentId of agentIds) {
      const res = await fetch(`${FARM}/api/agents/${agentId}/eval/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evalId: EVAL_ID, days: DAYS, clockSpeed: "fast", resetMemory: true }),
      });
      const data = await res.json();
      expect(res.ok, `eval start ${agentId}: ${JSON.stringify(data)}`).toBe(true);
      runIds.push(data.runId);
      console.log(`Eval started: ${agentId} → ${data.runId}`);
    }

    // ---------------------------------------------------------------
    // Step 4: Wait for first progress (detect immediate failures fast)
    // ---------------------------------------------------------------
    console.log("Waiting for first progress reports (first LLM call ~30-60s)...");
    await pollUntil(async () => {
      const runs = await (await fetch(`${FARM}/api/eval-runs`)).json() as any[];
      const ours = runs.filter((r: any) => runIds.includes(r.id));
      const running = ours.filter((r: any) => r.status === "running");
      const failed = ours.filter((r: any) => r.status === "failed");

      // If ANY run has appeared and failed, report immediately
      if (failed.length > 0) {
        // Check if ALL are failed (total failure) vs just some
        const failMsgs = failed.map((r: any) => `${r.agentId}: ${r.status}`).join(", ");
        if (failed.length === runIds.length) {
          return { done: false, failed: `All ${failed.length} evals failed: ${failMsgs}` };
        }
        console.log(`  Warning: ${failed.length} failed (${failMsgs}), ${running.length} still running`);
      }

      // Check eval logs for fatal errors if no runs appear after a while
      if (ours.length === 0) {
        // Check SSE log stream from each agent for errors
        for (const agentId of agentIds) {
          try {
            const logRes = await fetch(`${FARM}/api/agents/${agentId}/eval/logs`, {
              signal: AbortSignal.timeout(1000),
            });
            const text = await logRes.text();
            if (text.includes("Fatal error:") || text.includes("Error:")) {
              const errorLine = text.split("\n").find(l => l.includes("Fatal error:") || l.includes("Error:"));
              return { done: false, failed: `${agentId} eval error: ${errorLine}` };
            }
          } catch {} // timeout or not available yet
        }
      }

      if (running.length > 0) {
        const scores = running.map((r: any) => `${r.agentName}=${r.score ?? "?"}`).join(", ");
        console.log(`  Running: ${running.length}, scores: ${scores}`);
        return { done: true };
      }

      return { done: false };
    }, { intervalMs: 5000, timeoutMs: 360_000, label: "first progress" }); // 6min — first LLM call can take 2-4min

    // ---------------------------------------------------------------
    // Step 5: Wait for ≥2 checkpoints in progress history (needed for chart lines)
    // ---------------------------------------------------------------
    console.log("Waiting for chart data (≥2 checkpoints per series)...");
    await pollUntil(async () => {
      const history = await (await fetch(`${FARM}/api/eval-progress-history`)).json() as any[];
      const withLines = history.filter((s: any) => s.checkpoints.length >= 2);
      console.log(`  Progress: ${history.length} series, ${withLines.length} with ≥2 checkpoints`);
      return { done: withLines.length >= 1 };
    }, { intervalMs: 5000, timeoutMs: 300_000, label: "chart data" });

    // ---------------------------------------------------------------
    // Step 6: Load dashboard and verify charts render
    // ---------------------------------------------------------------
    await page.goto(`${FARM}/#/`);
    await page.waitForSelector("#content", { timeout: 5_000 });
    // Wait for polling cycle to fetch + draw
    await page.waitForTimeout(5000);

    const chartsVisible = await page.evaluate(() => {
      const el = document.getElementById("matrix-charts");
      return el ? el.style.display !== "none" && el.offsetHeight > 0 : false;
    });
    console.log(`Charts visible: ${chartsVisible}`);

    if (!chartsVisible) {
      // Force a data fetch and redraw
      await page.evaluate(() => {
        (window as any).fetchAndDrawMatrixCharts?.();
      });
      await page.waitForTimeout(2000);
    }

    // Verify charts have content (SVG-based)
    for (const chartId of ["chart-net-worth", "chart-cost-matrix", "chart-time"]) {
      const info = await page.evaluate((id) => {
        const container = document.getElementById(id);
        if (!container) return { exists: false, hasSvg: false, elements: 0 };
        const svg = container.querySelector("svg");
        if (!svg) return { exists: true, hasSvg: false, elements: 0 };
        // Count meaningful SVG elements (lines, circles, polylines, text)
        const elements = svg.querySelectorAll("line, circle, polyline, polygon, rect, text").length;
        return { exists: true, hasSvg: true, elements };
      }, chartId);

      console.log(`  ${chartId}: hasSvg=${info.hasSvg}, elements=${info.elements}`);
      expect(info.hasSvg, `${chartId} should contain an SVG`).toBe(true);
      expect(info.elements, `${chartId} should have SVG elements`).toBeGreaterThan(5);
    }

    // Screenshot while charts are live
    await page.screenshot({ path: "test/screenshots/dashboard-charts-live.png", fullPage: true });
    console.log("Live screenshot saved.");

    // ---------------------------------------------------------------
    // Step 7: Wait for at least 1 eval to complete (don't block on all 3)
    // ---------------------------------------------------------------
    console.log("Waiting for at least 1 eval to complete...");
    await pollUntil(async () => {
      const runs = await (await fetch(`${FARM}/api/eval-runs`)).json() as any[];
      const ours = runs.filter((r: any) => runIds.includes(r.id));
      const completed = ours.filter((r: any) => r.status === "completed");
      const failed = ours.filter((r: any) => r.status === "failed");
      const running = ours.filter((r: any) => r.status === "running");
      console.log(`  ${completed.length} completed, ${failed.length} failed, ${running.length} running`);
      if (failed.length === runIds.length) {
        return { done: false, failed: "All evals failed" };
      }
      return { done: completed.length >= 1 };
    }, { intervalMs: 10_000, timeoutMs: 480_000, label: "eval completion" });

    // Final screenshot with updated charts
    await page.reload();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "test/screenshots/dashboard-final.png", fullPage: true });
    console.log("Final screenshot saved.");
  });
});
