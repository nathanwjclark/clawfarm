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

  // For simulation evals, group into "Total Assets Components" and "Performance"
  const isSimulation = ev.category === "simulation";
  let html = `<div class="panel" style="margin-top:16px"><h3>Score Breakdown</h3>`;

  if (isSimulation) {
    const netWorthKeys = ["bankBalance", "machineCash", "storageInventoryValue", "machineInventoryValue", "pendingDeliveryValue", "pendingCreditValue"];
    const perfKeys = ["totalRevenue", "totalSupplierSpend", "totalItemsSold", "grossMargin", "daysCompleted"];
    const nwEntries = entries.filter(([k]) => netWorthKeys.includes(k));
    const perfEntries = entries.filter(([k]) => perfKeys.includes(k));
    const otherEntries = entries.filter(([k]) => !netWorthKeys.includes(k) && !perfKeys.includes(k));

    if (nwEntries.length > 0) {
      html += `<h4 style="font-size:11px;color:#7d8590;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;margin-top:12px">Total Assets Components</h4>`;
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
    el.classList.toggle("active", tab === page || (page === "" && tab === "dashboard") || (page === "matrix" && tab === "dashboard"));
  });

  stopPolling();
  disconnectEvalLogStream();

  if (page === "" || page === "dashboard" || page === "matrix") renderMatrix();
  else if (page === "agent" && id) renderAgentDetail(id);
  else if (page === "cost") renderCost();
  else if (page === "evals") renderEvals();
  else if (page === "eval" && id) renderEvalDetail(id);
  else if (page === "runs") renderRuns();
  else if (page === "variants") renderVariants();
  else renderMatrix();
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
// Eval log streaming (SSE)
// ---------------------------------------------------------------------------

let evalLogEventSource = null;

function connectEvalLogStream(agentId) {
  // Clean up any previous connection
  if (evalLogEventSource) {
    evalLogEventSource.close();
    evalLogEventSource = null;
  }

  const output = $("#eval-log-output");
  const status = $("#eval-log-status");
  const panel = $("#eval-log-panel");
  if (!output || !status) return;

  output.textContent = "";
  status.textContent = "connecting...";

  evalLogEventSource = new EventSource(`/api/agents/${agentId}/eval/logs`);

  evalLogEventSource.onopen = () => {
    status.textContent = "streaming";
    status.style.color = "#3fb950";
  };

  evalLogEventSource.onmessage = (event) => {
    try {
      const line = JSON.parse(event.data);
      output.textContent += line + "\n";
      // Auto-scroll to bottom
      output.scrollTop = output.scrollHeight;
    } catch {
      output.textContent += event.data + "\n";
      output.scrollTop = output.scrollHeight;
    }
  };

  evalLogEventSource.onerror = () => {
    status.textContent = "disconnected";
    status.style.color = "#7d8590";
    // Don't reconnect — EventSource will retry automatically
  };
}

