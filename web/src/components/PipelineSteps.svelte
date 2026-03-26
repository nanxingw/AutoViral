<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";
  import type { PipelineStep } from "../lib/api";

  let {
    pipeline = {},
    contentType = "short-video",
    platforms = [],
    currentStep = "",
    topicHint = "",
    workTitle = "",
    onNextStep,
    canAdvance = false,
  }: {
    pipeline: Record<string, PipelineStep>;
    contentType: string;
    platforms: string[];
    currentStep: string;
    topicHint?: string;
    workTitle?: string;
    onNextStep?: (stepKey: string) => void;
    canAdvance?: boolean;
  } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return unsub;
  });

  let stepKeys = $derived(Object.keys(pipeline));

  function isDone(status: string): boolean {
    return status === "done";
  }

  function statusClass(status: string, key: string): string {
    const active = key === currentStep ? " step-current" : "";
    if (status === "done") return "step-done" + active;
    if (status === "active") return "step-running" + active;
    if (status === "evaluating") return "step-evaluating" + active;
    if (status === "eval_blocked") return "step-blocked" + active;
    if (status === "skipped") return "step-failed" + active;
    return "step-pending" + active;
  }

  function elapsed(step: PipelineStep): string {
    if (!step.startedAt) return "";
    const start = new Date(step.startedAt).getTime();
    const end = step.completedAt ? new Date(step.completedAt).getTime() : Date.now();
    const sec = Math.round((end - start) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  let nextPendingStep = $derived.by(() => {
    const idx = stepKeys.indexOf(currentStep);
    if (idx < 0) return null;
    for (let i = idx + 1; i < stepKeys.length; i++) {
      if (pipeline[stepKeys[i]]?.status === "pending") return stepKeys[i];
    }
    return null;
  });

  const typeLabels: Record<string, string> = {
    "short-video": "shortVideo",
    "image-text": "imageText",
  };

  const platformLabels: Record<string, string> = {
    xiaohongshu: "xiaohongshu",
    douyin: "douyin",
  };
</script>

<div class="pipeline-panel">
  <!-- Steps timeline -->
  <div class="steps-timeline">
    <span class="section-title">{tt("pipelineSteps")}</span>
    {#if topicHint}
      <p class="topic-hint">{topicHint}</p>
    {/if}
    <div class="steps-list">
      {#each stepKeys as key, i}
        {@const step = pipeline[key]}
        {@const status = step?.status ?? "pending"}
        <div class="step-row">
          <!-- Connecting line -->
          {#if i > 0}
            <div class="connector" class:connector-done={pipeline[stepKeys[i - 1]]?.status === "done"}></div>
          {/if}
          <div class="step-item {statusClass(status, key)}">
            <span class="step-indicator" class:pulse={status === "active" || status === "evaluating"}>
              {#if isDone(status)}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {:else}
                {i + 1}
              {/if}
            </span>
            <div class="step-content">
              <span class="step-name">{step?.name ?? key}</span>
              <span class="step-status-text">
                {#if status === "done"}
                  {tt("stepCompletedLabel")}
                  {#if elapsed(step)}
                    <span class="step-time">{elapsed(step)}</span>
                  {/if}
                {:else if status === "evaluating"}
                  评审中...
                  {#if elapsed(step)}
                    <span class="step-time">{elapsed(step)}</span>
                  {/if}
                {:else if status === "eval_blocked"}
                  评审受阻
                {:else if status === "active"}
                  {tt("stepRunningLabel")}
                  {#if elapsed(step)}
                    <span class="step-time">{elapsed(step)}</span>
                  {/if}
                {:else if status === "skipped"}
                  {tt("stepFailedLabel")}
                {:else}
                  {tt("stepPendingLabel")}
                {/if}
              </span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>

</div>

<style>
  .pipeline-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-elevated);
  }

  /* Work info */
  .work-info {
    padding: 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .work-title {
    font-size: 0.92rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .work-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .meta-tag {
    font-size: 0.65rem;
    font-weight: 650;
    padding: 0.12rem 0.45rem;
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .type-tag {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: transparent;
  }

  .topic-hint {
    font-size: 0.7rem;
    color: var(--text-dim);
    line-height: 1.5;
    margin: 0.25rem 0.3rem 0.5rem;
    padding: 0;
    white-space: pre-line;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Steps timeline */
  .steps-timeline {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .section-title {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 0.3rem 0.5rem;
  }

  .steps-list {
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .step-row {
    position: relative;
  }

  .connector {
    position: absolute;
    left: 1.05rem;
    top: -0.3rem;
    width: 2px;
    height: 0.6rem;
    background: var(--border);
    z-index: 0;
  }

  .connector-done {
    background: rgba(254, 44, 85, 0.3);
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.5rem;
    border-radius: 10px;
    border: 1.5px solid transparent;
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.82rem;
    cursor: default;
    transition: all 0.15s ease;
    text-align: left;
    width: 100%;
    position: relative;
    z-index: 1;
  }

  .step-indicator {
    width: 1.5rem;
    height: 1.5rem;
    min-width: 1.5rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-display, inherit);
    font-size: 0.68rem;
    font-weight: 700;
    border: 1.5px solid var(--border);
    background: none;
    color: var(--text-dim);
    transition: all 0.2s ease;
  }

  .step-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .step-name {
    font-weight: 600;
    font-size: 0.82rem;
    line-height: 1.3;
  }

  .step-status-text {
    font-size: 0.68rem;
    font-weight: 500;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .step-time {
    font-size: 0.62rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  /* Done */
  .step-done .step-indicator {
    border-color: var(--spark-red, #FE2C55);
    color: #fff;
    background: var(--spark-red, #FE2C55);
  }
  .step-done .step-status-text { color: var(--text-muted); }

  /* Running */
  .step-running .step-indicator {
    border-color: var(--spark-red, #FE2C55);
    color: var(--spark-red, #FE2C55);
    background: none;
  }
  .step-running .step-status-text { color: var(--spark-red, #FE2C55); }

  /* Pulsing active indicator */
  .pulse {
    animation: pulse-glow 2s ease-in-out infinite;
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(254, 44, 85, 0.25); }
    50% { box-shadow: 0 0 0 5px rgba(254, 44, 85, 0); }
  }

  /* Evaluating */
  .step-evaluating .step-indicator {
    border-color: var(--amber, #f59e0b);
    color: var(--amber, #f59e0b);
    background: none;
  }
  .step-evaluating .step-status-text { color: var(--amber, #f59e0b); }

  /* Eval blocked */
  .step-blocked .step-indicator {
    border-color: #ef4444;
    color: #ef4444;
    background: none;
  }
  .step-blocked .step-status-text { color: #ef4444; }

  /* Failed */
  .step-failed .step-indicator {
    border-color: var(--text-dim);
    color: var(--text-dim);
    background: none;
  }
  .step-failed .step-status-text { color: var(--text-dim); }

  /* Pending */
  .step-pending { opacity: 0.4; }
  .step-pending .step-indicator { color: var(--text-dim); }

  /* Current / selected step */
  .step-current {
    border-color: transparent !important;
    background: var(--selected, rgba(254, 44, 85, 0.08));
    opacity: 1;
  }

  .step-current .step-indicator {
    border-color: var(--spark-red, #FE2C55);
  }

  /* Next step bar */
  .next-step-bar {
    padding: 0.6rem;
    border-top: 1px solid var(--border);
  }

  .next-step-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    font-size: var(--size-sm, 0.8rem);
    font-weight: 600;
    font-family: var(--font-body, inherit);
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .next-step-btn:hover {
    opacity: 0.8;
  }
</style>
