<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchDashboard,
    triggerEvolution,
    type DashboardData,
    type DashboardReport,
    type DashboardTask,
  } from "../lib/api";
  import { createWsConnection } from "../lib/ws";

  // ── State ──────────────────────────────────────────────────────────────────
  let data: DashboardData | null = $state(null);
  let loading: boolean = $state(true);
  let triggering: boolean = $state(false);

  // Per-agent live output
  let agentOutput: Record<string, string> = $state({});
  let agentActive: Record<string, boolean> = $state({});
  let liveOutput: string = $state("");
  let activeOutputTab: string = $state("all");

  // Derived
  let state = $derived(data?.state ?? "idle");
  let activeAgents = $derived(data?.activeAgents ?? []);
  let recentReports = $derived(data?.recentReports ?? []);
  let scheduledTasks = $derived(data?.scheduledTasks ?? []);

  // ── Agent definitions ──────────────────────────────────────────────────────
  const agents = [
    {
      key: "context",
      jobType: "evo-context",
      name: "Context Agent",
      desc: "Building your long-term memory — preferences, goals, cognitive patterns",
      icon: "brain",
      color: "var(--agent-context)",
      colorSoft: "var(--agent-context-soft)",
    },
    {
      key: "skill",
      jobType: "evo-skill",
      name: "Skill Agent",
      desc: "Discovering needs and creating skills to enhance your workflow",
      icon: "zap",
      color: "var(--agent-skill)",
      colorSoft: "var(--agent-skill-soft)",
    },
    {
      key: "task",
      jobType: "evo-task",
      name: "Task Agent",
      desc: "Scheduling autonomous tasks and managing background automation",
      icon: "calendar",
      color: "var(--agent-task)",
      colorSoft: "var(--agent-task-soft)",
    },
  ];

  function isAgentActive(jobType: string): boolean {
    return agentActive[jobType] || activeAgents.some(a => a.type === jobType);
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadDashboard() {
    try {
      data = await fetchDashboard();
    } catch { /* ignore */ }
    loading = false;
  }

  async function handleTrigger() {
    triggering = true;
    liveOutput = "";
    agentOutput = {};
    try {
      await triggerEvolution();
    } catch { /* ignore */ }
    triggering = false;
  }

  onMount(() => {
    loadDashboard();
    const ws = createWsConnection((event, payload) => {
      if (event === "cycle_start") {
        agentOutput = {};
        agentActive = {};
        liveOutput = "";
      } else if (event === "job_start") {
        const jt = payload.jobType as string;
        if (jt === "evo-context" || jt === "evo-skill" || jt === "evo-task") {
          agentActive = { ...agentActive, [jt]: true };
          agentOutput = { ...agentOutput, [jt]: "" };
        }
      } else if (event === "job_progress") {
        const jt = payload.jobType as string;
        const text = payload.text ?? "";
        if (jt === "evo-context" || jt === "evo-skill" || jt === "evo-task") {
          agentOutput = { ...agentOutput, [jt]: (agentOutput[jt] ?? "") + text };
        }
        liveOutput += text;
      } else if (event === "job_end" || event === "job_error") {
        const jt = payload.jobType as string;
        if (jt === "evo-context" || jt === "evo-skill" || jt === "evo-task") {
          agentActive = { ...agentActive, [jt]: false };
        }
      } else if (event === "cycle_end") {
        agentActive = {};
        loadDashboard();
      } else if (event === "cycle_progress") {
        liveOutput += payload.text ?? payload ?? "";
      } else if (event === "cycle_error") {
        liveOutput += `\n[ERROR] ${payload.message ?? "Unknown error"}`;
        loadDashboard();
      }
    });
    return () => ws.close();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function relativeTime(iso: string | null): string {
    if (!iso) return "never";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function formatTime(iso: string | null): string {
    if (!iso) return "--";
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function describeCron(cron: string): string {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;
    const [min, hour, dom, mon, dow] = parts;
    const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (dom === "*" && mon === "*" && dow === "*") return `Daily ${time}`;
    if (dom === "*" && mon === "*" && dow !== "*") {
      const days = dow.split(",").map(d => dowNames[+d] ?? d).join(", ");
      return `${days} ${time}`;
    }
    if (dom !== "*" && mon === "*" && dow === "*") return `Monthly ${dom}th ${time}`;
    if (min.startsWith("*/")) return `Every ${min.slice(2)}m`;
    if (hour.startsWith("*/")) return `Every ${hour.slice(2)}h`;
    return cron;
  }

  function scheduleLabel(t: DashboardTask): string {
    if (!t.schedule) return "manual";
    if (t.schedule.type === "cron" && t.schedule.cron) return describeCron(t.schedule.cron);
    if (t.schedule.type === "one-shot" && t.schedule.at) {
      return formatTime(t.schedule.at);
    }
    return "scheduled";
  }

  function agentTypeLabel(type: string): string {
    if (type === "context") return "Context";
    if (type === "skill") return "Skill";
    if (type === "task") return "Task";
    return "Evolution";
  }

  function getAgentOutputPreview(jobType: string): string {
    const out = agentOutput[jobType] ?? "";
    if (!out) return "";
    const lines = out.trim().split("\n");
    return lines.slice(-3).join("\n");
  }
</script>

<div class="dashboard">
  <!-- ══ Status Bar ══════════════════════════════════════════════════════════ -->
  <div class="status-bar" class:running={state === "running"}>
    <div class="status-left">
      <span class="dot" class:pulse={state === "running"} style="--dot-color: {state === 'running' ? 'var(--state-running)' : 'var(--state-idle)'}"></span>
      <div class="status-text">
        <span class="status-label">{state === "running" ? "Evolution in progress" : "System idle"}</span>
        <span class="status-sub">
          {#if data}
            Last run {relativeTime(data.lastRun)} · Next {data.nextRun ? relativeTime(data.nextRun) : "not scheduled"}
          {:else}
            Loading...
          {/if}
        </span>
      </div>
    </div>
    <button class="trigger-btn" onclick={handleTrigger} disabled={state === "running" || triggering}>
      {#if state === "running"}
        <svg class="spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
        Running
      {:else}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Evolve Now
      {/if}
    </button>
  </div>

  <!-- ══ Agent Cards ═════════════════════════════════════════════════════════ -->
  <div class="agents-section">
    <h3 class="section-title">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      Agents
    </h3>
    <div class="agents-grid">
      {#each agents as agent}
        {@const active = isAgentActive(agent.jobType)}
        {@const preview = getAgentOutputPreview(agent.jobType)}
        <div class="agent-card" class:active style="--agent-color: {agent.color}; --agent-soft: {agent.colorSoft}">
          <div class="agent-header">
            <div class="agent-icon" class:working={active}>
              {#if agent.icon === "brain"}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.58.7 3 1.78 4A5.47 5.47 0 0 0 4 15.5 5.5 5.5 0 0 0 9.5 21h.5"/><path d="M14.5 2A5.5 5.5 0 0 1 20 7.5c0 1.58-.7 3-1.78 4A5.47 5.47 0 0 1 20 15.5a5.5 5.5 0 0 1-5.5 5.5H14"/><path d="M12 2v19"/></svg>
              {:else if agent.icon === "zap"}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              {:else}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {/if}
            </div>
            <div class="agent-meta">
              <span class="agent-name">{agent.name}</span>
              <span class="agent-status" class:status-active={active}>
                {#if active}
                  <span class="status-dot active"></span>working
                {:else}
                  <span class="status-dot idle"></span>standby
                {/if}
              </span>
            </div>
          </div>
          <p class="agent-desc">{agent.desc}</p>
          {#if active && preview}
            <div class="agent-output">
              <pre>{preview}</pre>
            </div>
          {:else if active}
            <div class="agent-output">
              <div class="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- ══ Two-column: Reports + Tasks ═════════════════════════════════════════ -->
  <div class="info-grid">
    <!-- Recent Reports -->
    <div class="info-card">
      <div class="info-header">
        <h3>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Recent Reports
        </h3>
        <span class="count-badge">{data?.totalReports ?? 0}</span>
      </div>
      {#if loading}
        <div class="skeleton-list">
          {#each Array(3) as _}
            <div class="skeleton-row"><div class="skeleton-bar"></div></div>
          {/each}
        </div>
      {:else if recentReports.length === 0}
        <div class="empty-state">
          <p>No reports yet</p>
          <p class="empty-hint">Run an evolution cycle to generate your first report.</p>
        </div>
      {:else}
        <ul class="report-list">
          {#each recentReports as report}
            <li class="report-item">
              <div class="report-badge" data-type={report.agentType}>
                {agentTypeLabel(report.agentType)}
              </div>
              <div class="report-body">
                <span class="report-summary">{report.summary || report.filename}</span>
                <span class="report-time">{relativeTime(report.date)}</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Task Schedule -->
    <div class="info-card">
      <div class="info-header">
        <h3>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>
          Task Schedule
        </h3>
        <span class="count-badge">{scheduledTasks.length} active</span>
      </div>
      {#if loading}
        <div class="skeleton-list">
          {#each Array(3) as _}
            <div class="skeleton-row"><div class="skeleton-bar"></div></div>
          {/each}
        </div>
      {:else if scheduledTasks.length === 0}
        <div class="empty-state">
          <p>No scheduled tasks</p>
          <p class="empty-hint">Tasks created by the Task Agent or by you will appear here.</p>
        </div>
      {:else}
        <ul class="task-list">
          {#each scheduledTasks as task}
            <li class="task-item">
              <div class="task-left">
                <span class="task-status-dot" class:pending={task.status === "pending"}></span>
                <span class="task-name">{task.name}</span>
              </div>
              <div class="task-right">
                <code class="task-schedule">{scheduleLabel(task)}</code>
                {#if task.runCount > 0}
                  <span class="task-runs">{task.runCount}x</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>

  <!-- ══ Quick Stats ═════════════════════════════════════════════════════════ -->
  <div class="stats-strip">
    <div class="mini-stat">
      <span class="mini-stat-num">{data?.totalReports ?? 0}</span>
      <span class="mini-stat-label">Reports</span>
    </div>
    <div class="mini-stat">
      <span class="mini-stat-num">{data?.skillCount ?? 0}</span>
      <span class="mini-stat-label">Skills</span>
    </div>
    <div class="mini-stat">
      <span class="mini-stat-num">{scheduledTasks.length}</span>
      <span class="mini-stat-label">Active Tasks</span>
    </div>
    <div class="mini-stat">
      <span class="mini-stat-num">{data?.evolutionMode ?? "--"}</span>
      <span class="mini-stat-label">Mode</span>
    </div>
  </div>

  <!-- ══ Live Output ═════════════════════════════════════════════════════════ -->
  {#if state === "running" || liveOutput}
    <div class="live-panel">
      <div class="live-header">
        <div class="live-tabs">
          <button class="live-tab" class:active={activeOutputTab === "all"} onclick={() => activeOutputTab = "all"}>All</button>
          <button class="live-tab" class:active={activeOutputTab === "evo-context"} onclick={() => activeOutputTab = "evo-context"}>
            <span class="tab-dot" style="background: var(--agent-context)"></span>Context
          </button>
          <button class="live-tab" class:active={activeOutputTab === "evo-skill"} onclick={() => activeOutputTab = "evo-skill"}>
            <span class="tab-dot" style="background: var(--agent-skill)"></span>Skill
          </button>
          <button class="live-tab" class:active={activeOutputTab === "evo-task"} onclick={() => activeOutputTab = "evo-task"}>
            <span class="tab-dot" style="background: var(--agent-task)"></span>Task
          </button>
        </div>
        {#if state === "running"}
          <span class="live-badge">LIVE</span>
        {/if}
      </div>
      <pre>{(activeOutputTab === "all" ? liveOutput : (agentOutput[activeOutputTab] ?? "")) || "Waiting for output..."}</pre>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* ── Agent Colors ───────────────────────────────────────────────────────── */
  :global(:root) {
    --agent-context: #7c9aeb;
    --agent-context-soft: rgba(124, 154, 235, 0.12);
    --agent-skill: #e5a836;
    --agent-skill-soft: rgba(229, 168, 54, 0.12);
    --agent-task: #6ecf97;
    --agent-task-soft: rgba(110, 207, 151, 0.12);
  }

  /* ── Section Title ──────────────────────────────────────────────────────── */
  .section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.05em;
    font-weight: 600;
    margin-bottom: 0.625rem;
  }

  .section-title svg {
    color: var(--accent);
  }

  /* ── Status Bar ─────────────────────────────────────────────────────────── */
  .status-bar {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.25rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    box-shadow: var(--shadow-sm);
    transition: border-color 0.3s ease, box-shadow 0.3s ease;
  }

  .status-bar.running {
    border-color: var(--state-running);
    box-shadow: 0 0 0 1px var(--state-running), 0 0 20px rgba(229, 168, 54, 0.05);
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--dot-color);
    flex-shrink: 0;
  }

  .dot.pulse {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(229, 168, 54, 0.4); }
    50% { box-shadow: 0 0 0 6px rgba(229, 168, 54, 0); }
  }

  .status-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .status-label {
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .status-sub {
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .trigger-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.6rem 1.35rem;
    border-radius: 10px;
    font-weight: 550;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s ease;
    white-space: nowrap;
    box-shadow: var(--shadow-sm);
    flex-shrink: 0;
  }

  .trigger-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .trigger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Agent Cards ────────────────────────────────────────────────────────── */
  .agents-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }

  @media (max-width: 768px) {
    .agents-grid {
      grid-template-columns: 1fr;
    }
  }

  .agent-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.125rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: var(--shadow-sm);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }

  .agent-card::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--agent-color);
    opacity: 0.4;
    transition: opacity 0.3s;
  }

  .agent-card.active::before {
    opacity: 1;
  }

  .agent-card.active {
    border-color: var(--agent-color);
    box-shadow: 0 0 0 1px var(--agent-color), 0 4px 16px rgba(0, 0, 0, 0.1);
  }

  .agent-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .agent-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--agent-soft);
    color: var(--agent-color);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.3s;
  }

  .agent-icon.working {
    animation: breathe 2.5s ease-in-out infinite;
  }

  @keyframes breathe {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 var(--agent-soft); }
    50% { transform: scale(1.05); box-shadow: 0 0 0 8px transparent; }
  }

  .agent-meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .agent-name {
    font-size: 0.9rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .agent-status {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .agent-status.status-active {
    color: var(--agent-color);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-dim);
  }

  .status-dot.active {
    background: var(--agent-color);
    animation: status-pulse 1.5s ease-in-out infinite;
  }

  .status-dot.idle {
    opacity: 0.5;
  }

  @keyframes status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .agent-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .agent-output {
    background: var(--bg-inset);
    border-radius: 8px;
    padding: 0.625rem 0.75rem;
    animation: fadeSlideIn 0.3s ease;
  }

  .agent-output pre {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.7rem;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    max-height: 72px;
    overflow: hidden;
  }

  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Typing indicator */
  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: 0.2rem 0;
  }

  .typing-indicator span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-dim);
    animation: typing 1.4s ease-in-out infinite;
  }

  .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes typing {
    0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
    30% { opacity: 1; transform: translateY(-3px); }
  }

  /* ── Info Grid (Reports + Tasks) ────────────────────────────────────────── */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  @media (max-width: 768px) {
    .info-grid {
      grid-template-columns: 1fr;
    }
  }

  .info-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.125rem;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .info-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .info-header h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .info-header svg {
    color: var(--text-muted);
  }

  .count-badge {
    font-size: 0.7rem;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 0.15rem 0.55rem;
    border-radius: 9999px;
    border: 1px solid var(--border-subtle);
    font-variant-numeric: tabular-nums;
  }

  /* Reports list */
  .report-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .report-item {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.5rem 0.625rem;
    border-radius: 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    transition: border-color 0.15s;
  }

  .report-item:hover {
    border-color: var(--border);
  }

  .report-badge {
    font-size: 0.62rem;
    font-weight: 600;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 0.1rem;
  }

  .report-badge[data-type="context"] {
    background: var(--agent-context-soft);
    color: var(--agent-context);
  }

  .report-badge[data-type="skill"] {
    background: var(--agent-skill-soft);
    color: var(--agent-skill);
  }

  .report-badge[data-type="task"] {
    background: var(--agent-task-soft);
    color: var(--agent-task);
  }

  .report-badge[data-type="evolution"] {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .report-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }

  .report-summary {
    font-size: 0.8rem;
    color: var(--text-secondary);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .report-time {
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  /* Task list */
  .task-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .task-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.55rem 0.625rem;
    border-radius: 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    transition: border-color 0.15s;
  }

  .task-item:hover {
    border-color: var(--border);
  }

  .task-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .task-status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    flex-shrink: 0;
  }

  .task-status-dot.pending {
    background: var(--state-running);
  }

  .task-name {
    font-size: 0.82rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .task-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .task-schedule {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.68rem;
    color: var(--text-dim);
    background: var(--bg-inset);
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
  }

  .task-runs {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 0.1rem 0.4rem;
    border-radius: 9999px;
  }

  /* ── Stats Strip ────────────────────────────────────────────────────────── */
  .stats-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }

  .mini-stat {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    box-shadow: var(--shadow-sm);
  }

  .mini-stat-num {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .mini-stat-label {
    font-size: 0.68rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* ── Empty & Skeleton ───────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 1.25rem 0.5rem;
    text-align: center;
  }

  .empty-state p {
    color: var(--text-muted);
    font-size: 0.82rem;
  }

  .empty-hint {
    font-size: 0.72rem !important;
    color: var(--text-dim) !important;
    max-width: 240px;
    line-height: 1.5;
  }

  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .skeleton-row {
    padding: 0.75rem 0.625rem;
    background: var(--bg-surface);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
  }

  .skeleton-bar {
    height: 10px;
    width: 75%;
    border-radius: 4px;
    background: var(--bg-hover);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.6; }
  }

  /* ── Live Panel ─────────────────────────────────────────────────────────── */
  .live-panel {
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }

  .live-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .live-tabs {
    display: flex;
    gap: 0.25rem;
  }

  .live-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    font-size: 0.72rem;
    font-weight: 550;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .live-tab:hover {
    color: var(--text-muted);
    background: var(--bg-hover);
  }

  .live-tab.active {
    color: var(--text);
    background: var(--bg-surface);
  }

  .tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .live-badge {
    font-size: 0.62rem;
    font-weight: 700;
    padding: 0.1rem 0.45rem;
    border-radius: 9999px;
    background: var(--error);
    color: #fff;
    letter-spacing: 0.05em;
    animation: blink 1.5s ease-in-out infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .live-panel pre {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 320px;
    overflow-y: auto;
    color: var(--text-secondary);
    padding: 0.875rem 1rem;
    line-height: 1.6;
  }
</style>