function disconnectEvalLogStream() {
  if (evalLogEventSource) {
    evalLogEventSource.close();
    evalLogEventSource = null;
  }
}

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
    const [agent, graph, messages, evalRuns] = await Promise.all([
      api(`/agents/${id}`), api(`/agents/${id}/memory-graph`), api(`/agents/${id}/messages`), api(`/eval-runs`)
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
              <div class="memory-graph-container" id="mem-graph"></div>
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

            <div class="panel" id="profiling-panel">
              <h3>Performance Profiling</h3>
              <div id="profiling-content"><p style="font-size:13px;color:#7d8590">No profiling data yet</p></div>
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

            <div class="panel" id="eval-log-panel">
              <h3>Eval Log <span id="eval-log-status" style="font-size:11px;color:#7d8590;font-weight:400"></span></h3>
              <pre class="eval-log-output" id="eval-log-output"></pre>
            </div>
          </div>
        </div>`;

      lastMsgCount = messages.length;
      lastGraphNodeCount = graph.nodes.length;
      setTimeout(() => drawMemoryGraph("mem-graph", graph), 50);
      connectEvalLogStream(id);

      // Initial profiling panel render
      if (evalRuns) {
        const profilingEl = $("#profiling-content");
        if (profilingEl) {
          const agentRuns = (evalRuns || []).filter(r => r.agentId === id).sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
          profilingEl.innerHTML = renderProfilingPanel(agentRuns);
        }
      }

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

    // Update profiling panel
    const profilingEl = $("#profiling-content");
    if (profilingEl && evalRuns) {
      const agentRuns = (evalRuns || []).filter(r => r.agentId === id).sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
      profilingEl.innerHTML = renderProfilingPanel(agentRuns);
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

function formatMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function renderProfilingPanel(agentRuns) {
  if (!agentRuns || agentRuns.length === 0) {
    return '<p style="font-size:13px;color:#7d8590">No eval runs yet</p>';
  }

  // Find runs with profiling data (completed runs)
  const profiledRuns = agentRuns.filter(r => r.profilingSummary);

  // Also check for currently running runs with live profile data from progress history
  const runningRuns = agentRuns.filter(r => r.status === "running");

  let html = "";

  // Show latest profiled run's summary
  if (profiledRuns.length > 0) {
    const latest = profiledRuns[0];
    const p = latest.profilingSummary;
    const avg = p.avg;
    const first = p.firstDay;

    html += `<div style="margin-bottom:12px">
      <div style="font-size:12px;color:#7d8590;margin-bottom:6px">Latest: ${latest.evalId} (${latest.id})</div>
      <div style="font-size:13px;margin-bottom:8px">
        <strong>Average per day</strong> &mdash; wall: ${formatMs(avg.wallMs)}
      </div>`;

    // Stacked bar showing time breakdown
    const totalAvg = avg.wallMs || 1;
    const bootPct = (avg.bootstrapMs / totalAvg * 100).toFixed(1);
    const llmPct = (avg.llmApiMs / totalAvg * 100).toFixed(1);
    const toolPct = (avg.toolExecMs / totalAvg * 100).toFixed(1);
    const overheadMs = Math.max(0, avg.wallMs - avg.bootstrapMs - avg.llmApiMs - avg.toolExecMs);
    const overPct = (overheadMs / totalAvg * 100).toFixed(1);

    html += `<div class="profile-breakdown">
      <div class="profile-bar" style="display:flex;height:20px;border-radius:4px;overflow:hidden;margin-bottom:4px">
        <div title="Bootstrap: ${formatMs(avg.bootstrapMs)} (${bootPct}%)" style="width:${bootPct}%;background:#f0883e;min-width:${avg.bootstrapMs > 0 ? '2px' : '0'}"></div>
        <div title="LLM API: ${formatMs(avg.llmApiMs)} (${llmPct}%)" style="width:${llmPct}%;background:#58a6ff;min-width:${avg.llmApiMs > 0 ? '2px' : '0'}"></div>
        <div title="Tool Exec: ${formatMs(avg.toolExecMs)} (${toolPct}%)" style="width:${toolPct}%;background:#3fb950;min-width:${avg.toolExecMs > 0 ? '2px' : '0'}"></div>
        <div title="Overhead: ${formatMs(overheadMs)} (${overPct}%)" style="width:${overPct}%;background:#484f58;min-width:${overheadMs > 0 ? '2px' : '0'}"></div>
      </div>
      <div style="display:flex;gap:12px;font-size:11px;color:#8b949e;flex-wrap:wrap">
        <span><span style="display:inline-block;width:8px;height:8px;background:#f0883e;border-radius:2px;margin-right:3px"></span>Boot ${formatMs(avg.bootstrapMs)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:#58a6ff;border-radius:2px;margin-right:3px"></span>LLM ${formatMs(avg.llmApiMs)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:#3fb950;border-radius:2px;margin-right:3px"></span>Tools ${formatMs(avg.toolExecMs)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:#484f58;border-radius:2px;margin-right:3px"></span>Other ${formatMs(overheadMs)}</span>
      </div>
    </div>`;

    // Day-by-day table
    if (p.days && p.days.length > 0) {
      html += `<div style="margin-top:10px">
        <table class="profile-table" style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="color:#7d8590;text-align:right">
            <th style="text-align:left;padding:3px 6px">Day</th>
            <th style="padding:3px 6px">Wall</th>
            <th style="padding:3px 6px">Boot</th>
            <th style="padding:3px 6px">LLM</th>
            <th style="padding:3px 6px">Tools</th>
          </tr></thead>
          <tbody>`;
      for (const d of p.days) {
        const isFirst = d === p.days[0];
        const rowStyle = isFirst ? 'color:#e6edf3;background:#1c2128' : 'color:#c9d1d9';
        html += `<tr style="${rowStyle}">
          <td style="text-align:left;padding:3px 6px">Day ${d.day}${isFirst ? ' <span style="color:#f0883e;font-size:10px">(cold)</span>' : ''}</td>
          <td style="text-align:right;padding:3px 6px">${formatMs(d.wallMs)}</td>
          <td style="text-align:right;padding:3px 6px">${formatMs(d.bootstrapMs)}</td>
          <td style="text-align:right;padding:3px 6px">${formatMs(d.llmApiMs)}</td>
          <td style="text-align:right;padding:3px 6px">${formatMs(d.toolExecMs)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Cold start vs warm comparison
    if (first && p.days.length > 1) {
      const warmAvg = {
        wallMs: Math.round((avg.wallMs * p.days.length - first.wallMs) / (p.days.length - 1)),
        bootstrapMs: Math.round((avg.bootstrapMs * p.days.length - first.bootstrapMs) / (p.days.length - 1)),
        llmApiMs: Math.round((avg.llmApiMs * p.days.length - first.llmApiMs) / (p.days.length - 1)),
      };
      html += `<div style="margin-top:8px;font-size:12px;color:#8b949e">
        Cold start: ${formatMs(first.wallMs)} (boot: ${formatMs(first.bootstrapMs)})
        &nbsp;|&nbsp; Warm avg: ${formatMs(warmAvg.wallMs)} (boot: ${formatMs(warmAvg.bootstrapMs)})
      </div>`;
    }

    html += `</div>`;
  }

  // If a run is currently running, show live indicator
  if (runningRuns.length > 0) {
    html += `<div style="font-size:12px;color:#58a6ff;margin-top:8px">
      <span style="display:inline-block;width:6px;height:6px;background:#58a6ff;border-radius:50%;margin-right:4px;animation:pulse 2s infinite"></span>
      Eval running &mdash; profiling data will appear on completion
    </div>`;
  }

  if (!html) {
    html = '<p style="font-size:13px;color:#7d8590">No profiling data available. Run an eval to collect timing data.</p>';
  }

  return html;
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
// Force-directed graph using SVG
// ---------------------------------------------------------------------------

function drawMemoryGraph(containerId, graph) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const W = container.clientWidth;
  const H = container.clientHeight;

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
  function simulate() {
    const nodes = graph.nodes;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = positions[nodes[i].id], b = positions[nodes[j].id];
        let dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 800 / (dist * dist);
        a.vx -= (dx / dist) * force; a.vy -= (dy / dist) * force;
        b.vx += (dx / dist) * force; b.vy += (dy / dist) * force;
      }
    }
    graph.edges.forEach(e => {
      const a = positions[e.source], b = positions[e.target];
      if (!a || !b) return;
      let dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = (dist - 80) * 0.03 * e.weight;
      a.vx += (dx / dist) * force; a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force; b.vy -= (dy / dist) * force;
    });
    nodes.forEach(n => {
      const p = positions[n.id];
      p.vx += (W / 2 - p.x) * 0.005;
      p.vy += (H / 2 - p.y) * 0.005;
      p.vx *= 0.85; p.vy *= 0.85;
      p.x += p.vx; p.y += p.vy;
      p.x = Math.max(30, Math.min(W - 30, p.x));
      p.y = Math.max(30, Math.min(H - 30, p.y));
    });
  }

  // Create SVG
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.style.width = "100%";
  svg.style.height = "100%";
  container.innerHTML = "";
  container.appendChild(svg);

  // Create SVG elements for edges
  const edgeEls = graph.edges.map(e => {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
    return { el: line, edge: e };
  });

  // Create SVG elements for nodes
  const nodeEls = graph.nodes.map(n => {
    const g = document.createElementNS(ns, "g");
    const r = Math.max(6, Math.min(n.size * 0.6, 30));
    const color = typeColors[n.type] || "#7d8590";
    const glow = document.createElementNS(ns, "circle");
    glow.setAttribute("r", r + 4);
    glow.setAttribute("fill", color + "33");
    g.appendChild(glow);
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", r);
    circle.setAttribute("fill", color);
    g.appendChild(circle);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dy", r + 14);
    label.setAttribute("fill", "#c9d1d9");
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "monospace");
    label.textContent = n.label;
    g.appendChild(label);
    const count = document.createElementNS(ns, "text");
    count.setAttribute("text-anchor", "middle");
    count.setAttribute("dy", r + 24);
    count.setAttribute("fill", "#7d8590");
    count.setAttribute("font-size", "9");
    count.setAttribute("font-family", "monospace");
    count.textContent = `${n.itemCount} items`;
    g.appendChild(count);
    svg.appendChild(g);
    return { el: g, node: n, r };
  });

  function render() {
    edgeEls.forEach(({ el, edge }) => {
      const a = positions[edge.source], b = positions[edge.target];
      if (!a || !b) return;
      el.setAttribute("x1", a.x); el.setAttribute("y1", a.y);
      el.setAttribute("x2", b.x); el.setAttribute("y2", b.y);
      el.setAttribute("stroke", `rgba(88,166,255,${(0.15 + edge.weight * 0.3).toFixed(2)})`);
    });
    nodeEls.forEach(({ el, node }) => {
      const p = positions[node.id];
      el.setAttribute("transform", `translate(${p.x},${p.y})`);
    });
  }

  let frames = 0;
  function tick() {
    simulate();
    render();
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
      <div class="chart-container" id="cost-chart"></div>
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

function drawCostChart(containerId, history) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const W = container.clientWidth;
  const H = container.clientHeight;
  const pad = { top: 20, right: 20, bottom: 40, left: 60 };
  const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;

  if (history.length < 2) { container.innerHTML = ""; return; }

  const maxVal = Math.max(...history.map(h => h.totalUsd)) * 1.1 || 1;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.width = "100%";
  svg.style.height = "100%";

  // Grid lines + Y labels
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (cH / 4) * i;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", pad.left); line.setAttribute("y1", y);
    line.setAttribute("x2", W - pad.right); line.setAttribute("y2", y);
    line.setAttribute("stroke", "#21262d"); line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", pad.left - 8); text.setAttribute("y", y + 4);
    text.setAttribute("text-anchor", "end");
    text.setAttribute("fill", "#7d8590"); text.setAttribute("font-size", "10"); text.setAttribute("font-family", "monospace");
    text.textContent = "$" + ((maxVal * (4 - i)) / 4).toFixed(1);
    svg.appendChild(text);
  }

  // X labels
  const step = Math.max(1, Math.floor(history.length / 6));
  history.forEach((h, i) => {
    if (i % step !== 0 && i !== history.length - 1) return;
    const x = pad.left + (i / (history.length - 1)) * cW;
    const t = new Date(h.timestamp);
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", x); text.setAttribute("y", H - pad.bottom + 20);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#7d8590"); text.setAttribute("font-size", "10"); text.setAttribute("font-family", "monospace");
    text.textContent = `${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}`;
    svg.appendChild(text);
  });

  // Build points
  const pts = history.map((h, i) => ({
    x: pad.left + (i / (history.length - 1)) * cW,
    y: pad.top + cH - (h.totalUsd / maxVal) * cH,
  }));

  // Fill area
  const areaPath = document.createElementNS(ns, "polygon");
  const areaPoints = pts.map(p => `${p.x},${p.y}`).join(" ") +
    ` ${pts[pts.length - 1].x},${pad.top + cH} ${pts[0].x},${pad.top + cH}`;
  areaPath.setAttribute("points", areaPoints);
  areaPath.setAttribute("fill", "rgba(88,166,255,0.08)");
  svg.appendChild(areaPath);

  // Line
  const polyline = document.createElementNS(ns, "polyline");
  polyline.setAttribute("points", pts.map(p => `${p.x},${p.y}`).join(" "));
  polyline.setAttribute("fill", "none"); polyline.setAttribute("stroke", "#58a6ff"); polyline.setAttribute("stroke-width", "2");
  svg.appendChild(polyline);

  // Dots
  pts.forEach(p => {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", p.x); circle.setAttribute("cy", p.y); circle.setAttribute("r", "3");
    circle.setAttribute("fill", "#58a6ff");
    svg.appendChild(circle);
  });

  container.innerHTML = "";
  container.appendChild(svg);
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

