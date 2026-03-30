<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import MarkdownBlock from "./MarkdownBlock.svelte";

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return unsub;
  });

  interface ProgressLine {
    type: "search" | "result" | "analyzing" | "done" | "error" | "text";
    text: string;
  }

  let {
    active,
    lines,
    phase,
    streamText = "",
    reportText = "",
    onCancel,
  }: {
    active: boolean;
    lines: ProgressLine[];
    phase: "idle" | "searching" | "analyzing" | "done" | "error";
    streamText?: string;
    reportText?: string;
    onCancel: () => void;
  } = $props();

  let showReport = $state(false);

  function lineIcon(type: string): string {
    if (type === "done" || type === "result") return "\u2713";
    if (type === "error") return "\u2715";
    if (type === "text") return "\u25CB";
    return "\u2192";
  }

  function lineClass(type: string): string {
    if (type === "done" || type === "result") return "line-done";
    if (type === "error") return "line-error";
    if (type === "text") return "line-text-stream";
    return "line-active";
  }
</script>

<div class="research-progress" class:expanded={active || phase === "error" || showReport}>
  <div class="progress-inner">
    {#if active || phase === "error"}
      <div class="progress-card">
        <div class="progress-header">
          <div class="header-left">
            {#if phase === "error"}
              <span class="status-dot dot-error"></span>
              <span class="header-text">{tt("researchFailed")}</span>
            {:else if phase === "done"}
              <span class="status-dot dot-done"></span>
              <span class="header-text">{tt("researchDone")}</span>
            {:else if phase === "analyzing"}
              <span class="status-dot dot-pulse"></span>
              <span class="header-text">{tt("analyzingTrends")}</span>
            {:else}
              <span class="status-dot dot-pulse"></span>
              <span class="header-text">{tt("collectingData")}</span>
            {/if}
          </div>
          {#if phase === "error"}
            <button class="action-pill" onclick={onCancel}>{tt("retry")}</button>
          {:else if active}
            <button class="action-pill cancel" onclick={onCancel}>{tt("cancel")}</button>
          {/if}
        </div>

        <!-- Search activity lines -->
        {#if lines.length > 0}
          <div class="activity-lines">
            {#each lines as line, i (i)}
              <div class="activity-line {lineClass(line.type)}" style="animation-delay: {i * 0.04}s">
                <span class="line-icon">{lineIcon(line.type)}</span>
                <span class="line-text">{line.text}</span>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Streaming agent output -->
        {#if streamText}
          <div class="stream-area">
            <div class="stream-label">
              <span class="status-dot dot-pulse small"></span>
              {tt("aiAnalysisOutput")}
            </div>
            <div class="stream-content">
              <pre class="stream-text">{streamText}</pre>
            </div>
          </div>
        {/if}

        <!-- Progress bar -->
        <div class="progress-track">
          <div
            class="progress-fill"
            class:indeterminate={phase === "searching"}
            class:almost={phase === "analyzing"}
            class:full={phase === "done"}
          ></div>
        </div>
      </div>
    {/if}

    <!-- Report toggle after completion -->
    {#if reportText && !active}
      <div class="report-section">
        <button class="report-toggle" onclick={() => showReport = !showReport}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          {showReport ? tt("collapseReport") : tt("viewFullReport")}
          <svg class="chevron" class:open={showReport} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {#if showReport}
          <div class="report-content">
            <MarkdownBlock text={reportText} />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .research-progress {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 350ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .research-progress.expanded {
    grid-template-rows: 1fr;
  }

  .progress-inner {
    overflow: hidden;
    min-height: 0;
  }

  /* ── Progress card ───────────────────────────────────── */
  .progress-card {
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 12px;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-text {
    font-size: 0.85rem;
    font-weight: 650;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.small {
    width: 6px;
    height: 6px;
  }

  .dot-pulse {
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .dot-done { background: #34d399; }
  .dot-error { background: var(--error, #fb7185); }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .action-pill {
    padding: 0.3rem 0.8rem;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.3);
    background: rgba(0, 0, 0, 0.1);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .action-pill:hover {
    background: rgba(0, 0, 0, 0.2);
  }

  .action-pill.cancel {
    border-color: var(--border);
    background: none;
    color: var(--text-dim);
  }

  .action-pill.cancel:hover {
    border-color: var(--error, #fb7185);
    color: var(--error, #fb7185);
  }

  /* ── Activity lines ──────────────────────────────────── */
  .activity-lines {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-height: 200px;
    overflow-y: auto;
  }

  .activity-line {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.78rem;
    font-weight: 500;
    animation: lineIn 180ms ease both;
  }

  .line-done { color: var(--text-dim); }
  .line-active { color: var(--text); }
  .line-error { color: var(--error, #fb7185); }
  .line-text-stream { color: var(--text-muted); }

  .line-icon {
    font-size: 0.65rem;
    width: 1em;
    text-align: center;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .line-text {
    line-height: 1.4;
  }

  @keyframes lineIn {
    from { opacity: 0; transform: translateY(3px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Stream area ─────────────────────────────────────── */
  .stream-area {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .stream-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    font-weight: 650;
    color: var(--text-dim);
    letter-spacing: 0.02em;
  }

  .stream-content {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    padding: 0.75rem;
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  .stream-text {
    font-size: 0.76rem;
    line-height: 1.55;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    font-family: inherit;
  }

  /* ── Progress bar ────────────────────────────────────── */
  .progress-track {
    height: 3px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    width: 0%;
    transition: width 500ms ease;
  }

  .progress-fill.indeterminate {
    width: 100%;
    animation: shimmer 1.8s ease-in-out infinite;
    background: linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%);
    background-size: 200% 100%;
  }

  .progress-fill.almost { width: 90%; }
  .progress-fill.full { width: 100%; }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  /* ── Report section ──────────────────────────────────── */
  .report-section {
    margin-top: 0.5rem;
  }

  .report-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.65rem 1rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.02);
    color: var(--text-secondary);
    font-size: 0.82rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
  }

  .report-toggle:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(0, 0, 0, 0.06);
  }

  .chevron {
    margin-left: auto;
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .report-content {
    margin-top: 0.75rem;
    padding: 1.25rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
    animation: lineIn 250ms ease;
  }
</style>
