// Clawfarm Dashboard - Single-page app with hash routing
// All views are defined in this file for simplicity.

const POLL_MS = 5000;
const SIM_POLL_MS = 1000;
let pollTimer = null;
let expandedId = null;
let simActive = false;
let farmMode = "dev"; // loaded from /api/config on init

// Load farm mode and update UI
(async function loadFarmMode() {
  try {
    const cfg = await api("/config");
    if (cfg && cfg.mode) {
      farmMode = cfg.mode;
    }
  } catch {}
  const badge = document.getElementById("mode-badge");
  if (badge) {
    badge.textContent = farmMode;
    badge.className = `mode-badge mode-${farmMode}`;
  }
  // Hide sim controls in prod mode
  const simControls = document.getElementById("sim-controls");
  if (simControls && farmMode === "prod") {
    simControls.style.display = "none";
  }
})();

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatUptime(s) {
  if (!s) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}

function formatMetric(key, val) {
  if (key.includes("accuracy") || key.includes("rate") || key.includes("success")) return (val * 100).toFixed(0) + "%";
  if (key.includes("_ms")) return val.toFixed(0) + "ms";
  if (Number.isInteger(val)) return String(val);
  return val.toFixed(2);
}

function pctClass(p) { return p < 50 ? "low" : p < 80 ? "mid" : "high"; }
function scoreClass(p) { return p >= 0.6 ? "" : p >= 0.35 ? "medium" : "low"; }
function rateClass(p) { return p < 60 ? "" : p < 85 ? "warning" : "critical"; }

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function dimBadgeClass(d) {
  if (d === "2D+") return "dim-2Dplus";
  return `dim-${d}`;
}