let matrixRunMode = false;

async function renderMatrix() {
  const content = $("#content");
  content.innerHTML = `<div class="page-header"><h2>Dashboard</h2><p>Loading...</p></div>`;

  const [variants, evals, agents, agentConfigs] = await Promise.all([
    api("/variants"), api("/evals"), api("/agents"),
    api("/agent-configs").catch(() => []),
  ]);

  if (!variants.length && !evals.length) {
    content.innerHTML = `
      <div class="page-header"><h2>Dashboard</h2><p>No data yet. Run some evals to populate the matrix.</p></div>`;
    return;
  }

  // Build a lookup: evalId -> eval data
  const evalMap = {};
  evals.forEach(e => { evalMap[e.id] = e; });

  // Map variant ID -> live agent IDs
  const variantAgentMap = {};
  (agents || []).forEach(a => {
    if (a.status === "online" && a.memoryVariant) {
      if (!variantAgentMap[a.memoryVariant]) variantAgentMap[a.memoryVariant] = [];
      variantAgentMap[a.memoryVariant].push(a.id);
    }
  });

  // Map variant ID -> config info (for spawning offline agents)
  const variantConfigMap = {};
  (agentConfigs || []).forEach(c => {
    variantConfigMap[c.variantId] = c;
  });

  // Collect all eval IDs we know about
  const evalIds = evals.map(e => e.id);

  // For each variant x eval, find the best score and any running state
  function getCellData(variant, evalId) {
    const ev = evalMap[evalId];
    if (!ev) return { status: "none" };

    const runningRun = ev.recentRuns.find(r => r.status === "running" && r.memoryVariant === variant.id);
    if (runningRun) {
      return { status: "running", run: runningRun };
    }

    const perfScore = variant.evalPerformance[evalId];
    if (perfScore !== undefined) {
      return { status: "completed", score: perfScore, isPercentage: true };
    }

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

  // Count how many variants have live agents
  const liveVariantCount = variants.filter(v => variantAgentMap[v.id]?.length).length;

  content.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between">
      <div>
        <h2>Dashboard</h2>
        <p>${variants.length} variants × ${evals.length} evals${liveVariantCount ? ` · ${liveVariantCount} live` : ""}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button id="matrix-stop-all" class="matrix-run-toggle" style="border-color:#f8514955;color:#f85149" title="Stop all running agents">Stop All</button>
        <button id="matrix-run-toggle" class="matrix-run-toggle${matrixRunMode ? " active" : ""}">${matrixRunMode ? "Exit Run Mode" : "Run Mode"}</button>
      </div>
    </div>

    <div id="matrix-run-controls" class="matrix-run-controls" style="display:${matrixRunMode ? "block" : "none"}">
      <div class="run-controls-row">
        <div class="run-control-group">
          <label>Length</label>
          <div class="run-length-control">
            <input type="text" id="run-length-pct" value="5" style="width:50px" />
            <span id="run-length-label">% (18 days)</span>
          </div>
        </div>
        <div class="run-control-group">
          <label>Seed</label>
          <input type="text" id="run-seed" placeholder="random" style="width:100px" />
        </div>
        <div class="run-control-group">
          <label>Clock</label>
          <select id="run-clock-speed">
            <option value="fast">Fast</option>
            <option value="real-world">Real-world</option>
          </select>
        </div>
        <div class="run-control-group" style="margin-left:auto">
          <button id="matrix-run-btn" class="matrix-run-btn" disabled>Run Selected (0)</button>
        </div>
      </div>
      <div id="matrix-run-status" class="matrix-run-status"></div>
    </div>

    <div class="panel matrix-scroll-wrapper">
      <table class="matrix-table">
        <thead>
          <tr>
            <th>${matrixRunMode ? '<input type="checkbox" id="matrix-select-all-variants" title="Select all variants" />' : ""}</th>
            ${evalIds.map(eid => {
              const ev = evalMap[eid];
              const chk = matrixRunMode
                ? `<input type="checkbox" class="matrix-eval-chk" data-eval-id="${eid}" title="Select ${ev.name}" />`
                : "";
              return `<th class="matrix-col-header">${chk}<span class="badge cat-${ev.category}" style="font-size:10px;margin-right:4px">${ev.category.slice(0, 3)}</span> ${ev.name}</th>`;
            }).join("")}
          </tr>
        </thead>
        <tbody>
          ${variants.map(v => {
            const hasLive = !!variantAgentMap[v.id]?.length;
            const hasConfig = !!variantConfigMap[v.id];
            const canRun = hasLive || hasConfig;
            const chk = matrixRunMode
              ? `<input type="checkbox" class="matrix-variant-chk" data-variant-id="${v.id}" ${canRun ? "" : "disabled title=\"No config available\""} />`
              : "";
            const dimmed = matrixRunMode && !canRun ? ' style="opacity:0.4"' : "";
            const statusLabel = matrixRunMode && !hasLive && hasConfig
              ? ' <span style="font-size:10px;color:#d29922">(will start)</span>'
              : matrixRunMode && !canRun
                ? ' <span style="font-size:10px;color:#484f58">(no config)</span>'
                : "";
            return `<tr${dimmed}>
              <th class="matrix-row-header">${chk} ${v.name} <span class="badge ${dimBadgeClass(v.dimensionality)}" style="font-size:10px">${v.dimensionality}</span>${statusLabel}</th>
              ${evalIds.map(eid => `<td>${renderCell(v, eid)}</td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <div id="matrix-charts" class="matrix-charts">
      <div class="matrix-chart-panel">
        <h3>Total Assets by Day</h3>
        <div class="chart-container" id="chart-net-worth"></div>
      </div>
      <div class="matrix-chart-panel">
        <h3>Estimated Cost (USD)</h3>
        <div class="chart-container" id="chart-cost-matrix"></div>
      </div>
      <div class="matrix-chart-panel">
        <h3>Elapsed Time</h3>
        <div class="chart-container" id="chart-time"></div>
      </div>
    </div>`;

  // --- Run mode wiring ---
  const toggleBtn = $("#matrix-run-toggle");
  const controlsPanel = $("#matrix-run-controls");

  toggleBtn.addEventListener("click", () => {
    matrixRunMode = !matrixRunMode;
    renderMatrix(); // re-render with checkboxes
  });

  // Stop All button
  const stopAllBtn = $("#matrix-stop-all");
  if (stopAllBtn) {
    stopAllBtn.addEventListener("click", async () => {
      stopAllBtn.disabled = true;
      stopAllBtn.textContent = "Stopping...";
      try {
        await fetch("/api/stop-all", { method: "POST" });
        stopAllBtn.textContent = "Stopped";
      } catch {
        stopAllBtn.textContent = "Failed";
      }
      setTimeout(() => {
        stopAllBtn.disabled = false;
        stopAllBtn.textContent = "Stop All";
      }, 3000);
    });
  }

  if (matrixRunMode) {
    wireMatrixRunControls(variants, evalIds, evalMap, variantAgentMap, variantConfigMap);
  }

  // Initial chart draw
  fetchAndDrawMatrixCharts();

  startPolling(async () => {
    const [newVariants, newEvals] = await Promise.all([api("/variants"), api("/evals")]);
    // Update eval data
    newEvals.forEach(e => { evalMap[e.id] = e; });
    // Update variant data — replace the captured variants array contents
    variants.length = 0;
    variants.push(...newVariants);

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

    // Update charts
    fetchAndDrawMatrixCharts();
  });
}

function wireMatrixRunControls(variants, evalIds, evalMap, variantAgentMap, variantConfigMap) {
  const lengthSlider = $("#run-length-pct");
  const lengthLabel = $("#run-length-label");
  const runBtn = $("#matrix-run-btn");
  const statusEl = $("#matrix-run-status");
  const selectAllVariants = $("#matrix-select-all-variants");

  function updateLengthLabel() {
    const pct = Math.max(1, Math.min(100, parseInt(lengthSlider.value) || 5));
    const days = Math.max(1, Math.round(365 * pct / 100));
    lengthLabel.textContent = `% (${days} day${days !== 1 ? "s" : ""})`;
  }

  function getSelectedPairs() {
    const selectedVariants = new Set();
    document.querySelectorAll(".matrix-variant-chk:checked").forEach(cb => {
      selectedVariants.add(cb.dataset.variantId);
    });
    const selectedEvals = new Set();
    document.querySelectorAll(".matrix-eval-chk:checked").forEach(cb => {
      selectedEvals.add(cb.dataset.evalId);
    });
    const pairs = [];
    for (const vid of selectedVariants) {
      const agentIds = variantAgentMap[vid];
      const agentId = agentIds?.[0] || variantConfigMap[vid]?.agentId;
      if (!agentId) continue;
      const needsSpawn = !agentIds?.length;
      for (const eid of selectedEvals) {
        pairs.push({ variantId: vid, evalId: eid, agentId, needsSpawn });
      }
    }
    return pairs;
  }

  function updateRunBtn() {
    const pairs = getSelectedPairs();
    runBtn.textContent = `Run Selected (${pairs.length})`;
    runBtn.disabled = pairs.length === 0;
  }

  lengthSlider.addEventListener("input", updateLengthLabel);
  lengthSlider.addEventListener("blur", () => {
    const clamped = Math.max(1, Math.min(100, parseInt(lengthSlider.value) || 5));
    lengthSlider.value = clamped;
    updateLengthLabel();
  });
  updateLengthLabel();

  // Checkbox change listeners
  document.querySelectorAll(".matrix-variant-chk, .matrix-eval-chk").forEach(cb => {
    cb.addEventListener("change", updateRunBtn);
  });

  // Select-all variants
  if (selectAllVariants) {
    selectAllVariants.addEventListener("change", () => {
      const checked = selectAllVariants.checked;
      document.querySelectorAll(".matrix-variant-chk:not(:disabled)").forEach(cb => {
        cb.checked = checked;
      });
      updateRunBtn();
    });
  }

  // Run button
  runBtn.addEventListener("click", async () => {
    const pairs = getSelectedPairs();
    if (!pairs.length) return;

    const pct = parseInt(lengthSlider.value);
    const days = Math.max(1, Math.round(365 * pct / 100));
    const seedStr = ($("#run-seed").value || "").trim();
    const seed = seedStr ? parseInt(seedStr, 10) : undefined;
    const clockSpeed = $("#run-clock-speed").value;

    runBtn.disabled = true;
    statusEl.innerHTML = "";

    // Collect unique variants that need spawning
    const variantsToSpawn = [...new Set(pairs.filter(p => p.needsSpawn).map(p => p.variantId))];

    if (variantsToSpawn.length > 0) {
      runBtn.textContent = `Starting ${variantsToSpawn.length} agent${variantsToSpawn.length > 1 ? "s" : ""}...`;
      for (const vid of variantsToSpawn) {
        try {
          const res = await fetch("/api/agents/spawn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ variantId: vid }),
          });
          const data = await res.json();
          if (res.ok) {
            const label = data.alreadyRunning ? "already running" : "started";
            statusEl.innerHTML += `<div class="run-status-line run-ok">Agent ${data.agentId} ${label} (port ${data.port})</div>`;
          } else {
            statusEl.innerHTML += `<div class="run-status-line run-err">Failed to start agent for ${vid}: ${data.error}</div>`;
          }
        } catch (err) {
          statusEl.innerHTML += `<div class="run-status-line run-err">Failed to start agent for ${vid}: ${err.message}</div>`;
        }
      }
      // Poll until all spawned agents are registered (up to 30s)
      const neededAgentIds = new Set(
        pairs.filter(p => p.needsSpawn).map(p => p.agentId)
      );
      statusEl.innerHTML += `<div class="run-status-line" style="color:#7d8590" id="spawn-wait-status">Waiting for ${neededAgentIds.size} agent(s) to register...</div>`;
      const waitStart = Date.now();
      while (Date.now() - waitStart < 30000) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const agents = await api("/agents");
          const onlineIds = new Set((agents || []).filter(a => a.status === "online").map(a => a.id));
          const remaining = [...neededAgentIds].filter(id => !onlineIds.has(id));
          const waitEl = document.getElementById("spawn-wait-status");
          if (remaining.length === 0) {
            if (waitEl) waitEl.textContent = "All agents registered.";
            break;
          }
          const elapsed = Math.round((Date.now() - waitStart) / 1000);
          if (waitEl) waitEl.textContent = `Waiting for ${remaining.length} agent(s) to register... (${elapsed}s)`;
        } catch { break; }
      }
    }

    runBtn.textContent = `Launching ${pairs.length} eval${pairs.length > 1 ? "s" : ""}...`;

    let launched = 0;
    let failed = 0;

    for (const pair of pairs) {
      const variant = variants.find(v => v.id === pair.variantId);
      const variantName = variant ? variant.name : pair.variantId;
      const ev = evalMap[pair.evalId];
      const evalName = ev ? ev.name : pair.evalId;

      try {
        const res = await fetch(`/api/agents/${pair.agentId}/eval/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evalId: pair.evalId, clockSpeed, days, seed }),
        });
        const data = await res.json();

        if (res.ok) {
          launched++;
          statusEl.innerHTML += `<div class="run-status-line run-ok">${variantName} × ${evalName}: started (${data.runId})</div>`;
        } else {
          failed++;
          statusEl.innerHTML += `<div class="run-status-line run-err">${variantName} × ${evalName}: ${data.error || res.statusText}</div>`;
        }
      } catch (err) {
        failed++;
        statusEl.innerHTML += `<div class="run-status-line run-err">${variantName} × ${evalName}: ${err.message}</div>`;
      }
    }

    runBtn.textContent = `Done (${launched} launched${failed ? `, ${failed} failed` : ""})`;
    setTimeout(() => updateRunBtn(), 5000);
  });
}

