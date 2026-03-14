<script lang="ts">
  import { onMount } from "svelte";
  import {
    fetchTasks, createTask, updateTask, deleteTask,
    approveTask, rejectTask, triggerTask,
    fetchTaskRuns, fetchTaskRun,
    fetchTaskArtifacts, fetchTaskArtifact, openTaskArtifacts,
    fetchIdeas,
    type Task, type Idea,
  } from "../lib/api";
  import { createWsConnection } from "../lib/ws";
  import { marked } from "marked";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let lang = $state(getLanguage());

  // ── State ──────────────────────────────────────────────────────────────────

  let tasks: Task[] = $state([]);
  let ideas: Idea[] = $state([]);
  let loading: boolean = $state(true);
  let loadError: string = $state("");
  let activeFilter: string = $state("all");
  let selectedId: string | null = $state(null);
  let showModal: boolean = $state(false);
  let showIdeas: boolean = $state(false);

  // Workspace tabs
  let activeTab: "runs" | "artifacts" | "settings" = $state("runs");

  // Detail state for selected task
  let detailRuns: { filename: string; date: string }[] = $state([]);
  let detailArtifacts: string[] = $state([]);
  let selectedRunFilename: string | null = $state(null);
  let runContent: string = $state("");
  let loadingDetail: boolean = $state(false);
  let loadingRun: boolean = $state(false);
  let selectedArtifact: string | null = $state(null);
  let artifactContent: string = $state("");
  let loadingArtifact: boolean = $state(false);

  // Running tasks (tracked via WS)
  let runningTasks: Set<string> = $state(new Set());

  // Delete confirmation
  let confirmDeleteId: string | null = $state(null);
  let confirmTimer: ReturnType<typeof setTimeout> | null = $state(null);

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

  // Settings (inline edit) state
  let editName: string = $state("");
  let editDesc: string = $state("");
  let editPrompt: string = $state("");
  let editModel: string = $state("");
  let editTags: string = $state("");
  let editSchedule: string = $state("");
  let editScheduledAt: string = $state("");
  let editType: "cron" | "one-shot" = $state("cron");
  let editSaving: boolean = $state(false);
  let editError: string = $state("");
  let editSuccess: string = $state("");

  // ── Derived ────────────────────────────────────────────────────────────────

  const filters = ["all", "active", "pending", "completed", "paused", "expired"] as const;

  let filteredTasks = $derived(
    activeFilter === "all"
      ? tasks
      : tasks.filter((t) => t.status === activeFilter)
  );

  let selectedTask = $derived(
    selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null
  );

  // ── Configure marked ───────────────────────────────────────────────────────

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadTasks() {
    try {
      loadError = "";
      tasks = await fetchTasks();
    } catch (err) {
      tasks = [];
      loadError = err instanceof Error ? err.message : t("failedToLoad");
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
    selectedRunFilename = null;
    runContent = "";
    selectedArtifact = null;
    artifactContent = "";
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

  async function selectTask(id: string) {
    if (selectedId === id) return;
    selectedId = id;
    activeTab = "runs";
    populateEditForm(tasks.find((t) => t.id === id) ?? null);
    await loadDetail(id);
  }

  async function selectRun(taskId: string, filename: string) {
    if (selectedRunFilename === filename) {
      selectedRunFilename = null;
      runContent = "";
      return;
    }
    selectedRunFilename = filename;
    loadingRun = true;
    try {
      runContent = await fetchTaskRun(taskId, filename);
    } catch {
      runContent = t("failedToSave");
    } finally {
      loadingRun = false;
    }
  }

  async function selectArtifact(taskId: string, filename: string) {
    if (selectedArtifact === filename) {
      selectedArtifact = null;
      artifactContent = "";
      return;
    }
    selectedArtifact = filename;
    loadingArtifact = true;
    try {
      artifactContent = await fetchTaskArtifact(taskId, filename);
    } catch {
      artifactContent = t("failedToSave");
    } finally {
      loadingArtifact = false;
    }
  }

  function isMarkdown(filename: string): boolean {
    return /\.md$/i.test(filename);
  }

  function populateEditForm(task: Task | null) {
    if (!task) return;
    editName = task.name;
    editDesc = task.description ?? "";
    editPrompt = task.prompt;
    editModel = task.model ?? "";
    editTags = task.tags?.join(", ") ?? "";
    editType = task.schedule?.type ?? "cron";
    editSchedule = task.schedule?.cron ?? "0 8 * * *";
    editScheduledAt = task.schedule?.at ? task.schedule.at.slice(0, 16) : "";
    editError = "";
    editSuccess = "";
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
      if (selectedId === id) selectedId = null;
    } catch { /* ignore */ }
  }

  async function handleTrigger(id: string) {
    try {
      await triggerTask(id);
      runningTasks = new Set([...runningTasks, id]);
    } catch { /* ignore */ }
  }

  async function handlePauseResume(task: Task) {
    const newStatus = task.status === "paused" ? "active" : "paused";
    try {
      const updated = await updateTask(task.id, { status: newStatus } as Partial<Task>);
      tasks = tasks.map((t) => (t.id === task.id ? updated : t));
    } catch { /* ignore */ }
  }

  function handleDeleteClick(e: Event, id: string) {
    e.stopPropagation();
    if (confirmDeleteId === id) {
      doDelete(id);
    } else {
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmDeleteId = id;
      confirmTimer = setTimeout(() => {
        confirmDeleteId = null;
        confirmTimer = null;
      }, 3000);
    }
  }

  async function doDelete(id: string) {
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmDeleteId = null;
    confirmTimer = null;
    try {
      await deleteTask(id);
      tasks = tasks.filter((t) => t.id !== id);
      if (selectedId === id) selectedId = null;
    } catch { /* ignore */ }
  }

  async function handleOpenArtifacts(id: string) {
    try {
      await openTaskArtifacts(id);
    } catch { /* ignore */ }
  }

  // ── Settings (inline edit) ─────────────────────────────────────────────────

  async function handleSaveSettings() {
    if (!selectedId) return;
    if (!editName.trim() || !editPrompt.trim()) {
      editError = t("namePromptRequired");
      return;
    }
    editSaving = true;
    editError = "";
    editSuccess = "";
    try {
      const payload: Record<string, unknown> = {
        name: editName.trim(),
        description: editDesc.trim(),
        prompt: editPrompt.trim(),
        model: editModel || undefined,
        tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      if (editType === "cron") {
        payload.schedule = editSchedule.trim();
      } else {
        payload.scheduled_at = editScheduledAt ? new Date(editScheduledAt).toISOString() : undefined;
      }
      const updated = await updateTask(selectedId, payload as Partial<Task>);
      tasks = tasks.map((t) => (t.id === selectedId ? updated : t));
      editSuccess = t("savedSuccessfully");
      setTimeout(() => { editSuccess = ""; }, 2000);
    } catch (err) {
      editError = err instanceof Error ? err.message : t("failedToSave");
    } finally {
      editSaving = false;
    }
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
      formError = t("namePromptRequired");
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
      selectedId = created.id;
      activeTab = "runs";
      populateEditForm(created);
      await loadDetail(created.id);
    } catch (err) {
      formError = err instanceof Error ? err.message : t("createTask");
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

  function describeCron(cron: string): string {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return cron;
    const [min, hour, dom, mon, dow] = parts;
    const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;

    if (dom === "*" && mon === "*" && dow === "*") {
      return `Daily at ${time}`;
    }
    if (dom === "*" && mon === "*" && dow !== "*") {
      const days = dow.split(",").map((d) => dowNames[+d] ?? d).join(", ");
      return `${days} at ${time}`;
    }
    if (dom !== "*" && mon === "*" && dow === "*") {
      return `Monthly on ${dom} at ${time}`;
    }
    if (min.startsWith("*/")) {
      return `Every ${min.slice(2)} min`;
    }
    if (hour.startsWith("*/")) {
      return `Every ${hour.slice(2)} hours`;
    }
    return cron;
  }

  function scheduleLabel(task: Task): string {
    if (task.schedule?.type === "cron" && task.schedule.cron) {
      return describeCron(task.schedule.cron);
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

  function renderMarkdown(content: string): string {
    try {
      return marked(content) as string;
    } catch {
      return content;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
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
        loadTasks();
        if (selectedId === data.taskId) {
          loadDetail(data.taskId);
        }
      }
    });

    return () => { ws.close(); unsub(); };
  });
</script>

<div class="tasks-page" data-lang={lang}>
  <!-- ─── LEFT PANEL: Task List ─────────────────────────────────────────── -->
  <aside class="list-panel">
    <div class="list-header">
      <h2>{t("tasks")}</h2>
      <button class="new-btn" onclick={openCreateModal}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        {t("newTask")}
      </button>
    </div>

    <!-- Filter pills -->
    <div class="filter-pills">
      {#each filters as f}
        <button
          class="pill"
          class:active={activeFilter === f}
          onclick={() => (activeFilter = f)}
        >
          {#if f !== "all"}
            <span class="pill-dot" style="background: {statusColor(f)}"></span>
          {/if}
          {f.charAt(0).toUpperCase() + f.slice(1)}
          <span class="pill-count">
            {f === "all" ? tasks.length : tasks.filter((t) => t.status === f).length}
          </span>
        </button>
      {/each}
    </div>

    <!-- Task list -->
    <div class="task-list-scroll">
      {#if loading}
        <div class="skeleton-list">
          {#each Array(4) as _}
            <div class="skeleton-row">
              <div class="skeleton-bar w40"></div>
              <div class="skeleton-bar w70"></div>
            </div>
          {/each}
        </div>
      {:else if loadError}
        <div class="list-empty">
          <p class="empty-error">{loadError}</p>
          <button class="action-btn ghost" onclick={loadTasks}>{t("retry")}</button>
        </div>
      {:else if filteredTasks.length === 0}
        <div class="list-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/>
          </svg>
          <p>
            {#if activeFilter === "all"}
              {t("noTasksYet")}
            {:else}
              {t("noFilteredTasks").replace("{0}", activeFilter)}
            {/if}
          </p>
        </div>
      {:else}
        {#each filteredTasks as task (task.id)}
          {@const running = isRunning(task.id)}
          <button
            class="task-row"
            class:selected={selectedId === task.id}
            class:is-running={running}
            onclick={() => selectTask(task.id)}
          >
            <span
              class="status-dot"
              class:pulse={running}
              style="background: {running ? 'var(--status-running)' : statusColor(task.status)}"
            ></span>
            <div class="row-info">
              <span class="row-name">{task.name}</span>
              <span class="row-meta">
                <span class="schedule-badge">{scheduleTypeBadge(task)}</span>
                <span class="row-schedule">{scheduleLabel(task)}</span>
              </span>
            </div>
            {#if running}
              <svg class="spin row-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--status-running)" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <!-- Idea Buffer toggle at bottom -->
    <div class="idea-section">
      <button class="idea-toggle" onclick={() => (showIdeas = !showIdeas)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 4 12.7V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.3A7 7 0 0 1 12 2z"/></svg>
        {t("ideas")}
        <span class="idea-count">{ideas.length}</span>
        <svg class="idea-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform: rotate({showIdeas ? '180deg' : '0deg'})"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {#if showIdeas}
        <div class="idea-list">
          {#if ideas.length === 0}
            <p class="idea-empty">{t("noIdeasHint")}</p>
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
  </aside>

  <!-- ─── RIGHT PANEL: Workspace ────────────────────────────────────────── -->
  <main class="workspace-panel">
    {#if !selectedTask}
      <div class="workspace-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.15">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
        <p class="empty-title">{t("selectATask")}</p>
        <p class="empty-hint">{t("selectTaskHint")}</p>
      </div>
    {:else}
      {@const running = isRunning(selectedTask.id)}
      <!-- Workspace header -->
      <div class="ws-header">
        <div class="ws-header-top">
          <div class="ws-header-left">
            <span
              class="ws-status-dot"
              class:pulse={running}
              style="background: {running ? 'var(--status-running)' : statusColor(selectedTask.status)}"
            ></span>
            <div>
              <h3 class="ws-title">{selectedTask.name}</h3>
              {#if selectedTask.description}
                <p class="ws-desc">{selectedTask.description}</p>
              {/if}
            </div>
          </div>
          <div class="ws-header-actions">
            {#if selectedTask.status === "pending" && !selectedTask.approved}
              <button class="action-btn approve" onclick={(e) => handleApprove(e, selectedTask.id)}>{t("approve")}</button>
              <button class="action-btn reject" onclick={(e) => handleReject(e, selectedTask.id)}>{t("reject")}</button>
            {:else}
              <button
                class="action-btn ghost"
                disabled={running}
                onclick={() => handleTrigger(selectedTask.id)}
              >
                {#if running}
                  <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
                  {t("runningDots")}
                {:else}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {t("runNow")}
                {/if}
              </button>
              {#if selectedTask.schedule?.type === "cron"}
                <button class="action-btn ghost" onclick={() => handlePauseResume(selectedTask)}>
                  {#if selectedTask.status === "paused"}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    {t("resume")}
                  {:else}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    {t("pause")}
                  {/if}
                </button>
              {/if}
              <button
                class="action-btn ghost"
                class:danger={confirmDeleteId !== selectedTask.id}
                class:confirm-del={confirmDeleteId === selectedTask.id}
                onclick={(e) => handleDeleteClick(e, selectedTask.id)}
              >{confirmDeleteId === selectedTask.id ? t("confirmQuestion") : t("delete")}</button>
            {/if}
          </div>
        </div>

        <!-- Meta row -->
        <div class="ws-meta-row">
          <span class="ws-meta-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            {scheduleLabel(selectedTask)}
          </span>
          <span class="ws-meta-badge">{scheduleTypeBadge(selectedTask)}</span>
          <span class="ws-meta-badge status" style="--badge-color: {statusColor(selectedTask.status)}">{selectedTask.status}</span>
          {#if selectedTask.runCount > 0}
            <span class="ws-meta-item">{selectedTask.runCount} {t("runs")}</span>
          {/if}
          {#if selectedTask.lastRun}
            <span class="ws-meta-item">Last: {formatTime(selectedTask.lastRun)}</span>
          {/if}
          {#if selectedTask.tags && selectedTask.tags.length > 0}
            {#each selectedTask.tags as tag}
              <span class="ws-tag">{tag}</span>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Tab bar -->
      <div class="ws-tabs">
        <button class="ws-tab" class:active={activeTab === "runs"} onclick={() => (activeTab = "runs")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          {t("runs")}
          {#if detailRuns.length > 0}
            <span class="tab-count">{detailRuns.length}</span>
          {/if}
        </button>
        <button class="ws-tab" class:active={activeTab === "artifacts"} onclick={() => (activeTab = "artifacts")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          {t("artifacts")}
          {#if detailArtifacts.length > 0}
            <span class="tab-count">{detailArtifacts.length}</span>
          {/if}
        </button>
        <button class="ws-tab" class:active={activeTab === "settings"} onclick={() => (activeTab = "settings")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          {t("settings")}
        </button>
      </div>

      <!-- Tab content -->
      <div class="ws-content">
        {#if loadingDetail}
          <div class="ws-loading">
            <div class="skeleton-bar w60"></div>
            <div class="skeleton-bar w40"></div>
            <div class="skeleton-bar w80"></div>
          </div>

        {:else if activeTab === "runs"}
          <!-- ─── Runs tab ──────────────────────────────────────────────── -->
          {#if detailRuns.length === 0}
            <div class="tab-empty">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              <p>{t("noRunsYet")}</p>
            </div>
          {:else}
            <div class="runs-container">
              <!-- Run list -->
              <div class="run-list">
                {#each [...detailRuns].reverse() as run}
                  <button
                    class="run-row"
                    class:active={selectedRunFilename === run.filename}
                    onclick={() => selectRun(selectedTask.id, run.filename)}
                  >
                    <span class="run-date">{new Date(run.date).toLocaleString()}</span>
                    <span class="run-file">{run.filename}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="run-arrow"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                {/each}
              </div>

              <!-- Run report content -->
              {#if selectedRunFilename}
                <div class="run-report">
                  <div class="run-report-header">
                    <span class="run-report-title">{selectedRunFilename}</span>
                    <button class="action-btn ghost small" onclick={() => { selectedRunFilename = null; runContent = ""; }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div class="run-report-body">
                    {#if loadingRun}
                      <div class="ws-loading">
                        <div class="skeleton-bar w80"></div>
                        <div class="skeleton-bar w60"></div>
                        <div class="skeleton-bar w70"></div>
                      </div>
                    {:else}
                      <div class="markdown-body">
                        {@html renderMarkdown(runContent)}
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}

        {:else if activeTab === "artifacts"}
          <!-- ─── Artifacts tab ─────────────────────────────────────────── -->
          {#if detailArtifacts.length === 0}
            <div class="tab-empty">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <p>{t("noArtifactsYet")}</p>
            </div>
          {:else if selectedArtifact}
            <!-- Artifact preview mode -->
            <div class="artifact-preview">
              <div class="artifact-preview-header">
                <button class="action-btn ghost small" onclick={() => { selectedArtifact = null; artifactContent = ""; }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                  {t("back")}
                </button>
                <span class="artifact-preview-name">{selectedArtifact}</span>
                <button class="action-btn ghost small" onclick={() => handleOpenArtifacts(selectedTask.id)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  {t("finder")}
                </button>
              </div>
              {#if loadingArtifact}
                <div class="tab-empty"><p>{t("loading")}</p></div>
              {:else if isMarkdown(selectedArtifact)}
                <div class="markdown-body artifact-md">{@html renderMarkdown(artifactContent)}</div>
              {:else}
                <pre class="artifact-raw">{artifactContent}</pre>
              {/if}
            </div>
          {:else}
            <div class="artifacts-panel">
              <div class="artifacts-header">
                <span class="artifacts-count">{detailArtifacts.length} {t("file")}</span>
                <button class="action-btn ghost small" onclick={() => handleOpenArtifacts(selectedTask.id)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  {t("openInFinder")}
                </button>
              </div>
              <ul class="artifact-list">
                {#each detailArtifacts as artifact}
                  <li
                    class="artifact-item clickable"
                    role="button"
                    tabindex="0"
                    onclick={() => selectArtifact(selectedTask.id, artifact)}
                    onkeydown={(e) => { if (e.key === 'Enter') selectArtifact(selectedTask.id, artifact); }}
                  >
                    {#if isMarkdown(artifact)}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" opacity="0.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
                    {:else}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    {/if}
                    <span>{artifact}</span>
                    {#if isMarkdown(artifact)}
                      <span class="artifact-badge">MD</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

        {:else if activeTab === "settings"}
          <!-- ─── Settings tab ──────────────────────────────────────────── -->
          <div class="settings-form">
            <label class="form-field">
              <span class="field-label">{t("taskName")}</span>
              <input type="text" bind:value={editName} placeholder={t("taskName")} />
            </label>

            <label class="form-field">
              <span class="field-label">{t("description")}</span>
              <input type="text" bind:value={editDesc} placeholder={t("taskDescription")} />
            </label>

            <div class="form-field">
              <span class="field-label">{t("scheduleType")}</span>
              <div class="type-options">
                <button
                  class="type-option"
                  class:selected={editType === "cron"}
                  onclick={() => editType = "cron"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/></svg>
                  {t("recurring")}
                </button>
                <button
                  class="type-option"
                  class:selected={editType === "one-shot"}
                  onclick={() => editType = "one-shot"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {t("oneshot")}
                </button>
              </div>
            </div>

            {#if editType === "cron"}
              <label class="form-field">
                <span class="field-label">{t("scheduleCron")}</span>
                <input type="text" bind:value={editSchedule} placeholder="0 8 * * *" class="mono-input" />
                <span class="field-hint">{describeCron(editSchedule)}</span>
              </label>
            {:else}
              <label class="form-field">
                <span class="field-label">{t("scheduledAt")}</span>
                <input type="datetime-local" bind:value={editScheduledAt} />
              </label>
            {/if}

            <label class="form-field">
              <span class="field-label">{t("prompt")}</span>
              <textarea bind:value={editPrompt} rows="6" placeholder={t("whatShouldClaudeDo")}></textarea>
            </label>

            <label class="form-field">
              <span class="field-label">{t("model")}</span>
              <select bind:value={editModel}>
                <option value="">{t("defaultFromConfig")}</option>
                <option value="sonnet">Sonnet</option>
                <option value="opus">Opus</option>
                <option value="haiku">Haiku</option>
              </select>
            </label>

            <label class="form-field">
              <span class="field-label">{t("tags")}</span>
              <input type="text" bind:value={editTags} placeholder={t("tagsPlaceholder")} />
            </label>

            {#if editError}
              <p class="form-error">{editError}</p>
            {/if}
            {#if editSuccess}
              <p class="form-success">{editSuccess}</p>
            {/if}

            <div class="settings-actions">
              <button class="action-btn ghost" onclick={() => populateEditForm(selectedTask)}>{t("reset")}</button>
              <button class="action-btn primary" onclick={handleSaveSettings} disabled={editSaving}>
                {editSaving ? t("saving") : t("saveChanges")}
              </button>
            </div>

            <!-- Info row -->
            <div class="settings-info">
              <div class="info-pair">
                <span class="info-label">{t("created")}</span>
                <span class="info-value">{formatTime(selectedTask.createdAt)}</span>
              </div>
              <div class="info-pair">
                <span class="info-label">ID</span>
                <span class="info-value mono">{selectedTask.id}</span>
              </div>
              {#if selectedTask.model}
                <div class="info-pair">
                  <span class="info-label">{t("currentModel")}</span>
                  <span class="info-value">{selectedTask.model}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </main>

  <!-- ─── Create Modal ──────────────────────────────────────────────────── -->
  {#if showModal}
    <div class="modal-overlay" role="button" tabindex="-1" aria-label="Close modal" onclick={closeModal} onkeydown={(e) => { if (e.key === 'Escape') closeModal(); }}>
      <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>{t("newTask")}</h3>
          <button class="modal-close" aria-label="Close" onclick={closeModal}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="modal-body">
          <label class="form-field">
            <span class="field-label">{t("taskName")}</span>
            <input type="text" bind:value={formName} placeholder={t("taskName")} />
          </label>

          <label class="form-field">
            <span class="field-label">{t("description")}</span>
            <input type="text" bind:value={formDesc} placeholder={t("taskDescription")} />
          </label>

          <div class="form-field">
            <span class="field-label">{t("scheduleType")}</span>
            <div class="type-options">
              <button
                class="type-option"
                class:selected={formType === "cron"}
                onclick={() => formType = "cron"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 0 1 4-4h12.8"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 0 1-4 4H4.2"/></svg>
                {t("recurring")}
              </button>
              <button
                class="type-option"
                class:selected={formType === "one-shot"}
                onclick={() => formType = "one-shot"}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {t("oneshot")}
              </button>
            </div>
          </div>

          {#if formType === "cron"}
            <label class="form-field">
              <span class="field-label">{t("scheduleCron")}</span>
              <input type="text" bind:value={formSchedule} placeholder="0 8 * * *" class="mono-input" />
              <span class="field-hint">{describeCron(formSchedule)}</span>
            </label>
          {:else}
            <label class="form-field">
              <span class="field-label">{t("scheduledAt")}</span>
              <input type="datetime-local" bind:value={formScheduledAt} />
            </label>
          {/if}

          <label class="form-field">
            <span class="field-label">{t("prompt")}</span>
            <textarea bind:value={formPrompt} rows="5" placeholder={t("whatShouldClaudeDo")}></textarea>
          </label>

          <label class="form-field">
            <span class="field-label">{t("model")}</span>
            <select bind:value={formModel}>
              <option value="">{t("defaultFromConfig")}</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
          </label>

          <label class="form-field">
            <span class="field-label">{t("tags")}</span>
            <input type="text" bind:value={formTags} placeholder={t("tagsPlaceholder")} />
          </label>

          {#if formError}
            <p class="form-error">{formError}</p>
          {/if}
        </div>

        <div class="modal-footer">
          <button class="action-btn ghost" onclick={closeModal}>{t("cancel")}</button>
          <button class="action-btn primary" onclick={handleCreate} disabled={formSaving}>
            {formSaving ? t("creatingDots") : t("createTask")}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Status colors ──────────────────────────────────────────────────── */
  .tasks-page {
    --status-active: #4ade80;
    --status-running: #e5a836;
    --status-paused: #78716c;
    --status-pending: #60a5fa;
    --status-failed: #ef4444;
    --status-completed: #4ade80;

    display: flex;
    height: calc(100vh - 60px);
    gap: 0;
    overflow: hidden;
  }

  /* ── LEFT PANEL ─────────────────────────────────────────────────────── */
  .list-panel {
    width: 35%;
    min-width: 280px;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: var(--bg-surface);
    overflow: hidden;
  }

  .list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1rem 0.75rem;
    flex-shrink: 0;
  }

  .list-header h2 {
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .new-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.4rem 0.85rem;
    border-radius: 8px;
    font-weight: 550;
    font-size: 0.78rem;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
    white-space: nowrap;
  }

  .new-btn:hover {
    background: var(--accent-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .new-btn:active {
    transform: translateY(0);
  }

  /* ── Filter pills ───────────────────────────────────────────────────── */
  .filter-pills {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    padding: 0 1rem 0.75rem;
    flex-shrink: 0;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 9999px;
    padding: 0.2rem 0.6rem;
    color: var(--text-muted);
    font-size: 0.7rem;
    cursor: pointer;
    transition: all 0.15s ease;
    font-weight: 450;
  }

  .pill:hover {
    color: var(--text);
    border-color: var(--text-dim);
  }

  .pill.active {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
    font-weight: 550;
  }

  .pill-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .pill-count {
    font-size: 0.62rem;
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }

  /* ── Task list scroll ───────────────────────────────────────────────── */
  .task-list-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 0.5rem;
  }

  .task-list-scroll::-webkit-scrollbar {
    width: 4px;
  }

  .task-list-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .task-list-scroll::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }

  /* ── Task row ───────────────────────────────────────────────────────── */
  .task-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.6rem;
    margin-bottom: 1px;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: all 0.12s ease;
    position: relative;
  }

  .task-row:hover {
    background: var(--bg-hover);
  }

  .task-row.selected {
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  .task-row.is-running {
    background: rgba(229, 168, 54, 0.06);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .status-dot.pulse {
    animation: pulse-ring 1.5s ease-out infinite;
  }

  @keyframes pulse-ring {
    0% { box-shadow: 0 0 0 0 rgba(229, 168, 54, 0.5); }
    70% { box-shadow: 0 0 0 5px rgba(229, 168, 54, 0); }
    100% { box-shadow: 0 0 0 0 rgba(229, 168, 54, 0); }
  }

  .row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .row-name {
    font-size: 0.84rem;
    font-weight: 550;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.7rem;
    color: var(--text-dim);
  }

  .schedule-badge {
    display: inline-block;
    padding: 0rem 0.35rem;
    border-radius: 4px;
    font-size: 0.6rem;
    font-weight: 550;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--bg-hover);
    color: var(--text-dim);
  }

  .row-schedule {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-spinner {
    flex-shrink: 0;
  }

  /* ── Skeleton ────────────────────────────────────────────────────────── */
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .skeleton-row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
    background: var(--bg-elevated);
    border-radius: 8px;
  }

  .skeleton-bar {
    height: 10px;
    border-radius: 4px;
    background: var(--bg-hover);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .w40 { width: 40%; }
  .w60 { width: 60%; }
  .w70 { width: 70%; }
  .w80 { width: 80%; }

  @keyframes shimmer {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  /* ── List empty ─────────────────────────────────────────────────────── */
  .list-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem 1rem;
    text-align: center;
  }

  .list-empty p {
    font-size: 0.8rem;
    color: var(--text-dim);
    line-height: 1.5;
  }

  .empty-error {
    color: var(--error) !important;
    font-weight: 500;
  }

  /* ── Ideas ──────────────────────────────────────────────────────────── */
  .idea-section {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
  }

  .idea-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 550;
    padding: 0.6rem 1rem;
    transition: color 0.15s;
  }

  .idea-toggle:hover {
    color: var(--text);
  }

  .idea-count {
    font-size: 0.65rem;
    background: var(--bg-elevated);
    padding: 0.08rem 0.4rem;
    border-radius: 9999px;
    color: var(--text-dim);
    font-weight: 500;
    border: 1px solid var(--border-subtle);
    font-variant-numeric: tabular-nums;
  }

  .idea-chevron {
    color: var(--text-dim);
    margin-left: auto;
    transition: transform 0.2s ease;
  }

  .idea-list {
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0 0.75rem 0.75rem;
  }

  .idea-empty {
    font-size: 0.75rem;
    color: var(--text-dim);
    text-align: center;
    padding: 0.75rem;
    line-height: 1.5;
  }

  .idea-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
    transition: border-color 0.15s;
  }

  .idea-card:hover {
    border-color: var(--text-dim);
  }

  .idea-text {
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-bottom: 0.35rem;
    line-height: 1.45;
  }

  .idea-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .idea-reason {
    font-size: 0.68rem;
    color: var(--text-dim);
    font-style: italic;
    line-height: 1.4;
  }

  .idea-date {
    font-size: 0.65rem;
    color: var(--text-dim);
    white-space: nowrap;
  }

  /* ── RIGHT PANEL (Workspace) ────────────────────────────────────────── */
  .workspace-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
    min-width: 0;
  }

  .workspace-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    height: 100%;
    text-align: center;
    padding: 2rem;
  }

  .workspace-empty .empty-title {
    font-size: 0.95rem;
    font-weight: 550;
    color: var(--text-muted);
  }

  .workspace-empty .empty-hint {
    font-size: 0.82rem;
    color: var(--text-dim);
    max-width: 300px;
    line-height: 1.5;
  }

  /* ── Workspace header ───────────────────────────────────────────────── */
  .ws-header {
    flex-shrink: 0;
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-surface);
  }

  .ws-header-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.6rem;
  }

  .ws-header-left {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    flex: 1;
    min-width: 0;
  }

  .ws-status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 0.35rem;
  }

  .ws-status-dot.pulse {
    animation: pulse-ring 1.5s ease-out infinite;
  }

  .ws-title {
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    margin-bottom: 0.15rem;
  }

  .ws-desc {
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .ws-header-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }

  .ws-meta-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .ws-meta-item {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.74rem;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .ws-meta-item svg {
    opacity: 0.5;
  }

  .ws-meta-badge {
    display: inline-block;
    padding: 0.08rem 0.45rem;
    border-radius: 4px;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--bg-hover);
    color: var(--text-dim);
  }

  .ws-meta-badge.status {
    background: color-mix(in srgb, var(--badge-color) 15%, transparent);
    color: var(--badge-color);
  }

  .ws-tag {
    display: inline-block;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    font-size: 0.65rem;
    background: var(--bg-inset);
    color: var(--text-dim);
    border: 1px solid var(--border-subtle);
    font-weight: 500;
  }

  /* ── Tab bar ────────────────────────────────────────────────────────── */
  .ws-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
    padding: 0 1.25rem;
  }

  .ws-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.65rem 0.9rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
  }

  .ws-tab:hover {
    color: var(--text);
  }

  .ws-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .ws-tab svg {
    opacity: 0.6;
  }

  .ws-tab.active svg {
    opacity: 1;
  }

  .tab-count {
    font-size: 0.62rem;
    background: var(--bg-hover);
    color: var(--text-dim);
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .ws-tab.active .tab-count {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* ── Tab content ────────────────────────────────────────────────────── */
  .ws-content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
  }

  .ws-content::-webkit-scrollbar {
    width: 6px;
  }

  .ws-content::-webkit-scrollbar-track {
    background: transparent;
  }

  .ws-content::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
  }

  .ws-loading {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem 0;
  }

  .tab-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  .tab-empty p {
    font-size: 0.82rem;
    color: var(--text-dim);
  }

  /* ── Runs ────────────────────────────────────────────────────────────── */
  .runs-container {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .run-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .run-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 0.5rem 0.7rem;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 0.8rem;
    transition: all 0.12s ease;
  }

  .run-row:hover {
    border-color: var(--accent);
    background: var(--bg-hover);
  }

  .run-row.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .run-date {
    color: var(--text-muted);
    font-size: 0.74rem;
    min-width: 130px;
    white-space: nowrap;
  }

  .run-file {
    flex: 1;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.72rem;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-arrow {
    color: var(--text-dim);
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }

  .run-row.active .run-arrow {
    color: var(--accent);
  }

  /* ── Run report ─────────────────────────────────────────────────────── */
  .run-report {
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--bg-elevated);
    animation: slideDown 0.2s ease;
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .run-report-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-surface);
  }

  .run-report-title {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.74rem;
    color: var(--text-muted);
  }

  .run-report-body {
    padding: 1rem;
    max-height: 500px;
    overflow-y: auto;
  }

  .run-report-body::-webkit-scrollbar {
    width: 4px;
  }

  .run-report-body::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
  }

  /* ── Markdown rendering ─────────────────────────────────────────────── */
  /* ── Markdown rendering ─────────────────────────────────────────── */
  .markdown-body {
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.7;
    word-break: break-word;
  }

  /* Artifact markdown gets a scrollable container with padding */
  .markdown-body.artifact-md {
    overflow-y: auto;
    flex: 1;
    padding: 0.75rem 1rem;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
  }

  /* ── Headings ── */
  .markdown-body :global(h1) {
    font-size: 1.1em;
    font-weight: 700;
    color: var(--text);
    margin: 1.5em 0 0.6em;
    padding-bottom: 0.35em;
    border-bottom: 1px solid var(--border-subtle);
    line-height: 1.3;
    letter-spacing: -0.01em;
  }
  .markdown-body :global(h2) {
    font-size: 0.98em;
    font-weight: 650;
    color: var(--text);
    margin: 1.4em 0 0.4em;
    padding-bottom: 0.25em;
    border-bottom: 1px solid var(--border-subtle);
    line-height: 1.35;
  }
  .markdown-body :global(h3) {
    font-size: 0.9em;
    font-weight: 600;
    color: var(--text);
    margin: 1.2em 0 0.35em;
    line-height: 1.35;
  }
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 1em 0 0.3em;
    line-height: 1.4;
  }

  .markdown-body :global(h1:first-child),
  .markdown-body :global(h2:first-child),
  .markdown-body :global(h3:first-child) {
    margin-top: 0;
  }

  /* ── Text ── */
  .markdown-body :global(p) {
    margin: 0.6em 0;
  }

  .markdown-body :global(a) {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.15s;
  }
  .markdown-body :global(a:hover) {
    border-bottom-color: var(--accent);
  }

  .markdown-body :global(strong) {
    color: var(--text);
    font-weight: 600;
  }

  .markdown-body :global(em) {
    color: var(--text-secondary);
    font-style: italic;
  }

  /* ── Code ── */
  .markdown-body :global(code) {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.85em;
    background: var(--bg-inset);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    color: var(--accent);
  }

  .markdown-body :global(pre) {
    background: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 0.75em 0;
    line-height: 1.55;
  }

  .markdown-body :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  /* ── Blockquote ── */
  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding: 0.4em 0.9em;
    margin: 0.75em 0;
    color: var(--text-muted);
    background: var(--bg-inset);
    border-radius: 0 6px 6px 0;
    font-style: italic;
  }
  .markdown-body :global(blockquote p) {
    margin: 0.3em 0;
  }

  /* ── Lists ── */
  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 1.4em;
    margin: 0.5em 0;
  }

  .markdown-body :global(li) {
    margin: 0.25em 0;
    line-height: 1.6;
  }

  .markdown-body :global(li::marker) {
    color: var(--text-dim);
  }

  /* ── Dividers ── */
  .markdown-body :global(hr) {
    border: none;
    height: 1px;
    background: var(--border);
    margin: 1.25em 0;
  }

  /* ── Tables ── */
  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
    font-size: 0.8em;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--border-subtle);
    padding: 0.45em 0.7em;
    text-align: left;
  }

  .markdown-body :global(th) {
    background: var(--bg-elevated);
    font-weight: 600;
    color: var(--text);
    font-size: 0.92em;
    text-transform: none;
    letter-spacing: 0;
  }

  .markdown-body :global(tr:nth-child(even)) {
    background: var(--bg-inset);
  }

  .markdown-body :global(tr:hover) {
    background: var(--bg-hover);
  }

  /* ── Images ── */
  .markdown-body :global(img) {
    max-width: 100%;
    border-radius: 6px;
    margin: 0.5em 0;
  }

  /* ── Artifacts ──────────────────────────────────────────────────────── */
  .artifacts-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .artifacts-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .artifacts-count {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .artifact-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .artifact-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.78rem;
    color: var(--text-secondary);
    padding: 0.45rem 0.7rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    transition: border-color 0.12s;
  }

  .artifact-item:hover {
    border-color: var(--text-dim);
  }

  .artifact-item.clickable {
    cursor: pointer;
  }

  .artifact-item.clickable:hover {
    border-color: var(--accent);
    background: var(--bg-hover);
  }

  .artifact-badge {
    margin-left: auto;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    letter-spacing: 0.03em;
  }

  .artifact-preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: 100%;
  }

  .artifact-preview-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .artifact-preview-name {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text);
    flex: 1;
  }

  .artifact-raw {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text-secondary);
    background: var(--bg-inset);
    padding: 1rem;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    flex: 1;
  }

  /* ── Settings form ──────────────────────────────────────────────────── */
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-width: 580px;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field-label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .field-hint {
    font-size: 0.7rem;
    color: var(--text-dim);
    margin-top: 0.1rem;
    font-weight: 400;
  }

  .settings-form input[type="text"],
  .settings-form input[type="datetime-local"],
  .settings-form select,
  .settings-form textarea {
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    font-size: 0.85rem;
    font-family: inherit;
    resize: vertical;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .settings-form textarea {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.8rem;
    min-height: 100px;
    line-height: 1.5;
  }

  .settings-form input:focus,
  .settings-form select:focus,
  .settings-form textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .mono-input {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace !important;
  }

  .type-options {
    display: flex;
    gap: 0.5rem;
  }

  .type-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
    color: var(--text-muted);
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.15s ease;
    font-weight: 450;
  }

  .type-option:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }

  .type-option.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 550;
  }

  .settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-subtle);
    margin-top: 0.25rem;
  }

  .settings-info {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    padding: 0.75rem;
    background: var(--bg-inset);
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    margin-top: 0.25rem;
  }

  .info-pair {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .info-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.04em;
    font-weight: 600;
  }

  .info-value {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .info-value.mono {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.72rem;
  }

  .form-error {
    font-size: 0.8rem;
    color: var(--error);
    font-weight: 500;
  }

  .form-success {
    font-size: 0.8rem;
    color: var(--success);
    font-weight: 500;
  }

  /* ── Action buttons ─────────────────────────────────────────────────── */
  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.7rem;
    border-radius: 7px;
    font-size: 0.76rem;
    font-weight: 550;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .action-btn.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .action-btn.ghost:hover {
    border-color: var(--text-dim);
    color: var(--text);
    background: var(--bg-hover);
  }

  .action-btn.ghost.danger:hover {
    border-color: var(--error);
    color: var(--error);
    background: var(--error-soft);
  }

  .action-btn.confirm-del {
    background: var(--error);
    border-color: var(--error);
    color: #fff;
    animation: shake 0.3s ease-in-out;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
  }

  .action-btn.ghost.small {
    padding: 0.22rem 0.5rem;
    font-size: 0.72rem;
  }

  .action-btn.ghost:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .action-btn.approve {
    background: var(--success);
    color: #fff;
    border: none;
  }

  .action-btn.approve:hover {
    filter: brightness(0.9);
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
    box-shadow: var(--shadow-sm);
  }

  .action-btn.primary:hover {
    background: var(--accent-hover);
  }

  .action-btn.primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Modal ──────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    width: 100%;
    max-width: 520px;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
    animation: slideUp 0.2s ease;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
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
    font-weight: 600;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 6px;
    display: flex;
    transition: all 0.15s;
  }

  .modal-close:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .modal-body {
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .modal-body input[type="text"],
  .modal-body input[type="datetime-local"],
  .modal-body select,
  .modal-body textarea {
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    font-size: 0.85rem;
    font-family: inherit;
    resize: vertical;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .modal-body textarea {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.8rem;
    min-height: 80px;
    line-height: 1.5;
  }

  .modal-body input:focus,
  .modal-body select:focus,
  .modal-body textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.875rem 1.25rem;
    border-top: 1px solid var(--border);
  }

  /* ── Responsive ─────────────────────────────────────────────────────── */
  @media (max-width: 768px) {
    .tasks-page {
      flex-direction: column;
      height: auto;
    }

    .list-panel {
      width: 100%;
      max-width: none;
      max-height: 50vh;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .workspace-panel {
      min-height: 50vh;
    }
  }
</style>
