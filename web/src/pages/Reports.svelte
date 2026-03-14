<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fetchReports, fetchReport, fetchConfig, updateConfig } from "../lib/api";
  import { marked } from "marked";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let lang = $state(getLanguage());

  // ── Config state (merged from Settings) ──────────────────────────────────
  let interval: string = $state("1h");
  let model: string = $state("sonnet");
  let autoRun: boolean = $state(false);
  let port: number = $state(3271);
  let taskMaxActive: number = $state(10);
  let taskMaxConcurrent: number = $state(3);
  let taskTimeoutMinutes: number = $state(10);
  let taskMaxRetries: number = $state(3);
  let taskMaxRunsPerTask: number = $state(20);

  let saving: boolean = $state(false);
  let message: string = $state("");
  let messageType: "success" | "error" = $state("success");

  // ── Reports state ────────────────────────────────────────────────────────
  type AgentType = "context" | "skill" | "task" | "evolution";

  interface ReportEntry {
    filename: string;
    date: string;
    agentType: AgentType;
    label: string;
  }

  interface DateGroup {
    label: string;
    reports: ReportEntry[];
  }

  let reports: ReportEntry[] = $state([]);
  let loading: boolean = $state(true);
  let selected: string | null = $state(null);
  let reportContent: string = $state("");
  let loadingContent: boolean = $state(false);

  let reportsSectionEl: HTMLElement | undefined = $state(undefined);

  function detectAgentType(filename: string): AgentType {
    if (filename.includes("_context_")) return "context";
    if (filename.includes("_skill_")) return "skill";
    if (filename.includes("_task_")) return "task";
    return "evolution";
  }

  const agentLabels: Record<AgentType, string> = {
    context: "Context",
    skill: "Skill",
    task: "Task",
    evolution: "Evolution",
  };

  function relativeDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function formatFullDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function dateGroupLabel(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  let groupedReports: DateGroup[] = $derived.by(() => {
    const groups = new Map<string, ReportEntry[]>();
    for (const r of reports) {
      const key = dateGroupLabel(r.date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, reports: items }));
  });

  let selectedReport: ReportEntry | undefined = $derived(
    reports.find((r) => r.filename === selected)
  );

  let renderedMarkdown: string = $derived.by(() => {
    if (!reportContent) return "";
    return marked(reportContent) as string;
  });

  // ── Config save ──────────────────────────────────────────────────────────
  async function handleSave() {
    saving = true;
    message = "";
    try {
      await updateConfig({
        interval, model, autoRun, port,
        taskMaxActive, taskMaxConcurrent, taskTimeoutMinutes,
        taskMaxRetries, taskMaxRunsPerTask,
      });
      message = t("settingsSaved");
      messageType = "success";
      setTimeout(() => { message = ""; }, 3000);
    } catch {
      message = t("settingsSaveFailed");
      messageType = "error";
    } finally {
      saving = false;
    }
  }

  // ── Report selection with auto-scroll ────────────────────────────────────
  async function selectReport(filename: string) {
    if (selected === filename) return;
    selected = filename;
    loadingContent = true;
    reportContent = "";

    // Scroll the reports section to top of viewport
    await tick();
    reportsSectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const r = await fetchReport(filename);
      reportContent = r.content;
    } catch {
      reportContent = "Failed to load report.";
    } finally {
      loadingContent = false;
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  onMount(async () => {
    const unsub = subscribe(() => { lang = getLanguage(); });

    // Load config + reports in parallel
    const [, rawReports] = await Promise.all([
      fetchConfig().then((c) => {
        interval = c.interval;
        model = c.model;
        autoRun = c.autoRun;
        port = c.port;
        taskMaxActive = (c as any).taskMaxActive ?? 10;
        taskMaxConcurrent = (c as any).taskMaxConcurrent ?? 3;
        taskTimeoutMinutes = (c as any).taskTimeoutMinutes ?? 10;
        taskMaxRetries = (c as any).taskMaxRetries ?? 3;
        taskMaxRunsPerTask = (c as any).taskMaxRunsPerTask ?? 20;
      }).catch(() => {}),
      fetchReports().catch(() => [] as { filename: string; date: string }[]),
    ]);

    reports = (rawReports ?? [])
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((r: any) => ({
        ...r,
        agentType: detectAgentType(r.filename),
        label: agentLabels[detectAgentType(r.filename)],
      }));
    loading = false;

    return () => unsub();
  });
</script>

<div class="learning-config" data-lang={lang}>
  <!-- ─── Page Header ──────────────────────────────────────────────────── -->
  <div class="page-header">
    <div>
      <h2>{t("evolutionSettings")}</h2>
      <p class="page-desc">{t("evolutionDesc")}</p>
    </div>
  </div>

  <!-- ─── Config Section ───────────────────────────────────────────────── -->
  <div class="config-section">
    <div class="settings-grid">
      <!-- Evolution Settings -->
      <div class="settings-card">
        <div class="card-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 6v6l4 2"/></svg>
          <h3>{t("evolutionSettings")}</h3>
        </div>

        <div class="field-group">
          <label>
            <span class="field-label">{t("interval")}</span>
            <span class="field-hint">{t("intervalHint")}</span>
            <select bind:value={interval}>
              <option value="15m">{t("minutes15")}</option>
              <option value="30m">{t("minutes30")}</option>
              <option value="1h">{t("hour1")}</option>
              <option value="2h">{t("hours2")}</option>
              <option value="4h">{t("hours4")}</option>
              <option value="8h">{t("hours8")}</option>
            </select>
          </label>

          <label>
            <span class="field-label">{t("model")}</span>
            <span class="field-hint">{t("modelHint")}</span>
            <select bind:value={model}>
              <option value="haiku">{t("claudeHaikuFast")}</option>
              <option value="sonnet">{t("claudeSonnetBalanced")}</option>
              <option value="opus">{t("claudeOpusCapable")}</option>
            </select>
          </label>
        </div>

        <div class="toggle-field">
          <div class="toggle-info">
            <span class="field-label">{t("autoRun")}</span>
            <span class="field-hint">{t("enableAutoRun")}</span>
          </div>
          <button
            class="toggle-switch"
            class:on={autoRun}
            onclick={() => autoRun = !autoRun}
            role="switch"
            aria-checked={autoRun}
          >
            <span class="toggle-thumb"></span>
          </button>
        </div>
      </div>

      <!-- Task Scheduling Settings -->
      <div class="settings-card">
        <div class="card-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <h3>{t("taskSettings")}</h3>
        </div>

        <div class="field-group">
          <label>
            <span class="field-label">{t("maxActiveTasks")}</span>
            <span class="field-hint">{t("maxActiveTasksHint")}</span>
            <input type="number" bind:value={taskMaxActive} min="1" max="50" />
          </label>
          <label>
            <span class="field-label">{t("taskMaxConcurrent")}</span>
            <span class="field-hint">{t("maxConcurrentHint")}</span>
            <input type="number" bind:value={taskMaxConcurrent} min="1" max="10" />
          </label>
          <label>
            <span class="field-label">{t("timeoutMinutes")}</span>
            <span class="field-hint">{t("timeoutHint")}</span>
            <input type="number" bind:value={taskTimeoutMinutes} min="1" max="60" />
          </label>
          <label>
            <span class="field-label">{t("maxRetries")}</span>
            <span class="field-hint">{t("maxRetriesHint")}</span>
            <input type="number" bind:value={taskMaxRetries} min="0" max="10" />
          </label>
          <label>
            <span class="field-label">{t("taskMaxRunsPerTask")}</span>
            <span class="field-hint">{t("maxRunsPerTaskHint")}</span>
            <input type="number" bind:value={taskMaxRunsPerTask} min="1" max="1000" />
          </label>
        </div>
      </div>

      <!-- Server Settings -->
      <div class="settings-card">
        <div class="card-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          <h3>{t("serverSettings")}</h3>
        </div>

        <div class="field-group">
          <label>
            <span class="field-label">{t("port")}</span>
            <span class="field-hint">{t("portHint")}</span>
            <input type="number" bind:value={port} />
          </label>
        </div>
      </div>
    </div>

    <!-- Save actions -->
    <div class="actions-bar">
      <button class="save-btn" onclick={handleSave} disabled={saving}>
        {#if saving}
          <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
          {t("saving")}
        {:else}
          {t("saveChanges")}
        {/if}
      </button>
      {#if message}
        <span class="save-message" class:error={messageType === "error"} class:success={messageType === "success"}>
          {#if messageType === "success"}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          {/if}
          {message}
        </span>
      {/if}
    </div>
  </div>

  <!-- ─── Reports Section ──────────────────────────────────────────────── -->
  <div class="reports-section" bind:this={reportsSectionEl}>
    <div class="reports-section-header">
      <h3>{t("reports")}</h3>
      <span class="report-count">{reports.length} {t("reports").toLowerCase()}</span>
    </div>

    {#if loading}
      <div class="split-layout">
        <div class="list-panel">
          <div class="skeleton-list">
            {#each Array(6) as _}
              <div class="skeleton-item">
                <div class="skeleton-bar w40"></div>
                <div class="skeleton-bar w70"></div>
              </div>
            {/each}
          </div>
        </div>
        <div class="detail-panel">
          <div class="empty-detail">
            <div class="skeleton-bar w60" style="margin-bottom: 0.5rem"></div>
            <div class="skeleton-bar w80"></div>
            <div class="skeleton-bar w50"></div>
          </div>
        </div>
      </div>
    {:else if reports.length === 0}
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        <p class="empty-title">{t("noReports")}</p>
        <p class="empty-desc">{lang === "zh" ? "首次演化循环完成后报告将在此显示。" : "Reports will appear here after your first evolution cycle completes."}</p>
      </div>
    {:else}
      <div class="split-layout">
        <!-- Left: Report List -->
        <div class="list-panel">
          {#each groupedReports as group}
            <div class="date-group">
              <div class="date-group-label">{group.label}</div>
              {#each group.reports as report}
                <button
                  class="report-row"
                  class:active={selected === report.filename}
                  onclick={() => selectReport(report.filename)}
                >
                  <span class="agent-badge agent-{report.agentType}">{report.label}</span>
                  <div class="row-info">
                    <span class="row-time">{formatTime(report.date)}</span>
                    <span class="row-filename">{report.filename}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/each}
        </div>

        <!-- Right: Report Detail -->
        <div class="detail-panel">
          {#if !selected}
            <div class="empty-detail">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.18">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <p class="empty-detail-title">{t("selectReportToView")}</p>
              <p class="empty-detail-desc">{lang === "zh" ? "从列表中选择报告查看内容" : "Choose a report from the list to view its content."}</p>
            </div>
          {:else if loadingContent}
            <div class="detail-loading">
              <div class="detail-header">
                <span class="agent-badge agent-{selectedReport?.agentType ?? 'evolution'}">{selectedReport?.label ?? ''}</span>
                <div class="detail-meta">
                  <span class="skeleton-bar w60" style="height: 14px; display: inline-block"></span>
                </div>
              </div>
              <div class="detail-body">
                {#each Array(8) as _}
                  <div class="skeleton-bar" style="width: {60 + Math.random() * 35}%; margin-bottom: 0.6rem"></div>
                {/each}
              </div>
            </div>
          {:else if selectedReport}
            <div class="detail-content">
              <div class="detail-header">
                <div class="detail-header-left">
                  <span class="agent-badge agent-{selectedReport.agentType}">{selectedReport.label}</span>
                  <span class="detail-date">{formatFullDate(selectedReport.date)}</span>
                </div>
                <span class="detail-filename">{selectedReport.filename}</span>
              </div>
              <div class="detail-body markdown-body">
                {@html renderedMarkdown}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .learning-config {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* ── Page Header ──────────────────────────────────────────────────────── */
  .page-header h2 {
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .page-desc {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-top: 0.2rem;
  }

  /* ── Config Section (from Settings) ───────────────────────────────────── */
  .config-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  @media (max-width: 768px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
  }

  .settings-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    color: var(--text);
  }

  .card-header svg {
    color: var(--accent);
  }

  .card-header h3 {
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field-label {
    font-size: 0.82rem;
    font-weight: 550;
    color: var(--text-secondary);
  }

  .field-hint {
    font-size: 0.72rem;
    color: var(--text-dim);
    line-height: 1.4;
  }

  input[type="number"],
  select {
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.55rem 0.75rem;
    font-size: 0.88rem;
    font-family: inherit;
    transition: border-color 0.2s ease;
    margin-top: 0.15rem;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  /* Toggle */
  .toggle-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.875rem 1rem;
    background: var(--bg-surface);
    border-radius: 10px;
    border: 1px solid var(--border-subtle);
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .toggle-switch {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: var(--text-dim);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s ease;
    flex-shrink: 0;
    padding: 0;
  }

  .toggle-switch.on {
    background: var(--accent);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }

  .toggle-switch.on .toggle-thumb {
    transform: translateX(20px);
  }

  /* Save bar */
  .actions-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .save-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.625rem 1.5rem;
    border-radius: 10px;
    font-weight: 550;
    cursor: pointer;
    font-size: 0.88rem;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
  }

  .save-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .save-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-message {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
    font-weight: 500;
    animation: fadeIn 0.2s ease;
  }

  .save-message.success {
    color: var(--success);
  }

  .save-message.error {
    color: var(--error);
  }

  /* ── Reports Section ──────────────────────────────────────────────────── */
  .reports-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    scroll-margin-top: 80px;
  }

  .reports-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .reports-section-header h3 {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .report-count {
    font-size: 0.78rem;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    white-space: nowrap;
  }

  /* ── Split Layout ───────────────────────────────────────────────────── */
  .split-layout {
    display: flex;
    gap: 0;
    max-height: 520px;
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--bg-surface);
    box-shadow: var(--shadow-sm);
  }

  .list-panel {
    width: 35%;
    min-width: 260px;
    max-width: 420px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    background: var(--bg-elevated);
    flex-shrink: 0;
  }

  .detail-panel {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    background: var(--bg-surface);
  }

  /* ── Date Groups ────────────────────────────────────────────────────── */
  .date-group {
    border-bottom: 1px solid var(--border-subtle);
  }

  .date-group:last-child {
    border-bottom: none;
  }

  .date-group-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    padding: 0.6rem 0.875rem 0.3rem;
    position: sticky;
    top: 0;
    background: var(--bg-elevated);
    z-index: 1;
  }

  /* ── Report Rows ────────────────────────────────────────────────────── */
  .report-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.875rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 0.82rem;
    transition: background 0.12s ease;
    border-left: 3px solid transparent;
  }

  .report-row:hover {
    background: var(--bg-hover);
  }

  .report-row.active {
    background: var(--accent-soft);
    border-left-color: var(--accent);
  }

  .row-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;
  }

  .row-time {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .row-filename {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.7rem;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Agent Badges ───────────────────────────────────────────────────── */
  .agent-badge {
    display: inline-flex;
    align-items: center;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    white-space: nowrap;
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }

  .agent-context {
    background: var(--agent-context-soft, var(--info-soft));
    color: var(--agent-context, var(--info));
  }

  .agent-skill {
    background: var(--agent-skill-soft, var(--success-soft));
    color: var(--agent-skill, var(--success));
  }

  .agent-task {
    background: var(--agent-task-soft, var(--error-soft));
    color: var(--agent-task, var(--error));
  }

  .agent-evolution {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* ── Detail Panel ───────────────────────────────────────────────────── */
  .empty-detail {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 300px;
    gap: 0.5rem;
    text-align: center;
    padding: 2rem;
  }

  .empty-detail-title {
    font-size: 0.95rem;
    font-weight: 550;
    color: var(--text-muted);
  }

  .empty-detail-desc {
    font-size: 0.82rem;
    color: var(--text-dim);
    max-width: 260px;
    line-height: 1.5;
  }

  .detail-loading {
    padding: 1.25rem;
  }

  .detail-content {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    background: var(--bg-surface);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .detail-header-left {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .detail-date {
    font-size: 0.82rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .detail-filename {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.72rem;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .detail-body {
    padding: 1.25rem;
    flex: 1;
    overflow-y: auto;
  }

  /* ── Empty & Loading ────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 3rem 1rem;
    text-align: center;
  }

  .empty-title {
    font-size: 0.95rem;
    font-weight: 550;
    color: var(--text-muted);
  }

  .empty-desc {
    font-size: 0.82rem;
    color: var(--text-dim);
    max-width: 300px;
    line-height: 1.5;
  }

  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
  }

  .skeleton-item {
    padding: 0.6rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .skeleton-bar {
    height: 12px;
    border-radius: 4px;
    background: var(--bg-hover);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .w40 { width: 40%; }
  .w50 { width: 50%; }
  .w60 { width: 60%; }
  .w70 { width: 70%; }
  .w80 { width: 80%; }

  @keyframes shimmer {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Markdown Styles ────────────────────────────────────────────────── */
  .markdown-body {
    font-size: 0.88rem;
    line-height: 1.7;
    color: var(--text);
    word-break: break-word;
  }

  :global(.markdown-body h1) {
    font-size: 1.4rem;
    font-weight: 700;
    margin: 1.5rem 0 0.75rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border-subtle);
    letter-spacing: -0.01em;
  }

  :global(.markdown-body h2) {
    font-size: 1.15rem;
    font-weight: 650;
    margin: 1.25rem 0 0.6rem;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--border-subtle);
    letter-spacing: -0.01em;
  }

  :global(.markdown-body h3) {
    font-size: 1rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem;
  }

  :global(.markdown-body h4),
  :global(.markdown-body h5),
  :global(.markdown-body h6) {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0.8rem 0 0.4rem;
    color: var(--text-secondary);
  }

  :global(.markdown-body p) {
    margin: 0 0 0.75rem;
  }

  :global(.markdown-body > *:first-child) {
    margin-top: 0;
  }

  :global(.markdown-body a) {
    color: var(--accent);
    text-decoration: none;
  }

  :global(.markdown-body a:hover) {
    text-decoration: underline;
  }

  :global(.markdown-body strong) {
    font-weight: 650;
  }

  :global(.markdown-body ul),
  :global(.markdown-body ol) {
    margin: 0 0 0.75rem;
    padding-left: 1.5rem;
  }

  :global(.markdown-body li) {
    margin-bottom: 0.25rem;
  }

  :global(.markdown-body li > ul),
  :global(.markdown-body li > ol) {
    margin-top: 0.25rem;
    margin-bottom: 0;
  }

  :global(.markdown-body code) {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 0.82em;
    background: var(--bg-inset);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    color: var(--accent);
  }

  :global(.markdown-body pre) {
    background: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 0.875rem 1rem;
    overflow-x: auto;
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    line-height: 1.55;
  }

  :global(.markdown-body pre code) {
    background: none;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
    color: var(--text-secondary);
  }

  :global(.markdown-body blockquote) {
    margin: 0 0 0.75rem;
    padding: 0.5rem 1rem;
    border-left: 3px solid var(--accent);
    background: var(--bg-inset);
    border-radius: 0 6px 6px 0;
    color: var(--text-secondary);
  }

  :global(.markdown-body blockquote p:last-child) {
    margin-bottom: 0;
  }

  :global(.markdown-body hr) {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 1.25rem 0;
  }

  :global(.markdown-body table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 0.75rem;
    font-size: 0.84rem;
  }

  :global(.markdown-body th) {
    text-align: left;
    font-weight: 600;
    padding: 0.5rem 0.75rem;
    border-bottom: 2px solid var(--border);
    background: var(--bg-inset);
    color: var(--text-secondary);
  }

  :global(.markdown-body td) {
    padding: 0.45rem 0.75rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  :global(.markdown-body tr:hover td) {
    background: var(--bg-hover);
  }

  :global(.markdown-body img) {
    max-width: 100%;
    border-radius: 8px;
  }

  :global(.markdown-body input[type="checkbox"]) {
    margin-right: 0.4rem;
  }
</style>