// ---------------------------------------------------------------------------
// Matrix Charts — live line charts for active eval runs
// ---------------------------------------------------------------------------

// Distinct colors for chart series
const CHART_COLORS = [
  "#58a6ff", // blue
  "#3fb950", // green
  "#d29922", // yellow
  "#f85149", // red
  "#bc8cff", // purple
  "#f0883e", // orange
  "#56d4dd", // cyan
  "#db61a2", // pink
];

async function fetchAndDrawMatrixCharts() {
  try {
    // Use chart-history endpoint which combines live progress + persisted completed runs
    const history = await api("/eval-chart-history");
    const chartsEl = document.getElementById("matrix-charts");
    if (!chartsEl) return;

    if (!history || history.length === 0) {
      chartsEl.style.display = "none";
      return;
    }
    chartsEl.style.display = "";

    drawMultiSeriesChart("chart-net-worth", history, "score", "$");
    drawMultiSeriesChart("chart-cost-matrix", history, "costUsd", "$");
    drawMultiSeriesChart("chart-time", history, "elapsedMs", "time");
  } catch {}
}

function drawMultiSeriesChart(containerId, series, field, unit) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const W = container.clientWidth;
  const H = container.clientHeight;
  const pad = { top: 20, right: 16, bottom: 40, left: 65 };
  const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;

  const validSeries = series.filter(s =>
    s.checkpoints.some(c => c[field] !== undefined && c[field] !== null)
  );

  if (validSeries.length === 0) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#484f58;font-size:12px">No data yet</div>';
    return;
  }

  let maxDay = 0;
  let minVal = Infinity, maxVal = -Infinity;
  for (const s of validSeries) {
    for (const c of s.checkpoints) {
      if (c.day > maxDay) maxDay = c.day;
      const v = c[field];
      if (v !== undefined && v !== null) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
  }
  if (maxDay === 0) maxDay = 1;
  if (minVal === maxVal) { maxVal = minVal + 1; }
  const yRange = maxVal - minVal;
  const yMin = 0;
  const yMax = maxVal + yRange * 0.1;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.width = "100%";
  svg.style.height = "100%";

  // Grid lines + Y labels
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (cH / gridLines) * i;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", pad.left); line.setAttribute("y1", y);
    line.setAttribute("x2", W - pad.right); line.setAttribute("y2", y);
    line.setAttribute("stroke", "#21262d"); line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", pad.left - 8); text.setAttribute("y", y + 4);
    text.setAttribute("text-anchor", "end");
    text.setAttribute("fill", "#7d8590"); text.setAttribute("font-size", "10"); text.setAttribute("font-family", "monospace");
    const val = yMax - ((yMax - yMin) * i / gridLines);
    text.textContent = formatChartValue(val, unit);
    svg.appendChild(text);
  }

  // X axis labels
  const xStep = Math.max(1, Math.ceil(maxDay / 8));
  for (let d = xStep; d <= maxDay; d += xStep) {
    const x = pad.left + (d / maxDay) * cW;
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", x); text.setAttribute("y", H - pad.bottom + 16);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#7d8590"); text.setAttribute("font-size", "10"); text.setAttribute("font-family", "monospace");
    text.textContent = "D" + d;
    svg.appendChild(text);
  }

  // Legend row at top
  let legendX = pad.left;
  validSeries.forEach((s, si) => {
    const color = CHART_COLORS[si % CHART_COLORS.length];
    const label = s.agentName || s.memoryVariant || s.agentId;
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", legendX); rect.setAttribute("y", 6);
    rect.setAttribute("width", "10"); rect.setAttribute("height", "10");
    rect.setAttribute("fill", color);
    svg.appendChild(rect);
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", legendX + 14); text.setAttribute("y", 15);
    text.setAttribute("fill", "#c9d1d9"); text.setAttribute("font-size", "10");
    text.setAttribute("font-weight", "bold"); text.setAttribute("font-family", "system-ui, sans-serif");
    text.textContent = label;
    svg.appendChild(text);
    // Estimate text width (roughly 6px per char at 10px bold)
    legendX += 14 + label.length * 6.5 + 16;
  });

  // Draw each series
  validSeries.forEach((s, si) => {
    const color = CHART_COLORS[si % CHART_COLORS.length];
    const points = s.checkpoints
      .filter(c => c[field] !== undefined && c[field] !== null)
      .map(c => ({
        px: pad.left + (c.day / maxDay) * cW,
        py: pad.top + cH - ((c[field] - yMin) / (yMax - yMin)) * cH,
      }));

    if (points.length === 0) return;

    // Line
    const polyline = document.createElementNS(ns, "polyline");
    polyline.setAttribute("points", points.map(p => `${p.px},${p.py}`).join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", color);
    polyline.setAttribute("stroke-width", "2");
    svg.appendChild(polyline);

    // Dots
    points.forEach(p => {
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", p.px); circle.setAttribute("cy", p.py);
      circle.setAttribute("r", "2.5");
      circle.setAttribute("fill", color);
      svg.appendChild(circle);
    });
  });

  container.innerHTML = "";
  container.appendChild(svg);
}

