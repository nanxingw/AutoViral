<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchTasks, createTask, updateTask, deleteTask,
    approveTask, rejectTask, triggerTask,
    fetchTaskRuns, fetchTaskRun,
    fetchTaskArtifacts, openTaskArtifacts,
    fetchIdeas,
    type Task, type Idea,
  } from "../lib/api";
  import { createWsConnection } from "../lib/ws";

  // ── State ──────────────────────────────────────────────────────────────────

  let tasks: Task[] = $state([]);
  let ideas: Idea[] = $state([]);
  let loading: boolean = $state(true);
  let activeFilter: string = $state("all");
  let expandedId: string | null = $state(null);
  let showModal: boolean = $state(false);
  let showIdeas: boolean = $state(false);

  // Detail state for expanded task
  let detailRuns: { filename: string; date: string }[] = $state([]);
  let detailArtifacts: string[] = $state([]);
  let expandedRun: string | null = $state(null);
  let runContent: string = $state("");
  let loadingDetail: boolean = $state(false);
  let loadingRun: boolean = $state(false);

  // Running tasks (tracked via WS)
  let runningTasks: Set<string> = $state(new Set());

  // Create form state
  let formName: string = $state("");
  let formDesc: string = $state("");
  let formType: "cron" | "one-shot" = $state("cron");
  let formSchedule: string = $state("0 8 * * *");
  let formScheduledAt: string = $state("");
  let formPrompt: string = $state("");
  let formModel: string = $state("");
  let formTags: string = $state("");
  let formSaving: boolean = $state(false);
  let formError: string = $state("");

  // ── Derived ────────────────────────────────────────────────────────────────

  const filters = ["all", "active", "pending", "completed", "paused", "expired"] as const;

  let filteredTasks = $derived(
    activeFilter === "all"
      ? tasks
      : tasks.filter((t) => t.status === activeFilter)
  );

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadTasks() {
    try {
      tasks = await fetchTasks();
    } catch {
      tasks = [];
    }
  }

  async function loadIdeas() {
    try {
      ideas = await fetchIdeas();
    } catch {
      ideas = [];
    }
  }

  async function loadDetail(id: string) {
    loadingDetail = true;
    expandedRun = null;
    runContent = "";
    try {
      const [runs, artifacts] = await Promise.all([
        fetchTaskRuns(id),
        fetchTaskArtifacts(id),
      ]);
      detailRuns = runs;
      detailArtifacts = artifacts;
    } catch {
      detailRuns = [];
      detailArtifacts = [];
    } finally {
      loadingDetail = false;
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      expandedId = null;
      return;
    }
    expandedId = id;
    await loadDetail(id);
  }

  async function toggleRun(taskId: string, filename: string) {
    if (expandedRun === filename) {
      expandedRun = null;
      return;
    }
    expandedRun = filename;
    loadingRun = true;
    try {
      runContent = await fetchTaskRun(taskId, filename);
    } catch {
      runContent = "Failed to load run report.";
    } finally {
      loadingRun = false;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleApprove(e: Event, id: string) {
    e.stopPropagation();
    try {
      const updated = await approveTask(id);
      tasks = tasks.map((t) => (t.id === id ? updated : t));
    } catch { /* ignore */ }
  }

  async function handleReject(e: Event, id: string) {
    e.stopPropagation();
    try {
      await rejectTask(id);
      tasks = tasks.filter((t) => t.id !== id);
    } catch { /* ignore */ }
  }

  async function handleTrigger(e: Event, id: string) {
    e.stopPropagation();
    try {
      await triggerTask(id);
      runningTasks = new Set([...runningTasks, id]);
    } catch { /* ignore */ }
  }

  async function handlePauseResume(e: Event, task: Task) {
    e.stopPropagation();
    const newStatus = task.status === "paused" ? "active" : "paused";
    try {
      const updated = await updateTask(task.id, { status: newStatus } as Partial<Task>);
      tasks = tasks.map((t) => (t.id === task.id ? updated : t));
    } catch { /* ignore */ }
  }

  async function handleDelete(e: Event, id: string) {
    e.stopPropagation();
    try {
      await deleteTask(id);
      tasks = tasks.filter((t) => t.id !== id);
      if (expandedId === id) expandedId = null;
    } catch { /* ignore */ }
  }

  async function handleOpenArtifacts(id: string) {
    try {
      await openTaskArtifacts(id);
    } catch { /* ignore */ }
  }

  // ── Create form ────────────────────────────────────────────────────────────

  function openCreateModal() {
    formName = "";
    formDesc = "";
    formType = "cron";
    formSchedule = "0 8 * * *";
    formScheduledAt = "";
    formPrompt = "";
    formModel = "";
    formTags = "";
    formError = "";
    showModal = true;
  }

  function closeModal() {
    showModal = false;
  }

  async function handleCreate() {
    if (!formName.trim() || !formPrompt.trim()) {
      formError = "Name and prompt are required.";
      return;
    }
    formSaving = true;
    formError = "";
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        description: formDesc.trim(),
        prompt: formPrompt.trim(),
        status: "active",
        approved: true,
        tags: formTags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      if (formType === "cron") {
        payload.schedule = formSchedule.trim();
      } else {
        payload.scheduled_at = formScheduledAt ? new Date(formScheduledAt).toISOString() : undefined;
      }
      if (formModel) {
        payload.model = formModel;
      }
      const created = await createTask(payload as Partial<Task>);
      tasks = [...tasks, created];
      showModal = false;
    } catch (err) {
      formError = err instanceof Error ? err.message : "Failed to create task.";
    } finally {
      formSaving = false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function statusColor(status: string): string {
    switch (status) {
      case "active": return "var(--status-active)";
      case "running": return "var(--status-running)";
      case "paused": return "var(--status-paused)";
      case "pending": return "var(--status-pending)";
      case "expired": return "var(--status-failed)";
      case "completed": return "var(--status-completed)";
      default: return "var(--text-dim)";
    }
  }

  function scheduleLabel(task: Task): string {
    if (task.schedule?.type === "cron" && task.schedule.cron) {
      return task.schedule.cron;
    }
    if (task.schedule?.type === "one-shot" && task.schedule.at) {
      return new Date(task.schedule.at).toLocaleString();
    }
    return "--";
  }

  function scheduleTypeBadge(task: Task): string {
    if (task.schedule?.type === "cron") return "recurring";
    if (task.schedule?.type === "one-shot") return "one-shot";
    return "manual";
  }

  function formatTime(iso: string | undefined | null): string {
    if (!iso) return "--";
    return new Date(iso).toLocaleString();
  }

  function isRunning(id: string): boolean {
    return runningTasks.has(id);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    Promise.all([loadTasks(), loadIdeas()]).finally(() => {
      loading = false;
    });

    const ws = createWsConnection((event, data) => {
      if (event === "job_start" && data.taskId) {
        runningTasks = new Set([...runningTasks, data.taskId]);
      }
      if ((event === "job_end" || event === "job_error") && data.taskId) {
        const next = new Set(runningTasks);
        next.delete(data.taskId);
        runningTasks = next;
        // Reload task data
        loadTasks();
        if (expandedId === data.taskId) {
          loadDetail(data.taskId);
        }
      }
    });

    return () => ws.close();
  });
</script>

<div class="tasks-page">
  <!-- Header -->
  <div class="page-header">
    <h2>Tasks</h2>
    <button class="new-btn" onclick={openCreateModal}>+ New Task</button>
  </div>

  <!-- Filter pills -->
  <div class="filter-pills">
    {#each filters as f}
      <button
        class="pill"
        class:active={activeFilter === f}
        onclick={() => (activeFilter = f)}
      >
        {f.charAt(0).toUpperCase() + f.slice(1)}
        {#if f !== "all"}
          <span class="pill-count">{tasks.filter((t) => t.status === f).length}</span>
        {:else}
          <span class="pill-count">{tasks.length}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Task list -->
  {#if loading}
    <p class="muted">Loading tasks...</p>
  {:else if filteredTasks.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
      </div>
      <p class="empty-title">No tasks found</p>
      <p class="empty-desc">
        {#if activeFilter === "all"}
          Create your first task to get started.
        {:else}
          No {activeFilter} tasks at the moment.
        {/if}
      </p>
    </div>
  {:else}
    <div class="task-list">
      {#each filteredTasks as task (task.id)}
        {@const running = isRunning(task.id)}
        <div
          class="task-card"
          class:expanded={expandedId === task.id}
          style="--card-accent: {statusColor(task.status)}"
        >
          <!-- Card header (always visible) -->
          <button class="card-header" onclick={() => toggleExpand(task.id)}>
            <div class="card-left">
              <span
                class="status-dot"
                class:pulse={running}
                style="background: {running ? 'var(--status-running)' : statusColor(task.status)}"
              ></span>
              <div class="card-info">
                <div class="card-title-row">
                  <span class="card-name">{task.name}</span>
                  <span class="badge type-badge">{scheduleTypeBadge(task)}</span>
                </div>
                <div class="card-meta">
                  <span class="meta-item">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    {scheduleLabel(task)}
                  </span>
                  {#if task.lastRun}
                    <span class="meta-item">Last: {formatTime(task.lastRun)}</span>
                  {/if}
                  {#if task.runCount > 0}
                    <span class="meta-item">Runs: {task.runCount}</span>
                  {/if}
                </div>
              </div>
            </div>

            <div class="card-actions" onclick={(e) => e.stopPropagation()}>
              {#if task.status === "pending" && !task.approved}
                <button class="action-btn approve" onclick={(e) => handleApprove(e, task.id)}>Approve</button>
                <button class="action-btn reject" onclick={(e) => handleReject(e, task.id)}>Reject</button>
              {:else}
                <button
                  class="action-btn ghost"
                  disabled={running}
                  onclick={(e) => handleTrigger(e, task.id)}
                >
                  {running ? "Running..." : "Run Now"}
                </button>
                {#if task.schedule?.type === "cron"}
                  <button class="action-btn ghost" onclick={(e) => handlePauseResume(e, task)}>
                    {task.status === "paused" ? "Resume" : "Pause"}
                  </button>
                {/if}
                <button class="action-btn ghost danger" onclick={(e) => handleDelete(e, task.id)}>Del</button>
              {/if}
            </div>
          </button>

          <!-- Tags row -->
          {#if task.tags && task.tags.length > 0}
            <div class="card-tags">
              {#each task.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}

          <!-- Expanded detail -->
          {#if expandedId === task.id}
            <div class="card-detail">
              {#if task.description}
                <div class="detail-section">
                  <h4>Description</h4>
                  <p>{task.description}</p>
                </div>
              {/if}

              <div class="detail-section">
                <h4>Prompt</h4>
                <pre class="prompt-box">{task.prompt}</pre>
              </div>

              <div class="detail-section detail-row">
                <div class="detail-pair">
                  <h4>Created</h4>
                  <span class="meta-mono">{formatTime(task.createdAt)}</span>
                </div>
                {#if task.model}
                  <div class="detail-pair">
                    <h4>Model</h4>
                    <span class="meta-mono">{task.model}</span>
                  </div>
                {/if}
              </div>

              {#if loadingDetail}
                <p class="muted">Loading details...</p>
              {:else}
                <!-- Artifacts -->
                {#if detailArtifacts.length > 0}
                  <div class="detail-section">
                    <div class="section-header">
                      <h4>Artifacts ({detailArtifacts.length})</h4>
                      <button class="action-btn ghost small" onclick={() => handleOpenArtifacts(task.id)}>
                        Open Folder
                      </button>
                    </div>
                    <ul class="artifact-list">
                      {#each detailArtifacts as artifact}
                        <li class="artifact-item">{artifact}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}

                <!-- Run history -->
                <div class="detail-section">
                  <h4>Run History ({detailRuns.length})</h4>
                  {#if detailRuns.length === 0}
                    <p class="muted">No runs yet.</p>
                  {:else}
                    <ul class="run-list">
                      {#each [...detailRuns].reverse() as run}
                        <li>
                          <button class="run-item" onclick={() => toggleRun(task.id, run.filename)}>
                            <span class="run-date">{new Date(run.date).toLocaleString()}</span>
                            <span class="run-file">{run.filename}</span>
                            <span class="chevron">{expandedRun === run.filename ? "v" : ">"}</span>
                          </button>
                          {#if expandedRun === run.filename}
                            <div class="run-content">
                              {#if loadingRun}
                                <p class="muted">Loading...</p>
                              {:else}
                                <pre>{runContent}</pre>
                              {/if}
                            </div>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Idea Buffer -->
  <div class="idea-section">
    <button class="idea-header" onclick={() => (showIdeas = !showIdeas)}>
      <span>Idea Buffer</span>
      <span class="idea-count">{ideas.length}</span>
      <span class="chevron">{showIdeas ? "v" : ">"}</span>
    </button>
    {#if showIdeas}
      <div class="idea-list">
        {#if ideas.length === 0}
          <p class="muted">No ideas in the buffer.</p>
        {:else}
          {#each ideas as idea}
            <div class="idea-card">
              <p class="idea-text">{idea.idea}</p>
              <div class="idea-meta">
                <span class="idea-reason">{idea.reason}</span>
                <span class="idea-date">{new Date(idea.added).toLocaleDateString()}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Create Modal -->
  {#if showModal}
    <div class="modal-overlay" onclick={closeModal}>
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>New Task</h3>
          <button class="modal-close" onclick={closeModal}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="modal-body">
          <label>
            <span>Name</span>
            <input type="text" bind:value={formName} placeholder="e.g. Daily code review" />
          </label>

          <label>
            <span>Description</span>
            <input type="text" bind:value={formDesc} placeholder="Brief description (optional)" />
          </label>

          <div class="radio-group">
            <span class="radio-label">Type</span>
            <label class="radio-option">
              <input type="radio" bind:group={formType} value="cron" />
              <span>Recurring</span>
            </label>
            <label class="radio-option">
              <input type="radio" bind:group={formType} value="one-shot" />
              <span>One-shot</span>
            </label>
          </div>

          {#if formType === "cron"}
            <label>
              <span>Schedule (cron)</span>
              <input type="text" bind:value={formSchedule} placeholder="0 8 * * *" class="mono-input" />
              <span class="hint">min hour dom month dow (e.g. "0 8 * * *" = daily at 08:00)</span>
            </label>
          {:else}
            <label>
              <span>Scheduled At</span>
              <input type="datetime-local" bind:value={formScheduledAt} />
            </label>
          {/if}

          <label>
            <span>Prompt</span>
            <textarea bind:value={formPrompt} rows="5" placeholder="What should Claude do?"></textarea>
          </label>

          <label>
            <span>Model</span>
            <select bind:value={formModel}>
              <option value="">Default (from config)</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </label>

          <label>
            <span>Tags</span>
            <input type="text" bind:value={formTags} placeholder="Comma-separated, e.g. review, daily" />
          </label>

          {#if formError}
            <p class="form-error">{formError}</p>
          {/if}
        </div>

        <div class="modal-footer">
          <button class="action-btn ghost" onclick={closeModal}>Cancel</button>
          <button class="action-btn primary" onclick={handleCreate} disabled={formSaving}>
            {formSaving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Status colors ──────────────────────────────────────────────────────── */
  .tasks-page {
    --status-active: #22c55e;
    --status-running: #d97706;
    --status-paused: #78716c;
    --status-pending: #3b82f6;
    --status-failed: #ef4444;
    --status-completed: #22c55e;

    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .page-header h2 {
    font-size: 1.1rem;
    font-weight: 500;
  }

  .new-btn {
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 0.625rem;
    font-weight: 500;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .new-btn:hover {
    background: var(--accent-hover);
  }

  /* ── Filter pills ───────────────────────────────────────────────────────── */
  .filter-pills {
    display: flex;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 9999px;
    padding: 0.3rem 0.9rem;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .pill:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }

  .pill.active {
    background: var(--bg-surface);
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 500;
  }

  .pill-count {
    font-size: 0.7rem;
    opacity: 0.7;
  }

  /* ── Empty state ────────────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: var(--text-dim);
  }

  .empty-icon {
    opacity: 0.3;
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .empty-desc {
    font-size: 0.85rem;
  }

  /* ── Task list ──────────────────────────────────────────────────────────── */
  .task-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* ── Task card ──────────────────────────────────────────────────────────── */
  .task-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-left: 4px solid var(--card-accent, var(--border));
    border-radius: 0.625rem;
    transition: border-color 0.15s, box-shadow 0.15s;
    overflow: hidden;
  }

  .task-card:hover {
    border-color: var(--text-dim);
    border-left-color: var(--card-accent);
  }

  .task-card.expanded {
    border-color: var(--card-accent);
    border-left-color: var(--card-accent);
  }

  .card-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.875rem 1rem;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 0.9rem;
  }

  .card-left {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 0.35rem;
  }

  .status-dot.pulse {
    animation: pulse-ring 1.5s ease-out infinite;
  }

  @keyframes pulse-ring {
    0% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.5); }
    70% { box-shadow: 0 0 0 6px rgba(217, 119, 6, 0); }
    100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0); }
  }

  .card-info {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .card-name {
    font-weight: 500;
    font-size: 0.95rem;
  }

  .badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .type-badge {
    background: var(--border);
    color: var(--text-muted);
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .meta-item {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .meta-item svg {
    opacity: 0.6;
  }

  /* ── Card actions ───────────────────────────────────────────────────────── */
  .card-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }

  .action-btn {
    padding: 0.35rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .action-btn.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .action-btn.ghost:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  .action-btn.ghost.danger:hover {
    border-color: var(--error);
    color: var(--error);
  }

  .action-btn.ghost.small {
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
  }

  .action-btn.ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-btn.approve {
    background: #22c55e;
    color: #fff;
    border: none;
  }

  .action-btn.approve:hover {
    background: #16a34a;
  }

  .action-btn.reject {
    background: none;
    border: 1px solid var(--error);
    color: var(--error);
  }

  .action-btn.reject:hover {
    background: var(--error);
    color: #fff;
  }

  .action-btn.primary {
    background: var(--accent);
    color: var(--accent-text);
    border: none;
  }

  .action-btn.primary:hover {
    background: var(--accent-hover);
  }

  .action-btn.primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Tags ───────────────────────────────────────────────────────────────── */
  .card-tags {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    padding: 0 1rem 0.5rem 2.5rem;
  }

  .tag {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.7rem;
    background: var(--bg-inset);
    color: var(--text-dim);
    border: 1px solid var(--border);
  }

  /* ── Card detail (expanded) ─────────────────────────────────────────────── */
  .card-detail {
    padding: 0 1rem 1rem 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    border-top: 1px solid var(--border);
    margin-top: 0.25rem;
    padding-top: 1rem;
  }

  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .detail-section h4 {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.03em;
  }

  .detail-section p {
    font-size: 0.88rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .detail-row {
    flex-direction: row;
    gap: 2rem;
  }

  .detail-pair {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .detail-pair h4 {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.03em;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .prompt-box {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.75rem;
    max-height: 300px;
    overflow-y: auto;
    color: var(--text-secondary);
  }

  .meta-mono {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.8rem;
    color: var(--accent);
  }

  /* ── Artifact list ──────────────────────────────────────────────────────── */
  .artifact-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .artifact-item {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.78rem;
    color: var(--text-muted);
    padding: 0.25rem 0.5rem;
    background: var(--bg-inset);
    border-radius: 0.375rem;
  }

  /* ── Run list ───────────────────────────────────────────────────────────── */
  .run-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .run-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1rem;
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.5rem 0.75rem;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 0.82rem;
    transition: border-color 0.15s;
  }

  .run-item:hover {
    border-color: var(--accent);
  }

  .run-date {
    color: var(--text-muted);
    min-width: 140px;
    font-size: 0.78rem;
  }

  .run-file {
    flex: 1;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.78rem;
  }

  .chevron {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .run-content {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0 0 0.5rem 0.5rem;
    padding: 0.75rem;
    margin-top: -0.125rem;
  }

  .run-content pre {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.78rem;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
    max-height: 400px;
    overflow-y: auto;
  }

  /* ── Idea buffer ────────────────────────────────────────────────────────── */
  .idea-section {
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }

  .idea-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 500;
    padding: 0.25rem 0;
    transition: color 0.15s;
  }

  .idea-header:hover {
    color: var(--text);
  }

  .idea-count {
    font-size: 0.75rem;
    background: var(--border);
    padding: 0.1rem 0.5rem;
    border-radius: 9999px;
    color: var(--text-dim);
    font-weight: 400;
  }

  .idea-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .idea-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
  }

  .idea-text {
    font-size: 0.88rem;
    color: var(--text-secondary);
    margin-bottom: 0.4rem;
  }

  .idea-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .idea-reason {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-style: italic;
  }

  .idea-date {
    font-size: 0.72rem;
    color: var(--text-dim);
    white-space: nowrap;
  }

  /* ── Muted text ─────────────────────────────────────────────────────────── */
  .muted {
    color: var(--text-dim);
    font-size: 0.85rem;
  }

  /* ── Modal ──────────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 520px;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h3 {
    font-size: 1rem;
    font-weight: 500;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 0.375rem;
    display: flex;
    transition: color 0.15s;
  }

  .modal-close:hover {
    color: var(--text);
  }

  .modal-body {
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modal-body label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .modal-body label span {
    font-size: 0.8rem;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.03em;
  }

  .modal-body input[type="text"],
  .modal-body input[type="datetime-local"],
  .modal-body input[type="number"],
  .modal-body select,
  .modal-body textarea {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
    font-family: inherit;
    resize: vertical;
  }

  .modal-body textarea {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.82rem;
    min-height: 80px;
  }

  .modal-body input:focus,
  .modal-body select:focus,
  .modal-body textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .mono-input {
    font-family: "SF Mono", "Fira Code", monospace !important;
  }

  .hint {
    font-size: 0.72rem !important;
    color: var(--text-dim) !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    margin-top: 0.15rem;
  }

  .radio-group {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .radio-label {
    font-size: 0.8rem;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.03em;
    margin-right: 0.25rem;
  }

  .radio-option {
    display: flex !important;
    flex-direction: row !important;
    align-items: center;
    gap: 0.35rem;
  }

  .radio-option input[type="radio"] {
    accent-color: var(--accent);
  }

  .radio-option span {
    font-size: 0.88rem !important;
    text-transform: none !important;
    color: var(--text) !important;
    letter-spacing: 0 !important;
  }

  .form-error {
    font-size: 0.82rem;
    color: var(--error);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--border);
  }
</style>