function formatDollars(n) {
  if (n === undefined || n === null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDuration(ms) {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

// Pretty-print a camelCase key for display
function formatTaskKey(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

/** Render score breakdown panel for an eval's latest completed run. */
function renderScoreBreakdown(ev, run) {
  if (!run || !run.taskResults || Object.keys(run.taskResults).length === 0) return "";
  const isUnbounded = ev.maxScore === -1 || run.maxScore === -1;
  const entries = Object.entries(run.taskResults).filter(([k]) => k !== "_error");
  if (entries.length === 0) return "";

  // For simulation evals, group into "Net Worth Components" and "Performance"
  const isSimulation = ev.category === "simulation";
  let html = `<div class="panel" style="margin-top:16px"><h3>Score Breakdown</h3>`;

  if (isSimulation) {
    const netWorthKeys = ["bankBalance", "machineCash", "storageInventoryValue", "machineInventoryValue", "pendingCreditValue"];
    const perfKeys = ["totalRevenue", "totalSupplierSpend", "totalItemsSold", "grossMargin", "daysCompleted"];
    const nwEntries = entries.filter(([k]) => netWorthKeys.includes(k));
    const perfEntries = entries.filter(([k]) => perfKeys.includes(k));
    const otherEntries = entries.filter(([k]) => !netWorthKeys.includes(k) && !perfKeys.includes(k));

    if (nwEntries.length > 0) {
      html += `<h4 style="font-size:11px;color:#7d8590;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;margin-top:12px">Net Worth Components</h4>`;
      html += `<div class="stats-row" style="grid-template-columns:1fr 1fr 1fr">`;
      for (const [key, val] of nwEntries) {
        html += `<div class="stat-item"><span class="label">${formatTaskKey(key)}</span> <span class="value">${formatDollars(val)}</span></div>`;
      }
      html += `</div>`;
    }

    if (perfEntries.length > 0) {
      html += `<h4 style="font-size:11px;color:#7d8590;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;margin-top:12px">Performance</h4>`;
      html += `<div class="stats-row" style="grid-template-columns:1fr 1fr 1fr">`;
      for (const [key, val] of perfEntries) {
        const display = key === "totalItemsSold" || key === "daysCompleted"
          ? String(Math.round(val))
          : formatDollars(val);
        html += `<div class="stat-item"><span class="label">${formatTaskKey(key)}</span> <span class="value">${display}</span></div>`;
      }
      html += `</div>`;
    }

    if (otherEntries.length > 0) {
      html += `<div class="stats-row" style="margin-top:8px;grid-template-columns:1fr 1fr 1fr">`;
      for (const [key, val] of otherEntries) {
        html += `<div class="stat-item"><span class="label">${formatTaskKey(key)}</span> <span class="value">${typeof val === "number" && key.toLowerCase().includes("cost") ? formatDollars(val) : val}</span></div>`;
      }
      html += `</div>`;
    }
  } else {
    // Non-simulation: show as task checklist
    html += `<div class="stats-row" style="grid-template-columns:1fr 1fr">`;
    for (const [key, val] of entries) {
      const maxForTask = isUnbounded ? null : 1; // assume 1pt per task for scripted
      html += `<div class="stat-item"><span class="label">${formatTaskKey(key)}</span> <span class="value">${val}${maxForTask !== null ? "/" + maxForTask : ""}</span></div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/** Render operational run metrics panel. */
function renderRunMetrics(run) {
  if (!run) return "";
  const m = run.runMetrics;
  // Even without runMetrics, show basic stats if available
  const hasCost = run.costUsd !== undefined && run.costUsd > 0;
  if (!m && !hasCost) return "";

  let html = `<div class="panel" style="margin-top:16px"><h3>Run Metrics</h3>`;
  html += `<div class="stats-row" style="grid-template-columns:1fr 1fr 1fr 1fr">`;

  if (m) {
    if (m.llmCalls) html += `<div class="stat-item"><span class="label">LLM Calls</span> <span class="value">${m.llmCalls}</span></div>`;
    if (m.toolCalls) html += `<div class="stat-item"><span class="label">Tool Calls</span> <span class="value">${m.toolCalls}</span></div>`;
    if (m.messagesGenerated) html += `<div class="stat-item"><span class="label">Messages</span> <span class="value">${m.messagesGenerated}</span></div>`;
  }
  if (hasCost) html += `<div class="stat-item"><span class="label">API Cost</span> <span class="value">${formatDollars(run.costUsd)}</span></div>`;
  html += `</div>`;

  // Token breakdown
  if (m && m.tokenBreakdown) {
    const tb = m.tokenBreakdown;
    html += `<h4 style="font-size:11px;color:#7d8590;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;margin-top:12px">Token Usage</h4>`;
    html += `<div class="stats-row" style="grid-template-columns:1fr 1fr 1fr 1fr">`;
    if (tb.agentInputTokens) html += `<div class="stat-item"><span class="label">Agent Input</span> <span class="value">${formatTokens(tb.agentInputTokens)}</span></div>`;
    if (tb.agentOutputTokens) html += `<div class="stat-item"><span class="label">Agent Output</span> <span class="value">${formatTokens(tb.agentOutputTokens)}</span></div>`;
    if (tb.supplierInputTokens) html += `<div class="stat-item"><span class="label">Supplier Input</span> <span class="value">${formatTokens(tb.supplierInputTokens)}</span></div>`;
    if (tb.supplierOutputTokens) html += `<div class="stat-item"><span class="label">Supplier Output</span> <span class="value">${formatTokens(tb.supplierOutputTokens)}</span></div>`;
    html += `</div>`;
  }

  // Extra metrics
  if (m && m.extra && Object.keys(m.extra).length > 0) {
    const extraEntries = Object.entries(m.extra).filter(([, v]) => v !== undefined && v !== "");
    if (extraEntries.length > 0) {
      html += `<div class="stats-row" style="margin-top:8px;grid-template-columns:1fr 1fr">`;
      for (const [key, val] of extraEntries) {
        html += `<div class="stat-item"><span class="label">${formatTaskKey(key)}</span> <span class="value">${val}</span></div>`;
      }
      html += `</div>`;
    }
  }

  html += `</div>`;
  return html;
}

async function api(path) {
  const r = await fetch(`/api${path}`);
  return r.json();
}

function $(sel) { return document.querySelector(sel); }

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route() {
  const hash = location.hash || "#/";
  const parts = hash.slice(2).split("/");
  const page = parts[0] || "dashboard";
  const id = parts[1] || null;

  // Update nav
  document.querySelectorAll(".nav-link").forEach((el) => {
    const tab = el.dataset.tab;
    el.classList.toggle("active", tab === page || (page === "" && tab === "dashboard"));
  });

  stopPolling();

  if (page === "" || page === "dashboard") renderDashboard();
  else if (page === "agent" && id) renderAgentDetail(id);
  else if (page === "cost") renderCost();
  else if (page === "evals") renderEvals();
  else if (page === "eval" && id) renderEvalDetail(id);
  else if (page === "matrix") renderMatrix();
  else if (page === "variants") renderVariants();
  else renderDashboard();
}

let currentPollFn = null;
function startPolling(fn) {
  currentPollFn = fn;
  fn();
  const ms = simActive ? SIM_POLL_MS : POLL_MS;
  pollTimer = setInterval(fn, ms);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function restartPollingWithNewInterval() {
  if (!currentPollFn) return;
  stopPolling();
  const ms = simActive ? SIM_POLL_MS : POLL_MS;
  pollTimer = setInterval(currentPollFn, ms);
}

window.addEventListener("hashchange", route);
window.addEventListener("load", route);

// Stop All
window.handleStopAll = async function () {
  const btn = $("#stop-all-btn");
  if (btn.classList.contains("confirming")) {
    btn.textContent = "Stopping...";
    await fetch("/api/stop-all", { method: "POST" });
    btn.textContent = "Stopped";
    btn.disabled = true;
    setTimeout(() => { btn.textContent = "Stop All"; btn.disabled = false; btn.classList.remove("confirming"); }, 3000);
  } else {
    btn.classList.add("confirming");
    btn.textContent = "Confirm Stop All?";
    setTimeout(() => { if (btn.classList.contains("confirming")) { btn.classList.remove("confirming"); btn.textContent = "Stop All"; } }, 4000);
  }
};

// ---------------------------------------------------------------------------
// Sim Controls
// ---------------------------------------------------------------------------

let simStatusTimer = null;

async function updateSimUI() {
  const status = await api("/sim/status");
  const wasActive = simActive;
  simActive = status.status === "running" || status.status === "paused";

  const statusEl = $("#sim-status");
  const progressEl = $("#sim-progress");
  const startBtn = $("#sim-start-btn");
  const stopBtn = $("#sim-stop-btn");

  if (statusEl) statusEl.textContent = status.status;
  if (progressEl) {
    if (status.status === "idle") {
      progressEl.textContent = "";
    } else {
      progressEl.textContent = `${status.step}/${status.totalSteps}`;
      if (status.evalScore !== null) {
        progressEl.textContent += ` — ${status.evalScore}/${status.evalMaxScore}`;
      }
    }
  }

  if (startBtn) {
    startBtn.disabled = status.status === "running";
    startBtn.textContent = status.status === "paused" ? "Resume" : status.status === "completed" ? "Done" : "Start";
    if (status.status === "completed") startBtn.disabled = true;
  }
  if (stopBtn) {
    stopBtn.disabled = status.status !== "running";
  }

  // Switch polling speed if sim state changed
  if (wasActive !== simActive) {
    restartPollingWithNewInterval();
  }
}

function startSimStatusPolling() {
  updateSimUI();
  simStatusTimer = setInterval(updateSimUI, 1000);
}

window.handleSimStart = async function () {
  await fetch("/api/sim/start", { method: "POST" });
  simActive = true;
  restartPollingWithNewInterval();
  updateSimUI();
};

window.handleSimStop = async function () {
  await fetch("/api/sim/stop", { method: "POST" });
  updateSimUI();
};

window.handleSimReset = async function () {
  await fetch("/api/sim/reset", { method: "POST" });
  simActive = false;
  restartPollingWithNewInterval();
  updateSimUI();
};

// Start sim status polling on page load
window.addEventListener("load", startSimStatusPolling);

// ---------------------------------------------------------------------------
// Chat with live agents
// ---------------------------------------------------------------------------

window.handleChatSend = async function (agentId) {
  const input = $("#chat-input");
  const btn = $("#chat-send-btn");
  const status = $("#chat-status");
  const msgFeed = $("#msg-feed");

  const message = input.value.trim();
  if (!message) return;

  // Disable input while waiting
  input.disabled = true;
  btn.disabled = true;
  btn.textContent = "...";
  status.textContent = "Sending to agent...";
  status.className = "chat-status sending";

  // Optimistically show user message in feed
  const userHtml = `
    <div class="message-item msg-user">
      <div class="msg-header">
        <span class="msg-role user">user</span>
        <span class="msg-time">now</span>
      </div>
      <div class="msg-content">${escapeHtml(message)}</div>
    </div>`;
  if (msgFeed) {
    msgFeed.insertAdjacentHTML("beforeend", userHtml);
    msgFeed.scrollTop = msgFeed.scrollHeight;
  }
  // Bump the poll counter so the polling loop doesn't re-add this message
  if (window._agentDetailMsgCount) {
    window._agentDetailMsgCount.set(window._agentDetailMsgCount.get() + 1);
  }

  input.value = "";

  try {
    const res = await fetch(`/api/agents/${agentId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();

    if (!res.ok) {
      status.textContent = `Error: ${data.error || res.statusText}`;
      status.className = "chat-status error";
      return;
    }

    status.textContent = "";
    status.className = "chat-status";

    // Show assistant response in feed
    if (data.reply && msgFeed) {
      const replyHtml = `
        <div class="message-item msg-assistant">
          <div class="msg-header">
            <span class="msg-role assistant">assistant</span>
            <span class="msg-time">now</span>
          </div>
          <div class="msg-content">${formatMessageContent(escapeHtml(data.reply))}</div>
        </div>`;
      msgFeed.insertAdjacentHTML("beforeend", replyHtml);
      msgFeed.scrollTop = msgFeed.scrollHeight;
    }
    // Bump counter for the assistant message too
    if (window._agentDetailMsgCount) {
      window._agentDetailMsgCount.set(window._agentDetailMsgCount.get() + 1);
    }
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    status.className = "chat-status error";
  } finally {
    input.disabled = false;
    btn.disabled = false;
    btn.textContent = "Send";
    input.focus();
  }
};

// ---------------------------------------------------------------------------
// Eval controls for live agents
// ---------------------------------------------------------------------------

async function loadEvalControls(agentId) {
  const evalList = $("#eval-list");
  if (!evalList) return;

  try {
    const evals = await api(`/agents/${agentId}/evals`);
    if (!evals || evals.error || !Array.isArray(evals) || evals.length === 0) {
      evalList.innerHTML = "<p style='color:#7d8590;font-size:13px'>No evals available</p>";
      return;
    }
    evalList.innerHTML = evals.map(ev => `
      <div class="eval-item" style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #21262d">
        <div>
          <strong style="font-size:13px">${escapeHtml(ev.name)}</strong>
          <div style="font-size:11px;color:#7d8590">${ev.category} · ${ev.messageCount} messages · ${ev.taskCount} tasks · max ${ev.maxScore}pts</div>
        </div>
        <button class="eval-start-btn" onclick="handleStartEval('${agentId}', '${ev.id}')" style="padding:4px 12px;font-size:12px;background:#238636;color:#fff;border:none;border-radius:4px;cursor:pointer">Run</button>
      </div>
    `).join("");
  } catch (err) {
    evalList.innerHTML = `<p style="color:#f85149;font-size:13px">Failed to load evals: ${err.message}</p>`;
  }
}

window.handleStartEval = async function (agentId, evalId) {
  const statusEl = $("#eval-run-status");
  // Disable all start buttons
  document.querySelectorAll(".eval-start-btn").forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  });
  if (statusEl) {
    statusEl.textContent = "Starting eval...";
    statusEl.className = "chat-status sending";
  }

  try {
    const res = await fetch(`/api/agents/${agentId}/eval/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evalId, clockSpeed: "fast" }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (statusEl) {
        statusEl.textContent = `Error: ${data.error || res.statusText}`;
        statusEl.className = "chat-status error";
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = `Eval started: ${data.evalName} (${data.runId}). Watch the transcript for progress.`;
      statusEl.className = "chat-status sending";
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `Failed: ${err.message}`;
      statusEl.className = "chat-status error";
    }
  } finally {
    // Re-enable buttons after a delay
    setTimeout(() => {
      document.querySelectorAll(".eval-start-btn").forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = "1";
      });
    }, 5000);
  }
};

// ---------------------------------------------------------------------------
// VIEW: Dashboard
// ---------------------------------------------------------------------------

async function renderDashboard() {
  const content = $("#content");
  content.innerHTML = `<div id="summary" class="summary-bar"></div><div id="grid" class="grid"></div>`;

  startPolling(async () => {
    const agents = await api("/agents");
    const evalSummaries = await Promise.all(
      agents.map(a => api(`/agents/${a.id}/eval-summary`))
    );
    const evalMap = {};
    agents.forEach((a, i) => { evalMap[a.id] = evalSummaries[i]; });
    renderDashboardSummary(agents);
    renderDashboardGrid(agents, evalMap);
  });
}

function renderDashboardSummary(agents) {
  const on = agents.filter(a => a.status === "online").length;
  const err = agents.filter(a => a.status === "error").length;
  const off = agents.filter(a => a.status === "offline").length;
  const cost = agents.reduce((s, a) => s + a.costEstimatedUsd, 0);
  const msgs = agents.reduce((s, a) => s + a.messagesProcessed, 0);
  const ev = agents.filter(a => a.mode === "eval").length;
  const rw = agents.filter(a => a.mode === "real-world").length;
  $("#summary").innerHTML = `
    <span class="stat"><strong>${on}</strong> online</span>
    <span class="stat"><strong>${err}</strong> errors</span>
    <span class="stat"><strong>${off}</strong> offline</span>
    <span class="stat"><strong>${ev}</strong> eval / <strong>${rw}</strong> real-world</span>
    <span class="stat"><strong>${msgs.toLocaleString()}</strong> messages</span>
    <span class="stat">Total cost: <strong>$${cost.toFixed(2)}</strong></span>`;
}

function renderDashboardGrid(agents, evalMap) {
  $("#grid").innerHTML = agents.map(a => {
    const pct = a.contextTokensAvailable > 0 ? (a.contextTokensUsed / a.contextTokensAvailable) * 100 : 0;
    const topMetrics = Object.entries(a.metrics).slice(0, 3);
    const es = evalMap[a.id] || {};
    const lastRun = es.lastRun;
    const varBest = es.variantBest;

    let evalHtml = "";
    if (lastRun) {
      const lastPct = lastRun.maxScore > 0 ? ((lastRun.score / lastRun.maxScore) * 100).toFixed(0) : 0;
      evalHtml += `
      <div class="eval-summary-row">
        <div class="eval-summary-item">
          <span class="label">last eval</span>
          <span class="eval-score-inline">${lastRun.score}/${lastRun.maxScore}</span>
          <span class="eval-pct-inline ${Number(lastPct) >= 60 ? 'good' : Number(lastPct) >= 35 ? 'mid' : 'poor'}">${lastPct}%</span>
        </div>
        <div class="eval-summary-detail">${lastRun.evalName}</div>
      </div>`;
    }
    if (varBest) {
      const bestPct = varBest.maxScore > 0 ? ((varBest.score / varBest.maxScore) * 100).toFixed(0) : 0;
      evalHtml += `
      <div class="eval-summary-row variant-best">
        <div class="eval-summary-item">
          <span class="label">variant best</span>
          <span class="eval-score-inline">${varBest.score}/${varBest.maxScore}</span>
          <span class="eval-pct-inline ${Number(bestPct) >= 60 ? 'good' : Number(bestPct) >= 35 ? 'mid' : 'poor'}">${bestPct}%</span>
        </div>
        <div class="eval-summary-detail">${varBest.evalName}${varBest.agentName !== a.name ? ` (${varBest.agentName})` : ''}</div>
      </div>`;
    }

    return `
    <a href="#/agent/${a.id}" class="card" style="text-decoration:none;color:inherit;display:block">
      <div class="card-header">
        <div class="status-dot ${a.status}"></div>
        <span class="agent-name">${a.name}</span>
        <span class="badge mode-${a.mode}">${a.mode}</span>
      </div>
      <span class="variant-label">${a.memoryVariant}</span>
      <div class="stats-row">
        <div class="stat-item"><span class="label">uptime</span> <span class="value">${formatUptime(a.uptimeSeconds)}</span></div>
        <div class="stat-item"><span class="label">messages</span> <span class="value">${a.messagesProcessed.toLocaleString()}</span></div>
        <div class="stat-item"><span class="label">sessions</span> <span class="value">${a.sessionsActive}/${a.sessionsTotal}</span></div>
        <div class="stat-item"><span class="label">tokens in</span> <span class="value">${formatTokens(a.costInputTokens)}</span></div>
      </div>
      <div class="context-bar-container">
        <div class="context-bar-label">context: ${formatTokens(a.contextTokensUsed)} / ${formatTokens(a.contextTokensAvailable)} (${pct.toFixed(0)}%)</div>
        <div class="context-bar"><div class="context-bar-fill ${pctClass(pct)}" style="width:${pct}%"></div></div>
      </div>
      ${evalHtml}
      ${topMetrics.length ? `<div style="margin-top:6px;font-size:11px;color:#7d8590">${topMetrics.map(([k,v]) => `${k}: ${formatMetric(k,v)}`).join(" · ")}</div>` : ""}
      <div class="cost-row">cost: <span class="cost-value">$${a.costEstimatedUsd.toFixed(2)}</span></div>
    </a>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// VIEW: Agent Detail
// ---------------------------------------------------------------------------

async function renderAgentDetail(id) {
  const content = $("#content");
  content.innerHTML = "<p>Loading...</p>";

  // Render shell once, then poll for updates
  let lastMsgCount = 0;
  let lastGraphNodeCount = 0;
  let shellRendered = false;
  // Expose lastMsgCount so handleChatSend can bump it after optimistic insertion
  window._agentDetailMsgCount = { get: () => lastMsgCount, set: (n) => { lastMsgCount = n; } };

  startPolling(async () => {
    const [agent, graph, messages] = await Promise.all([
      api(`/agents/${id}`), api(`/agents/${id}/memory-graph`), api(`/agents/${id}/messages`)
    ]);

    if (!agent || agent.error) {
      content.innerHTML = `<a href="#/" class="back-link">← Back</a><p>Agent not found.</p>`;
      return;
    }

    if (!shellRendered) {
      shellRendered = true;
      content.innerHTML = `
        <a href="#/" class="back-link">← Back to Dashboard</a>
        <div class="page-header">
          <h2><span class="status-dot ${agent.status}" style="display:inline-block;vertical-align:middle;margin-right:8px" id="agent-status-dot"></span><span id="agent-name">${agent.name}</span></h2>
          <p id="agent-subtitle">${agent.memoryVariant} · ${agent.mode} · uptime ${formatUptime(agent.uptimeSeconds)}</p>
        </div>

        <div class="detail-grid">
          <div>
            <div class="panel">
              <h3>Memory Structure <span id="graph-stats" style="font-size:11px;color:#7d8590;font-weight:400">${graph.nodes.length} nodes · ${graph.edges.length} edges</span></h3>
              <div class="memory-graph-container"><canvas id="mem-graph"></canvas></div>
            </div>

            <div class="panel">
              <h3>Integrations</h3>
              <div id="integrations-list">
                ${renderIntegrations(agent)}
              </div>
            </div>

            <div class="panel" id="eval-controls-panel" style="display:none">
              <h3>Eval Controls</h3>
              <div id="eval-controls">
                <div id="eval-list" style="margin-bottom:8px">Loading available evals...</div>
                <div id="eval-run-status" class="chat-status"></div>
              </div>
            </div>
          </div>

          <div>
            <div class="panel">
              <h3>Performance</h3>
              <div id="perf-stats">
                ${renderPerfStats(agent)}
              </div>
            </div>

            <div class="panel">
              <h3>Session Transcript <span id="msg-stats" style="font-size:12px;color:#7d8590;font-weight:400">${messages.length} messages · ${messages.reduce((s,m) => s + m.tokenCount, 0).toLocaleString()} tokens</span></h3>
              <div class="message-feed" id="msg-feed">
                ${renderMessages(messages)}
              </div>
              <div class="chat-input-area" id="chat-area" style="display:none">
                <div class="chat-input-row">
                  <input type="text" id="chat-input" placeholder="Send a message to the agent..." autocomplete="off" />
                  <button id="chat-send-btn" onclick="handleChatSend('${id}')">Send</button>
                </div>
                <div id="chat-status" class="chat-status"></div>
              </div>
            </div>
          </div>
        </div>`;

      lastMsgCount = messages.length;
      lastGraphNodeCount = graph.nodes.length;
      setTimeout(() => drawMemoryGraph("mem-graph", graph), 50);

      // Enable chat input and enter-to-send
      const chatInput = $("#chat-input");
      if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleChatSend(id);
          }
        });
      }
      return;
    }

    // Incremental updates

    // Update subtitle (uptime etc)
    const subtitleEl = $("#agent-subtitle");
    if (subtitleEl) subtitleEl.textContent = `${agent.memoryVariant} · ${agent.mode} · uptime ${formatUptime(agent.uptimeSeconds)}`;

    // Update status dot
    const dotEl = $("#agent-status-dot");
    if (dotEl) dotEl.className = `status-dot ${agent.status}`;

    // Update perf stats
    const perfEl = $("#perf-stats");
    if (perfEl) perfEl.innerHTML = renderPerfStats(agent);

    // Update integrations
    const intEl = $("#integrations-list");
    if (intEl) intEl.innerHTML = renderIntegrations(agent);

    // Show chat input and eval controls for live agents
    const isLive = agent.integrations.some(i => i.name === "Farm Dashboard" && i.status === "connected");
    const chatArea = $("#chat-area");
    if (chatArea) {
      chatArea.style.display = isLive ? "block" : "none";
    }
    const evalPanel = $("#eval-controls-panel");
    if (evalPanel) {
      evalPanel.style.display = isLive ? "block" : "none";
      if (isLive && !evalPanel.dataset.loaded) {
        evalPanel.dataset.loaded = "1";
        loadEvalControls(id);
      }
    }

    // Update messages incrementally — only append new ones
    const msgFeed = $("#msg-feed");
    const msgStats = $("#msg-stats");
    if (msgStats) msgStats.textContent = `${messages.length} messages · ${messages.reduce((s,m) => s + m.tokenCount, 0).toLocaleString()} tokens`;

    if (msgFeed && messages.length > lastMsgCount) {
      const newMessages = messages.slice(lastMsgCount);
      msgFeed.insertAdjacentHTML("beforeend", renderMessages(newMessages));
      lastMsgCount = messages.length;
      // Auto-scroll to bottom
      msgFeed.scrollTop = msgFeed.scrollHeight;
    }

    // Redraw graph if nodes changed
    const graphStats = $("#graph-stats");
    if (graphStats) graphStats.textContent = `${graph.nodes.length} nodes · ${graph.edges.length} edges`;
    if (graph.nodes.length !== lastGraphNodeCount) {
      lastGraphNodeCount = graph.nodes.length;
      setTimeout(() => drawMemoryGraph("mem-graph", graph), 50);
    }
  });
}

function renderPerfStats(agent) {
  const pct = agent.contextTokensAvailable > 0 ? (agent.contextTokensUsed / agent.contextTokensAvailable) * 100 : 0;
  return `
    <div class="stats-row">
      <div class="stat-item"><span class="label">messages</span> <span class="value">${agent.messagesProcessed}</span></div>
      <div class="stat-item"><span class="label">sessions</span> <span class="value">${agent.sessionsActive}/${agent.sessionsTotal}</span></div>
    </div>
    <div class="context-bar-container">
      <div class="context-bar-label">context: ${formatTokens(agent.contextTokensUsed)} / ${formatTokens(agent.contextTokensAvailable)} (${pct.toFixed(0)}%)</div>
      <div class="context-bar"><div class="context-bar-fill ${pctClass(pct)}" style="width:${pct}%"></div></div>
    </div>
    <div style="margin-top:8px">
      ${Object.entries(agent.metrics).map(([k,v]) =>
        `<div class="metric-row"><span class="key">${k}</span><span class="val">${formatMetric(k, v)}</span></div>`
      ).join("")}
    </div>
    <div class="cost-row" style="margin-top:12px">
      In: ${formatTokens(agent.costInputTokens)} · Out: ${formatTokens(agent.costOutputTokens)} · Cache: ${formatTokens(agent.costCacheReadTokens)}
      <br>Total: <span class="cost-value">$${agent.costEstimatedUsd.toFixed(2)}</span>
    </div>`;
}

function renderIntegrations(agent) {
  if (agent.integrations.length === 0) return "<p style='font-size:13px;color:#7d8590'>No integrations configured</p>";
  return agent.integrations.map(i => `
    <div class="integration-item">
      <div class="status-dot ${i.status}"></div>
      <span class="int-name">${i.name}</span>
      <span class="badge">${i.type}</span>
      <span class="int-detail">${timeAgo(i.lastCheck)}${i.details ? " · " + i.details : ""}</span>
    </div>
  `).join("");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMessages(messages) {
  let html = "";
  let lastSession = null;

  for (const m of messages) {
    // Detect session boundaries from system messages
    if (m.role === "system" && m.content.includes("[Session Start]")) {
      const sessionMatch = m.content.match(/Session (\d+) of (\d+)/);
      const sessionLabel = sessionMatch ? `Session ${sessionMatch[1]} of ${sessionMatch[2]}` : "New Session";
      html += `<div class="session-divider"><span>${sessionLabel}</span></div>`;
    }

    // Detect eval completion
    if (m.role === "system" && m.content.includes("[Eval Complete]")) {
      html += renderEvalResult(m);
      continue;
    }

    // Detect tool calls (memory_search, memory_write, web_search, web_action)
    if (m.role === "tool") {
      html += renderToolCall(m);
      continue;
    }

    // Regular message
    const content = formatMessageContent(escapeHtml(m.content));
    html += `
      <div class="message-item msg-${m.role}">
        <div class="msg-header">
          <span class="msg-role ${m.role}">${m.role}</span>
          <span class="msg-time">${timeAgo(m.timestamp)}</span>
          <span class="msg-tokens">${m.tokenCount} tok</span>
        </div>
        <div class="msg-content">${content}</div>
      </div>`;
  }
  return html;
}

function renderToolCall(m) {
  const content = m.content;
  let toolType = "generic";
  let icon = "⚙";
  let label = "Tool";

  if (content.includes("memory_search")) { toolType = "memory-read"; icon = "🔍"; label = "Memory Search"; }
  else if (content.includes("memory_write")) { toolType = "memory-write"; icon = "💾"; label = "Memory Write"; }
  else if (content.includes("memory_get")) { toolType = "memory-read"; icon = "📖"; label = "Memory Get"; }
  else if (content.includes("web_search")) { toolType = "web"; icon = "🌐"; label = "Web Search"; }
  else if (content.includes("web_action")) { toolType = "web-action"; icon = "🛒"; label = "Web Action"; }

  return `
    <div class="message-item tool-call tool-${toolType}">
      <div class="msg-header">
        <span class="tool-icon">${icon}</span>
        <span class="tool-label">${label}</span>
        <span class="msg-time">${timeAgo(m.timestamp)}</span>
        <span class="msg-tokens">${m.tokenCount} tok</span>
      </div>
      <div class="tool-content">${formatMessageContent(escapeHtml(m.content))}</div>
    </div>`;
}

function renderEvalResult(m) {
  const scoreMatch = m.content.match(/Score: ([\d.]+)\/([\d.]+)/);
  const score = scoreMatch ? scoreMatch[1] : "?";
  const max = scoreMatch ? scoreMatch[2] : "?";
  const pctMatch = m.content.match(/([\d.]+)%/);
  const pct = pctMatch ? parseFloat(pctMatch[1]) : 0;

  return `
    <div class="message-item eval-result">
      <div class="msg-header">
        <span class="msg-role system">eval</span>
        <span class="msg-time">${timeAgo(m.timestamp)}</span>
      </div>
      <div class="eval-score-banner">
        <div class="eval-score-big">${score}<span class="eval-score-max">/${max}</span></div>
        <div class="score-bar" style="margin:8px 0"><div class="score-bar-fill ${scoreClass(pct/100)}" style="width:${pct}%"></div></div>
      </div>
      <div class="tool-content">${formatMessageContent(escapeHtml(m.content))}</div>
    </div>`;
}

function formatMessageContent(html) {
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Headers: ### text or ## text
  html = html.replace(/^###\s+(.+)$/gm, '<div style="font-weight:600;color:#e6edf3;margin:8px 0 4px">$1</div>');
  html = html.replace(/^##\s+(.+)$/gm, '<div style="font-weight:600;color:#e6edf3;font-size:14px;margin:10px 0 4px">$1</div>');
  // Checkmarks and warnings
  html = html.replace(/✅/g, '<span style="color:#3fb950">✅</span>');
  html = html.replace(/⚠️/g, '<span style="color:#d29922">⚠️</span>');
  html = html.replace(/❌/g, '<span style="color:#f85149">❌</span>');
  // Simple table detection (lines with |)
  html = html.replace(/\|([^|]+\|)+/g, (match) => {
    return '<span style="font-size:11px;color:#7d8590">' + match + '</span>';
  });
  // Newlines
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ---------------------------------------------------------------------------
// Force-directed graph on canvas
// ---------------------------------------------------------------------------

function drawMemoryGraph(canvasId, graph) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  const typeColors = {
    core: "#58a6ff", daily: "#3fb950", topic: "#bc8cff",
    fact: "#d29922", entity: "#f0883e", community: "#f85149",
  };

  // Initialize positions
  const positions = {};
  graph.nodes.forEach((n, i) => {
    const angle = (i / graph.nodes.length) * Math.PI * 2;
    const r = Math.min(W, H) * 0.3;
    positions[n.id] = {
      x: W / 2 + Math.cos(angle) * r + (Math.random() - 0.5) * 40,
      y: H / 2 + Math.sin(angle) * r + (Math.random() - 0.5) * 40,
      vx: 0, vy: 0,
    };
  });

  // Simple force simulation
  const edgeIndex = new Map();
  graph.edges.forEach(e => { edgeIndex.set(e.source + "|" + e.target, e.weight); });

  function simulate() {
    const nodes = graph.nodes;
    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions[nodes[i].id], b = positions[nodes[j].id];
        let dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 800 / (dist * dist);
        a.vx -= (dx / dist) * force;
        a.vy -= (dy / dist) * force;
        b.vx += (dx / dist) * force;
        b.vy += (dy / dist) * force;
      }
    }
    // Attraction (edges)
    graph.edges.forEach(e => {
      const a = positions[e.source], b = positions[e.target];
      if (!a || !b) return;
      let dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = (dist - 80) * 0.03 * e.weight;
      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force;
      b.vy -= (dy / dist) * force;
    });
    // Center gravity
    nodes.forEach(n => {
      const p = positions[n.id];
      p.vx += (W / 2 - p.x) * 0.005;
      p.vy += (H / 2 - p.y) * 0.005;
    });
    // Update positions
    nodes.forEach(n => {
      const p = positions[n.id];
      p.vx *= 0.85; p.vy *= 0.85;
      p.x += p.vx; p.y += p.vy;
      p.x = Math.max(30, Math.min(W - 30, p.x));
      p.y = Math.max(30, Math.min(H - 30, p.y));
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // Edges
    ctx.lineWidth = 1;
    graph.edges.forEach(e => {
      const a = positions[e.source], b = positions[e.target];
      if (!a || !b) return;
      ctx.strokeStyle = `rgba(88,166,255,${0.15 + e.weight * 0.3})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    // Nodes
    graph.nodes.forEach(n => {
      const p = positions[n.id];
      const r = Math.max(6, Math.min(n.size * 0.6, 30));
      const color = typeColors[n.type] || "#7d8590";
      // Glow
      ctx.fillStyle = color + "33";
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.fill();
      // Node
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      // Label
      ctx.fillStyle = "#c9d1d9";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(n.label, p.x, p.y + r + 14);
      // Count
      ctx.fillStyle = "#7d8590";
      ctx.font = "9px monospace";
      ctx.fillText(`${n.itemCount} items`, p.x, p.y + r + 24);
    });
  }

  // Run simulation
  let frames = 0;
  function tick() {
    simulate();
    draw();
    frames++;
    if (frames < 120) requestAnimationFrame(tick);
  }
  tick();
}

// ---------------------------------------------------------------------------
// VIEW: Cost
// ---------------------------------------------------------------------------

async function renderCost() {
  const content = $("#content");
  content.innerHTML = "<p>Loading...</p>";

  const [history, config, keys] = await Promise.all([
    api("/cost/history"), api("/cost/config"), api("/cost/keys")
  ]);

  const totalCost = history.length > 0 ? history[history.length - 1].totalUsd : 0;
  const capPct = config.globalCapUsd > 0 ? (totalCost / config.globalCapUsd) * 100 : 0;

  content.innerHTML = `
    <div class="page-header"><h2>Cost Management</h2><p>Track spending, set caps, manage API keys</p></div>

    <div class="summary-bar">
      <span class="stat">Current spend: <strong>$${totalCost.toFixed(2)}</strong></span>
      <span class="stat">Global cap: <strong>$${config.globalCapUsd.toFixed(2)}</strong></span>
      <span class="stat">Used: <strong>${capPct.toFixed(0)}%</strong></span>
      <span class="stat">Per-run cap: <strong>$${config.perEvalRunCapUsd.toFixed(2)}</strong></span>
    </div>

    <div class="panel">
      <h3>Cost Over Time (15-min intervals)</h3>
      <div class="chart-container"><canvas id="cost-chart"></canvas></div>
    </div>

    <div class="two-col">
      <div class="panel">
        <h3>Cost Caps</h3>
        <div class="config-row"><label>Global cost cap ($)</label><input type="number" value="${config.globalCapUsd}" step="10" /></div>
        <div class="config-row"><label>Per eval run cap ($)</label><input type="number" value="${config.perEvalRunCapUsd}" step="1" /></div>
        <div class="config-row"><label>Warning threshold (%)</label><input type="number" value="${config.warningThresholdPct}" step="5" min="0" max="100" /></div>
        <div class="config-row"><label>Auto-stop on cap</label><select><option ${config.autoStopOnCap ? "selected" : ""}>Yes</option><option ${!config.autoStopOnCap ? "selected" : ""}>No</option></select></div>
      </div>

      <div class="panel">
        <h3>API Keys & Rate Limits</h3>
        ${keys.map(k => {
          const rpct = k.rateLimitRpm > 0 ? (k.currentUsageRpm / k.rateLimitRpm) * 100 : 0;
          return `
          <div class="key-card">
            <div class="key-header">
              <div class="status-dot ${k.status === "active" ? "online" : k.status === "rate-limited" ? "error" : "offline"}"></div>
              <span class="key-label">${k.label}${k.isPrimary ? " (primary)" : ""}</span>
              <span class="badge">${k.provider}</span>
            </div>
            <div class="key-prefix">${k.keyPrefix}</div>
            <div class="key-stats">
              <div class="stat-item"><span class="label">RPM</span> <span class="value">${k.currentUsageRpm}/${k.rateLimitRpm}</span></div>
              <div class="stat-item"><span class="label">spent</span> <span class="value">$${k.totalSpentUsd.toFixed(2)}</span></div>
            </div>
            <div class="rate-bar"><div class="rate-bar-fill ${rateClass(rpct)}" style="width:${rpct}%"></div></div>
          </div>`;
        }).join("")}
      </div>
    </div>`;

  setTimeout(() => drawCostChart("cost-chart", history), 50);
}

function drawCostChart(canvasId, history) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const pad = { top: 20, right: 20, bottom: 40, left: 60 };
  const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;

  if (history.length < 2) return;

  const maxVal = Math.max(...history.map(h => h.totalUsd)) * 1.1 || 1;

  // Grid
  ctx.strokeStyle = "#21262d";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#7d8590";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText("$" + ((maxVal * (4 - i)) / 4).toFixed(1), pad.left - 8, y + 4);
  }

  // X labels
  ctx.textAlign = "center";
  ctx.fillStyle = "#7d8590";
  const step = Math.max(1, Math.floor(history.length / 6));
  history.forEach((h, i) => {
    if (i % step !== 0 && i !== history.length - 1) return;
    const x = pad.left + (i / (history.length - 1)) * cW;
    const t = new Date(h.timestamp);
    ctx.fillText(`${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`, x, H - pad.bottom + 20);
  });

  // Line
  ctx.strokeStyle = "#58a6ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((h, i) => {
    const x = pad.left + (i / (history.length - 1)) * cW;
    const y = pad.top + cH - (h.totalUsd / maxVal) * cH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill under line
  const lastX = pad.left + cW;
  const baseline = pad.top + cH;
  ctx.lineTo(lastX, baseline);
  ctx.lineTo(pad.left, baseline);
  ctx.closePath();
  ctx.fillStyle = "#58a6ff15";
  ctx.fill();

  // Dots
  ctx.fillStyle = "#58a6ff";
  history.forEach((h, i) => {
    const x = pad.left + (i / (history.length - 1)) * cW;
    const y = pad.top + cH - (h.totalUsd / maxVal) * cH;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  });
}

// ---------------------------------------------------------------------------
// VIEW: Evals
// ---------------------------------------------------------------------------

async function renderEvals() {
  const content = $("#content");
  const evals = await api("/evals");

  content.innerHTML = `
    <div class="page-header"><h2>Evaluations</h2><p>Memory system benchmarks across ${evals.length} eval types</p></div>
    <div class="grid">
      ${evals.map(ev => {
        const hs = ev.highScore;
        const hsPct = hs ? (hs.score / hs.maxScore) : 0;
        const running = ev.recentRuns.filter(r => r.status === "running").length;
        return `
        <div class="card" onclick="location.hash='#/eval/${ev.id}'">
          <div class="card-header">
            <span class="agent-name">${ev.name}</span>
            <span class="badge cat-${ev.category}">${ev.category}</span>
          </div>
          <p style="font-size:12px;color:#7d8590;margin-bottom:10px;line-height:1.4">${ev.description.slice(0, 120)}${ev.description.length > 120 ? "..." : ""}</p>
          <div class="stats-row">
            <div class="stat-item"><span class="label">tasks</span> <span class="value">${ev.taskCount}</span></div>
            <div class="stat-item"><span class="label">runs</span> <span class="value">${ev.recentRuns.length}${running ? ` (${running} running)` : ""}</span></div>
          </div>
          ${hs ? `
            <div style="margin-top:8px">
              <div class="context-bar-label">high score: ${hs.score}/${hs.maxScore} (${(hsPct * 100).toFixed(0)}%) — ${hs.agentName}</div>
              <div class="score-bar"><div class="score-bar-fill ${scoreClass(hsPct)}" style="width:${hsPct * 100}%"></div></div>
            </div>
          ` : `<div style="font-size:12px;color:#484f58;margin-top:8px">No scores yet</div>`}
        </div>`;
      }).join("")}
    </div>`;
}

// ---------------------------------------------------------------------------
// VIEW: Eval Detail
// ---------------------------------------------------------------------------

async function renderEvalDetail(id) {
  const content = $("#content");
  const ev = await api(`/evals/${id}`);
  if (!ev || ev.error) { content.innerHTML = `<a href="#/evals" class="back-link">← Back</a><p>Eval not found.</p>`; return; }

  const hs = ev.highScore;
  const isUnbounded = ev.maxScore === -1 || (hs && hs.maxScore === -1);
  const hsPct = hs && !isUnbounded ? (hs.score / hs.maxScore) : 0;
  const latestCompleted = ev.recentRuns.find(r => r.status === "completed");

  content.innerHTML = `
    <a href="#/evals" class="back-link">← Back to Evals</a>
    <div class="page-header">
      <h2>${ev.name} <span class="badge cat-${ev.category}">${ev.category}</span></h2>
      <p>${ev.description}</p>
    </div>

    <div class="two-col">
      <div>
        ${hs ? `
        <div class="high-score-card">
          ${isUnbounded
            ? `<div class="hs-score">${formatDollars(hs.score)}</div>`
            : `<div class="hs-score">${hs.score}<span class="hs-max">/${hs.maxScore}</span></div>
               <div style="margin:8px 0">
                 <div class="score-bar"><div class="score-bar-fill ${scoreClass(hsPct)}" style="width:${hsPct * 100}%"></div></div>
               </div>`
          }
          <div class="hs-agent">${hs.agentName}</div>
          <div class="hs-variant">${hs.memoryVariant} · ${timeAgo(hs.achievedAt)}</div>
        </div>
        ` : `<div class="panel"><h3>No high score yet</h3></div>`}
      </div>

      <div class="panel">
        <h3>Run Configuration</h3>
        <div class="config-row"><label>Tasks in eval</label><span class="config-value">${ev.taskCount}</span></div>
        <div class="clock-speed-control" style="margin-top:8px">
          <label>Clock Speed:</label>
          <select>
            <option value="fast">Fast (as fast as agent responds)</option>
            <option value="real-world">Real-world (human-paced delays)</option>
            <option value="custom">Custom interval</option>
          </select>
          <input type="number" placeholder="ms between messages" style="width:140px;display:none" />
        </div>
        <p style="font-size:11px;color:#7d8590;margin-top:8px"><strong>Fast:</strong> Messages sent immediately after agent response. <strong>Real-world:</strong> 30-120s random delays between messages. <strong>Custom:</strong> Fixed interval in milliseconds.</p>
      </div>
    </div>

    ${renderScoreBreakdown(ev, latestCompleted)}
    ${renderRunMetrics(latestCompleted)}

    <div class="panel" style="margin-top:16px">
      <h3>Recent Runs</h3>
      <table class="data-table">
        <thead><tr>
          <th>Status</th><th>Agent</th><th>Variant</th><th>Score</th><th>Clock</th><th>Cost</th><th>Started</th>
        </tr></thead>
        <tbody>
          ${ev.recentRuns.map(r => {
            const isUnbounded = r.maxScore === -1 || ev.maxScore === -1;
            const scoreDisplay = r.score !== undefined
              ? isUnbounded
                ? formatDollars(r.score)
                : `${r.score}/${r.maxScore} (${r.maxScore ? ((r.score / r.maxScore) * 100).toFixed(0) : 0}%)`
              : "—";
            return `<tr onclick="location.hash='#/agent/${r.agentId}'">
              <td><span class="status-dot ${r.status === "completed" ? "online" : r.status === "running" ? "online" : r.status === "failed" ? "error" : "offline"}" style="display:inline-block;vertical-align:middle"></span> ${r.status}</td>
              <td>${r.agentName}</td>
              <td><span class="variant-label">${r.memoryVariant}</span></td>
              <td>${scoreDisplay}</td>
              <td><span class="badge speed-${r.clockSpeed}">${r.clockSpeed}</span></td>
              <td>${r.costUsd !== undefined ? "$" + r.costUsd.toFixed(2) : "—"}</td>
              <td>${timeAgo(r.startedAt)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  // Wire up clock speed select
  const sel = content.querySelector(".clock-speed-control select");
  const customInput = content.querySelector(".clock-speed-control input");
  sel.addEventListener("change", () => {
    customInput.style.display = sel.value === "custom" ? "block" : "none";
  });
}

// ---------------------------------------------------------------------------
// VIEW: Matrix (Variants x Evals)
// ---------------------------------------------------------------------------

async function renderMatrix() {
  const content = $("#content");
  content.innerHTML = `<div class="page-header"><h2>Eval Matrix</h2><p>Loading...</p></div>`;

  const [variants, evals] = await Promise.all([api("/variants"), api("/evals")]);

  if (!variants.length && !evals.length) {
    content.innerHTML = `
      <div class="page-header"><h2>Eval Matrix</h2><p>No data yet. Run some evals to populate the matrix.</p></div>`;
    return;
  }

  // Build a lookup: evalId -> eval data
  const evalMap = {};
  evals.forEach(e => { evalMap[e.id] = e; });

  // Collect all eval IDs we know about
  const evalIds = evals.map(e => e.id);

  // For each variant x eval, find the best score and any running state
  function getCellData(variant, evalId) {
    const ev = evalMap[evalId];
    if (!ev) return { status: "none" };

    // Check for running runs matching this variant
    const runningRun = ev.recentRuns.find(r => r.status === "running" && r.memoryVariant === variant.id);
    if (runningRun) {
      return { status: "running", run: runningRun };
    }

    // Check evalPerformance on the variant (percentage-based, 0-1)
    const perfScore = variant.evalPerformance[evalId];
    if (perfScore !== undefined) {
      return { status: "completed", score: perfScore, isPercentage: true };
    }

    // Check recent runs for completed runs matching this variant
    const completedRun = ev.recentRuns
      .filter(r => r.status === "completed" && r.memoryVariant === variant.id)
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (completedRun) {
      const isUnbounded = ev.maxScore === -1 || (completedRun.maxScore && completedRun.maxScore === -1);
      if (isUnbounded) {
        return { status: "completed", rawScore: completedRun.score, isPercentage: false };
      }
      const pct = completedRun.maxScore ? completedRun.score / completedRun.maxScore : 0;
      return { status: "completed", score: pct, isPercentage: true };
    }

    // Check for failed runs
    const failedRun = ev.recentRuns.find(r => r.status === "failed" && r.memoryVariant === variant.id);
    if (failedRun) return { status: "failed" };

    return { status: "none" };
  }

  function renderCell(variant, evalId) {
    const data = getCellData(variant, evalId);
    const ev = evalMap[evalId];
    const href = `#/eval/${evalId}`;

    if (data.status === "running") {
      const prog = data.run.progress;
      const label = prog
        ? `Day ${prog.current}/${prog.total}`
        : "Running...";
      return `<a href="${href}" class="matrix-cell cell-running">${label}</a>`;
    }

    if (data.status === "completed") {
      if (!data.isPercentage) {
        // Simulation score — raw dollar value
        const formatted = typeof data.rawScore === "number"
          ? "$" + data.rawScore.toLocaleString("en-US", { maximumFractionDigits: 0 })
          : "$0";
        return `<a href="${href}" class="matrix-cell cell-green">${formatted}</a>`;
      }
      const pct = Math.round((data.score || 0) * 100);
      const cls = pct >= 70 ? "cell-green" : pct >= 35 ? "cell-yellow" : "cell-red";
      return `<a href="${href}" class="matrix-cell ${cls}">${pct}%</a>`;
    }

    if (data.status === "failed") {
      return `<a href="${href}" class="matrix-cell cell-red">FAIL</a>`;
    }

    return `<span class="matrix-cell cell-gray">—</span>`;
  }

  content.innerHTML = `
    <div class="page-header">
      <h2>Eval Matrix</h2>
      <p>${variants.length} variants × ${evals.length} evals</p>
    </div>
    <div class="panel" style="overflow-x:auto">
      <table class="matrix-table">
        <thead>
          <tr>
            <th></th>
            ${evalIds.map(eid => {
              const ev = evalMap[eid];
              return `<th class="matrix-col-header"><span class="badge cat-${ev.category}" style="font-size:10px;margin-right:4px">${ev.category.slice(0, 3)}</span> ${ev.name}</th>`;
            }).join("")}
          </tr>
        </thead>
        <tbody>
          ${variants.map(v => `
            <tr>
              <th class="matrix-row-header">${v.name} <span class="badge ${dimBadgeClass(v.dimensionality)}" style="font-size:10px">${v.dimensionality}</span></th>
              ${evalIds.map(eid => `<td>${renderCell(v, eid)}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;

  startPolling(async () => {
    // Re-fetch data to update running states
    const [newVariants, newEvals] = await Promise.all([api("/variants"), api("/evals")]);
    // Only update evals map for progress tracking — avoid full re-render
    newEvals.forEach(e => { evalMap[e.id] = e; });
    // Re-render cells in-place
    const tbody = content.querySelector(".matrix-table tbody");
    if (tbody) {
      const rows = tbody.querySelectorAll("tr");
      newVariants.forEach((v, vi) => {
        if (rows[vi]) {
          const cells = rows[vi].querySelectorAll("td");
          evalIds.forEach((eid, ei) => {
            if (cells[ei]) cells[ei].innerHTML = renderCell(v, eid);
          });
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// VIEW: Variants
// ---------------------------------------------------------------------------

async function renderVariants() {
  const content = $("#content");
  const [variants, evals] = await Promise.all([api("/variants"), api("/evals")]);

  const evalNames = {};
  evals.forEach(e => { evalNames[e.id] = e.name; });

  content.innerHTML = `
    <div class="page-header"><h2>Memory Architecture Variants</h2><p>${variants.length} variants under test</p></div>
    <div class="grid">
      ${variants.map(v => {
        const perfEntries = Object.entries(v.evalPerformance);
        return `
        <div class="card" style="cursor:default">
          <div class="card-header">
            <span class="agent-name">${v.name}</span>
            <span class="badge ${dimBadgeClass(v.dimensionality)}">${v.dimensionality}</span>
          </div>
          <p style="font-size:12px;color:#7d8590;margin-bottom:10px;line-height:1.4">${v.description.slice(0, 150)}${v.description.length > 150 ? "..." : ""}</p>
          <div class="stats-row">
            <div class="stat-item"><span class="label">write</span> <span class="value" style="font-size:11px">${v.writePolicy.slice(0, 30)}</span></div>
            <div class="stat-item"><span class="label">storage</span> <span class="value" style="font-size:11px">${v.storageType.slice(0, 30)}</span></div>
            <div class="stat-item"><span class="label">retrieval</span> <span class="value" style="font-size:11px">${v.retrievalMethod.slice(0, 30)}</span></div>
            <div class="stat-item"><span class="label">agents</span> <span class="value">${v.agents.length}</span></div>
          </div>
          ${perfEntries.length > 0 ? `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid #30363d">
              <h4 style="font-size:11px;color:#7d8590;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Eval Performance</h4>
              ${perfEntries.map(([eid, score]) => `
                <div class="perf-bar-row">
                  <span class="perf-bar-label">${evalNames[eid] || eid}</span>
                  <div class="perf-bar-track"><div class="perf-bar-value" style="width:${score * 100}%;background:${score >= 0.6 ? "#3fb950" : score >= 0.35 ? "#d29922" : "#f85149"}"></div></div>
                  <span class="perf-bar-num">${(score * 100).toFixed(0)}%</span>
                </div>
              `).join("")}
            </div>
          ` : `<p style="font-size:12px;color:#484f58;margin-top:12px">No eval data yet</p>`}
        </div>`;
      }).join("")}
    </div>`;
}