function formatChartValue(val, unit) {
  if (unit === "$") {
    if (Math.abs(val) >= 1000) return "$" + (val / 1000).toFixed(1) + "k";
    return "$" + val.toFixed(val < 10 ? 2 : 0);
  }
  if (unit === "time") {
    if (val >= 3600000) return (val / 3600000).toFixed(1) + "h";
    if (val >= 60000) return (val / 60000).toFixed(1) + "m";
    return (val / 1000).toFixed(0) + "s";
  }
  if (unit === "tokens") {
    if (val >= 1e6) return (val / 1e6).toFixed(1) + "M";
    if (val >= 1e3) return (val / 1e3).toFixed(0) + "K";
    return String(Math.round(val));
  }
  return String(Math.round(val));
}

// ---------------------------------------------------------------------------
// VIEW: Runs
// ---------------------------------------------------------------------------

let runsFilters = { evalId: "", variant: "", status: "" };

async function renderRuns() {
  const content = $("#content");
  content.innerHTML = `<div class="page-header"><h2>Eval Runs</h2><p>Loading...</p></div>`;

  const [runs, evalTypes] = await Promise.all([
    api("/eval-runs"), api("/evals"),
  ]);

  // Build lookup maps
  const evalNameMap = {};
  evalTypes.forEach(e => { evalNameMap[e.id] = e.name; });
  const uniqueEvals = [...new Set(runs.map(r => r.evalId))];
  const uniqueVariants = [...new Set(runs.map(r => r.memoryVariant))];

  function applyFilters(allRuns) {
    return allRuns.filter(r => {
      if (runsFilters.evalId && r.evalId !== runsFilters.evalId) return false;
      if (runsFilters.variant && r.memoryVariant !== runsFilters.variant) return false;
      if (runsFilters.status && r.status !== runsFilters.status) return false;
      return true;
    });
  }

  const activeRuns = runs.filter(r => r.status === "running");
  const filtered = applyFilters(runs);

  content.innerHTML = `
    <div class="page-header">
      <h2>Eval Runs</h2>
      <p>${runs.length} total · ${activeRuns.length} active</p>
    </div>

    <div class="runs-filters">
      <div class="run-control-group">
        <label>Eval</label>
        <select id="runs-filter-eval">
          <option value="">All evals</option>
          ${uniqueEvals.map(eid => `<option value="${eid}" ${runsFilters.evalId === eid ? "selected" : ""}>${evalNameMap[eid] || eid}</option>`).join("")}
        </select>
      </div>
      <div class="run-control-group">
        <label>Variant</label>
        <select id="runs-filter-variant">
          <option value="">All variants</option>
          ${uniqueVariants.map(vid => `<option value="${vid}" ${runsFilters.variant === vid ? "selected" : ""}>${vid}</option>`).join("")}
        </select>
      </div>
      <div class="run-control-group">
        <label>Status</label>
        <select id="runs-filter-status">
          <option value="">All</option>
          <option value="running" ${runsFilters.status === "running" ? "selected" : ""}>Running</option>
          <option value="completed" ${runsFilters.status === "completed" ? "selected" : ""}>Completed</option>
          <option value="failed" ${runsFilters.status === "failed" ? "selected" : ""}>Failed</option>
        </select>
      </div>
      <div class="run-control-group" style="align-self:flex-end">
        <span style="font-size:12px;color:#7d8590">${filtered.length} run${filtered.length !== 1 ? "s" : ""}</span>
      </div>
    </div>

    <div class="panel" style="margin-top:0">
      <table class="data-table runs-table">
        <thead><tr>
          <th>Status</th><th>Eval</th><th>Agent</th><th>Variant</th><th>Progress</th><th>Score</th><th>Cost</th><th>Duration</th><th>Started</th><th></th>
        </tr></thead>
        <tbody id="runs-tbody">
          ${renderRunsRows(filtered, evalNameMap)}
        </tbody>
      </table>
    </div>`;

  // Wire filters
  ["runs-filter-eval", "runs-filter-variant", "runs-filter-status"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => {
      runsFilters.evalId = document.getElementById("runs-filter-eval").value;
      runsFilters.variant = document.getElementById("runs-filter-variant").value;
      runsFilters.status = document.getElementById("runs-filter-status").value;
      renderRuns();
    });
  });

  // Poll for updates
  startPolling(async () => {
    try {
      const newRuns = await api("/eval-runs");
      const tbody = document.getElementById("runs-tbody");
      if (tbody) {
        const newFiltered = applyFilters(newRuns);
        tbody.innerHTML = renderRunsRows(newFiltered, evalNameMap);
        wireRunActions();
      }
    } catch {}
  });

  wireRunActions();
}

