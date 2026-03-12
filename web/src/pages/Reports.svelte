<script lang="ts">
  import { onMount } from "svelte";
  import { fetchReports, fetchReport } from "../lib/api";
  import { marked } from "marked";

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

  onMount(async () => {
    try {
      const raw = await fetchReports();
      reports = raw
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((r) => ({
          ...r,
          agentType: detectAgentType(r.filename),
          label: agentLabels[detectAgentType(r.filename)],
        }));
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  });

  async function selectReport(filename: string) {
    if (selected === filename) return;
    selected = filename;
    loadingContent = true;
    reportContent = "";
    try {
      const r = await fetchReport(filename);
      reportContent = r.content;
    } catch {
      reportContent = "Failed to load report.";
    } finally {
      loadingContent = false;
    }
  }
</script>

<div class="reports-page">
  <div class="page-header">
    <div>
      <h2>Evolution Reports</h2>
      <p class="page-desc">History of all evolution cycle outputs and agent reports.</p>
    </div>
    <span class="report-count">{reports.length} reports</span>
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
      <p class="empty-title">No reports yet</p>
      <p class="empty-desc">Reports will appear here after your first evolution cycle completes.</p>
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
            <p class="empty-detail-title">Select a report</p>
            <p class="empty-detail-desc">Choose a report from the list to view its content.</p>
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

<style>
  .reports-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-shrink: 0;
  }

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

  .report-count {
    font-size: 0.78rem;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    white-space: nowrap;
  }

  /* ── Split Layout ──────────────────────────────────────────────────── */
  .split-layout {
    display: flex;
    gap: 0;
    flex: 1;
    min-height: 0;
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

  /* ── Date Groups ───────────────────────────────────────────────────── */
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

  /* ── Report Rows ───────────────────────────────────────────────────── */
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

  /* ── Agent Badges ──────────────────────────────────────────────────── */
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
    background: var(--agent-context-soft);
    color: var(--agent-context);
  }

  .agent-skill {
    background: var(--agent-skill-soft);
    color: var(--agent-skill);
  }

  .agent-task {
    background: var(--agent-task-soft);
    color: var(--agent-task);
  }

  .agent-evolution {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* ── Detail Panel ──────────────────────────────────────────────────── */
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

  /* ── Empty & Loading ───────────────────────────────────────────────── */
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

  /* ── Markdown Styles ───────────────────────────────────────────────── */
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
