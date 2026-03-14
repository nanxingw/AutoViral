<script lang="ts">
  import { onMount } from "svelte";
  import { fetchConfig, updateConfig, triggerEvolution, fetchReports, fetchReport } from "../lib/api";
  import { marked } from "marked";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  interface FeatureDef {
    id: string;
    icon: string;
    color: string;
  }

  let { feature, onBack }: { feature: FeatureDef; onBack: () => void } = $props();

  let lang = $state(getLanguage());

  // Config state
  let interval: string = $state("1h");
  let model: string = $state("sonnet");
  let autoRun: boolean = $state(false);

  let saving: boolean = $state(false);
  let message: string = $state("");
  let messageType: "success" | "error" = $state("success");

  // Research state
  let researching: boolean = $state(false);
  let researchMessage: string = $state("");

  // Reports state
  let reports: { filename: string; date: string }[] = $state([]);
  let loadingReports: boolean = $state(true);
  let selectedReport: string | null = $state(null);
  let reportContent: string = $state("");
  let loadingContent: boolean = $state(false);

  let renderedMarkdown: string = $derived.by(() => {
    if (!reportContent) return "";
    return marked(reportContent) as string;
  });

  async function handleSave() {
    saving = true;
    message = "";
    try {
      await updateConfig({ interval, model, autoRun });
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

  async function handleStartResearch() {
    researching = true;
    researchMessage = "";
    try {
      await triggerEvolution();
      researchMessage = t("researchStarted");
      setTimeout(() => { researchMessage = ""; }, 5000);
    } catch {
      researchMessage = t("researchFailed");
    } finally {
      researching = false;
    }
  }

  async function selectReport(filename: string) {
    if (selectedReport === filename) {
      selectedReport = null;
      reportContent = "";
      return;
    }
    selectedReport = filename;
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

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  onMount(async () => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    const [, rawReports] = await Promise.all([
      fetchConfig().then((c) => {
        interval = c.interval;
        model = c.model;
        autoRun = c.autoRun;
      }).catch(() => {}),
      fetchReports().catch(() => [] as { filename: string; date: string }[]),
    ]);
    reports = (rawReports ?? [])
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 20);
    loadingReports = false;
    return () => unsub();
  });
</script>

<div class="feature-detail" data-lang={lang}>
  <!-- Back + Title -->
  <div class="detail-header">
    <button class="back-btn" onclick={onBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      <span>{t("backToHome")}</span>
    </button>
  </div>

  <div class="feature-title-row">
    <div class="feature-icon-lg" style="background: {feature.color}">
      {@html feature.icon}
    </div>
    <div class="feature-title-info">
      <h2>{t(`feature_${feature.id}_name`)}</h2>
      <p class="feature-subtitle">{t(`feature_${feature.id}_desc`)}</p>
    </div>
  </div>

  <!-- Research Config -->
  <div class="config-section">
    <div class="section-header">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      <h3>{t("researchConfig")}</h3>
    </div>

    <div class="config-cards">
      <div class="config-card">
        <label>
          <span class="field-label">{t("researchInterval")}</span>
          <span class="field-hint">{t("researchIntervalHint")}</span>
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
          <span class="field-label">{t("aiModel")}</span>
          <span class="field-hint">{t("aiModelHint")}</span>
          <select bind:value={model}>
            <option value="haiku">{t("claudeHaikuFast")}</option>
            <option value="sonnet">{t("claudeSonnetBalanced")}</option>
            <option value="opus">{t("claudeOpusCapable")}</option>
          </select>
        </label>
      </div>

      <div class="config-card">
        <div class="toggle-field">
          <div class="toggle-info">
            <span class="field-label">{t("autoResearch")}</span>
            <span class="field-hint">{t("autoResearchHint")}</span>
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
    </div>

    <!-- Actions -->
    <div class="actions-row">
      <button class="save-btn" onclick={handleSave} disabled={saving}>
        {#if saving}
          <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
          {t("saving")}
        {:else}
          {t("saveChanges")}
        {/if}
      </button>

      <button class="research-btn" onclick={handleStartResearch} disabled={researching} style="background: {feature.color}">
        {#if researching}
          <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
          {t("researchingDots")}
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          {t("startResearch")}
        {/if}
      </button>

      {#if message}
        <span class="action-message" class:error={messageType === "error"} class:success={messageType === "success"}>
          {message}
        </span>
      {/if}
      {#if researchMessage}
        <span class="action-message success">{researchMessage}</span>
      {/if}
    </div>
  </div>

  <!-- Research Reports -->
  <div class="reports-section">
    <div class="section-header">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <h3>{t("researchReports")}</h3>
      <span class="report-count">{reports.length}</span>
    </div>

    {#if loadingReports}
      <div class="reports-list">
        {#each Array(3) as _}
          <div class="report-item skeleton">
            <div class="skeleton-bar w60"></div>
            <div class="skeleton-bar w40"></div>
          </div>
        {/each}
      </div>
    {:else if reports.length === 0}
      <div class="empty-reports">
        <p>{t("noResearchReports")}</p>
      </div>
    {:else}
      <div class="reports-list">
        {#each reports as report}
          <button
            class="report-item"
            class:active={selectedReport === report.filename}
            onclick={() => selectReport(report.filename)}
          >
            <span class="report-time">{formatTime(report.date)}</span>
            <span class="report-name">{report.filename}</span>
          </button>
        {/each}
      </div>

      {#if selectedReport}
        <div class="report-viewer">
          {#if loadingContent}
            <div class="report-loading">
              {#each Array(5) as _}
                <div class="skeleton-bar" style="width: {60 + Math.random() * 35}%; margin-bottom: 0.6rem"></div>
              {/each}
            </div>
          {:else}
            <div class="markdown-body">
              {@html renderedMarkdown}
            </div>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .feature-detail {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* Back button */
  .back-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    padding: 0.4rem 0;
    transition: color 0.2s ease;
  }

  .back-btn:hover {
    color: var(--accent);
  }

  /* Feature title */
  .feature-title-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .feature-icon-lg {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    flex-shrink: 0;
    box-shadow: var(--shadow-md);
  }

  .feature-title-info h2 {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .feature-subtitle {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-top: 0.2rem;
    line-height: 1.5;
  }

  /* Section header */
  .section-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
  }

  .section-header svg {
    color: var(--accent);
  }

  .section-header h3 {
    font-size: 0.95rem;
    font-weight: 600;
  }

  /* Config section */
  .config-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .config-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  @media (max-width: 640px) {
    .config-cards {
      grid-template-columns: 1fr;
    }
  }

  .config-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: var(--shadow-sm);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field-label {
    font-size: 0.82rem;
    font-weight: 550;
    color: var(--text-secondary);
  }

  .field-hint {
    font-size: 0.72rem;
    color: var(--text-dim);
  }

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

  /* Actions row */
  .actions-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .save-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 0.6rem 1.25rem;
    border-radius: 10px;
    font-weight: 550;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s ease;
  }

  .save-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--text-dim);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .research-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #fff;
    border: none;
    padding: 0.6rem 1.5rem;
    border-radius: 10px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.88rem;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
  }

  .research-btn:hover:not(:disabled) {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
    filter: brightness(1.1);
  }

  .research-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .research-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .action-message {
    font-size: 0.82rem;
    font-weight: 500;
    animation: fadeIn 0.2s ease;
  }

  .action-message.success { color: var(--success); }
  .action-message.error { color: var(--error); }

  /* Reports */
  .reports-section {
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }

  .report-count {
    font-size: 0.72rem;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
  }

  .reports-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elevated);
  }

  .report-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1rem;
    border: none;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 0.82rem;
    transition: background 0.12s ease;
    border-left: 3px solid transparent;
    width: 100%;
  }

  .report-item:hover {
    background: var(--bg-hover);
  }

  .report-item.active {
    background: var(--accent-soft);
    border-left-color: var(--accent);
  }

  .report-item.skeleton {
    cursor: default;
    padding: 0.75rem 1rem;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }

  .report-time {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .report-name {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.72rem;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-reports {
    padding: 2rem;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.85rem;
  }

  .report-viewer {
    margin-top: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-surface);
    padding: 1.25rem;
    max-height: 500px;
    overflow-y: auto;
  }

  .report-loading {
    padding: 0.5rem;
  }

  /* Skeleton */
  .skeleton-bar {
    height: 12px;
    border-radius: 4px;
    background: var(--bg-hover);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .w40 { width: 40%; }
  .w60 { width: 60%; }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Markdown (compact version) */
  .markdown-body {
    font-size: 0.88rem;
    line-height: 1.7;
    color: var(--text);
    word-break: break-word;
  }

  :global(.report-viewer .markdown-body h1) { font-size: 1.2rem; font-weight: 700; margin: 1rem 0 0.5rem; }
  :global(.report-viewer .markdown-body h2) { font-size: 1.05rem; font-weight: 650; margin: 0.8rem 0 0.4rem; }
  :global(.report-viewer .markdown-body h3) { font-size: 0.95rem; font-weight: 600; margin: 0.6rem 0 0.3rem; }
  :global(.report-viewer .markdown-body p) { margin: 0 0 0.6rem; }
  :global(.report-viewer .markdown-body ul),
  :global(.report-viewer .markdown-body ol) { margin: 0 0 0.6rem; padding-left: 1.5rem; }
  :global(.report-viewer .markdown-body li) { margin-bottom: 0.2rem; }
  :global(.report-viewer .markdown-body code) {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.82em;
    background: var(--bg-inset);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    color: var(--accent);
  }
  :global(.report-viewer .markdown-body pre) {
    background: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 0 0 0.6rem;
    font-size: 0.8rem;
  }
  :global(.report-viewer .markdown-body pre code) {
    background: none; padding: 0; color: var(--text-secondary);
  }
  :global(.report-viewer .markdown-body blockquote) {
    margin: 0 0 0.6rem;
    padding: 0.5rem 1rem;
    border-left: 3px solid var(--accent);
    background: var(--bg-inset);
    border-radius: 0 6px 6px 0;
    color: var(--text-secondary);
  }
  :global(.report-viewer .markdown-body a) { color: var(--accent); text-decoration: none; }
  :global(.report-viewer .markdown-body a:hover) { text-decoration: underline; }
  :global(.report-viewer .markdown-body strong) { font-weight: 650; }
</style>