function renderRunsRows(runs, evalNameMap) {
  if (runs.length === 0) {
    return `<tr><td colspan="10" style="text-align:center;color:#484f58;padding:24px">No runs match the current filters</td></tr>`;
  }
  return runs.map(r => {
    const isUnbounded = r.maxScore === -1;
    const scoreDisplay = r.score !== undefined && r.status !== "running"
      ? isUnbounded
        ? formatDollars(r.score)
        : `${r.score}/${r.maxScore} (${r.maxScore ? ((r.score / r.maxScore) * 100).toFixed(0) : 0}%)`
      : r.status === "running" && r.progress?.score !== undefined
        ? formatDollars(r.progress.score)
        : "—";

    const progressDisplay = r.progress
      ? `Day ${r.progress.current}/${r.progress.total}`
      : r.status === "completed" ? "Done" : r.status === "failed" ? "—" : "—";

    const statusDot = r.status === "running" ? "online" : r.status === "completed" ? "online" : r.status === "failed" ? "error" : "offline";

    const durationDisplay = r.completedAt && r.startedAt
      ? formatDuration(new Date(r.completedAt) - new Date(r.startedAt))
      : r.status === "running" && r.startedAt
        ? formatDuration(Date.now() - new Date(r.startedAt).getTime()) + "..."
        : "—";

    const actions = r.status === "running"
      ? `<button class="runs-action-btn runs-stop-btn" data-agent-id="${r.agentId}" data-run-id="${r.id}" title="Stop this eval">Stop</button>
         <button class="runs-action-btn runs-pause-btn" disabled title="Pause (not yet implemented)">Pause</button>`
      : "";

    return `<tr class="${r.status === "running" ? "run-active-row" : ""}">
      <td><span class="status-dot ${statusDot}" style="display:inline-block;vertical-align:middle"></span> ${r.status}</td>
      <td><a href="#/eval/${r.evalId}">${evalNameMap[r.evalId] || r.evalId}</a></td>
      <td><a href="#/agent/${r.agentId}">${r.agentName}</a></td>
      <td><span class="variant-label">${r.memoryVariant}</span></td>
      <td>${progressDisplay}</td>
      <td>${scoreDisplay}</td>
      <td>${r.costUsd !== undefined ? "$" + r.costUsd.toFixed(2) : "—"}</td>
      <td>${durationDisplay}</td>
      <td>${timeAgo(r.startedAt)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
}

function wireRunActions() {
  document.querySelectorAll(".runs-stop-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const agentId = btn.dataset.agentId;
      btn.disabled = true;
      btn.textContent = "Stopping...";
      try {
        await fetch(`/api/agents/${agentId}/eval/stop`, { method: "POST" });
      } catch {}
      setTimeout(() => renderRuns(), 1000);
    });
  });
}

function formatDuration(ms) {
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return sec + "s";
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return min + "m " + remSec + "s";
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return hr + "h " + remMin + "m";
}

// ---------------------------------------------------------------------------
// VIEW: Variants
// ---------------------------------------------------------------------------

async function renderVariants() {
  const content = $("#content");
  const [variants, evals, agents] = await Promise.all([
    api("/variants"), api("/evals"), api("/agents"),
  ]);

  const evalNames = {};
  evals.forEach(e => { evalNames[e.id] = e.name; });

  // Map variant -> agents
  const variantAgents = {};
  (agents || []).forEach(a => {
    if (!a.memoryVariant) return;
    if (!variantAgents[a.memoryVariant]) variantAgents[a.memoryVariant] = [];
    variantAgents[a.memoryVariant].push(a);
  });

  const onlineCount = (agents || []).filter(a => a.status === "online").length;
  const totalCost = (agents || []).reduce((s, a) => s + (a.costEstimatedUsd || 0), 0);

  content.innerHTML = `
    <div class="page-header">
      <h2>Variants</h2>
      <p>${variants.length} variants · ${onlineCount} agent${onlineCount !== 1 ? "s" : ""} online · $${totalCost.toFixed(2)} total cost</p>
    </div>
    <div class="grid">
      ${variants.map(v => {
        const perfEntries = Object.entries(v.evalPerformance);
        const liveAgents = variantAgents[v.id] || [];
        const hasOnline = liveAgents.some(a => a.status === "online");

        // Agent status section
        const agentHtml = liveAgents.length > 0 ? liveAgents.map(a => {
          const pct = a.contextTokensAvailable > 0 ? (a.contextTokensUsed / a.contextTokensAvailable) * 100 : 0;
          return `
            <a href="#/agent/${a.id}" class="variant-agent-link">
              <div class="status-dot ${a.status}" style="display:inline-block;vertical-align:middle"></div>
              <strong>${a.name}</strong>
              <span style="color:#7d8590;font-size:11px">
                ${formatUptime(a.uptimeSeconds)} · ${a.messagesProcessed} msgs · $${a.costEstimatedUsd.toFixed(2)}
              </span>
            </a>`;
        }).join("") : "";

        return `
        <div class="card" style="cursor:default">
          <div class="card-header">
            <div style="display:flex;align-items:center;gap:6px">
              ${hasOnline ? '<div class="status-dot online" style="display:inline-block"></div>' : ''}
              <span class="agent-name">${v.name}</span>
            </div>
            <span class="badge ${dimBadgeClass(v.dimensionality)}">${v.dimensionality}</span>
          </div>
          <p style="font-size:12px;color:#7d8590;margin-bottom:10px;line-height:1.4">${v.description.slice(0, 150)}${v.description.length > 150 ? "..." : ""}</p>
          <div class="stats-row">
            <div class="stat-item"><span class="label">write</span> <span class="value" style="font-size:11px">${v.writePolicy.slice(0, 30)}</span></div>
            <div class="stat-item"><span class="label">storage</span> <span class="value" style="font-size:11px">${v.storageType.slice(0, 30)}</span></div>
            <div class="stat-item"><span class="label">retrieval</span> <span class="value" style="font-size:11px">${v.retrievalMethod.slice(0, 30)}</span></div>
          </div>
          ${agentHtml ? `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid #30363d">
              <h4 style="font-size:11px;color:#7d8590;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Agents</h4>
              ${agentHtml}
            </div>
          ` : ""}
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
