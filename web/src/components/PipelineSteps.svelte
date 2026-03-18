<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";
  import type { PipelineStep } from "../lib/api";

  let {
    pipeline = {},
    contentType = "short-video",
    platforms = [],
    currentStep = "",
    onStepClick,
    onNextStep,
  }: {
    pipeline: Record<string, PipelineStep>;
    contentType: string;
    platforms: string[];
    currentStep: string;
    onStepClick: (stepKey: string) => void;
    onNextStep?: (stepKey: string) => void;
  } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return unsub;
  });

  // Use actual pipeline keys from data
  let stepKeys = $derived(Object.keys(pipeline));

  function statusIcon(status: string): string {
    if (status === "done") return "✓";
    if (status === "active") return "●";
    if (status === "skipped") return "✗";
    return "○";
  }

  function statusClass(status: string, key: string): string {
    const active = key === currentStep ? " step-active" : "";
    if (status === "done") return "step-done" + active;
    if (status === "active") return "step-running" + active;
    if (status === "skipped") return "step-failed" + active;
    return "step-pending" + active;
  }

  // Find the next pending step after the current one
  let nextPendingStep = $derived.by(() => {
    const idx = stepKeys.indexOf(currentStep);
    if (idx < 0) return null;
    const currentStatus = pipeline[currentStep]?.status;
    // Only show next if current step conversation is done (step still pending but turn_complete happened)
    for (let i = idx + 1; i < stepKeys.length; i++) {
      if (pipeline[stepKeys[i]]?.status === "pending") return stepKeys[i];
    }
    return null;
  });

  const typeLabels: Record<string, string> = {
    "short-video": "🎬 短视频",
    "image-text": "📷 图文",
    "long-video": "🎥 长视频",
    livestream: "📡 直播",
  };

  const platformLabels: Record<string, string> = {
    xiaohongshu: "小红书",
    douyin: "抖音",
  };
</script>

<div class="pipeline-panel">
  <div class="pipeline-header">
    <span class="pipeline-title">{tt("pipelineSteps")}</span>
  </div>

  <div class="steps-list">
    {#each stepKeys as key, i}
      {@const step = pipeline[key]}
      {@const status = step?.status ?? "pending"}
      <button
        class="step-item {statusClass(status, key)}"
        onclick={() => onStepClick(key)}
      >
        <span class="step-num">{i + 1}</span>
        <span class="step-icon">{statusIcon(status)}</span>
        <span class="step-label">{step?.name ?? key}</span>
        <span class="step-status-text">
          {#if status === "done"}
            {tt("stepCompletedLabel")}
          {:else if status === "active"}
            {tt("stepRunningLabel")}
          {:else if status === "skipped"}
            {tt("stepFailedLabel")}
          {:else}
            {tt("stepPendingLabel")}
          {/if}
        </span>
      </button>
    {/each}
  </div>

  {#if nextPendingStep && onNextStep}
    <div class="next-step-bar">
      <button class="next-step-btn" onclick={() => onNextStep!(nextPendingStep!)}>
        {pipeline[nextPendingStep]?.name ?? nextPendingStep} →
      </button>
    </div>
  {/if}

  <div class="pipeline-footer">
    <div class="footer-item">
      <span class="footer-label">{tt("selectType")}</span>
      <span class="footer-value">{typeLabels[contentType] ?? contentType}</span>
    </div>
    <div class="footer-item">
      <span class="footer-label">{tt("selectPlatforms")}</span>
      <span class="footer-value">
        {platforms.map(p => platformLabels[p] ?? p).join(", ")}
      </span>
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

  .pipeline-header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .pipeline-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .steps-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-radius: 10px;
    border: 1.5px solid transparent;
    background: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    width: 100%;
  }
  .step-item:hover { background: var(--bg-hover); }

  .step-num {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--text-dim);
    width: 1.2rem;
    text-align: center;
    flex-shrink: 0;
  }
  .step-icon { font-size: 0.75rem; flex-shrink: 0; width: 1rem; text-align: center; }
  .step-label { flex: 1; font-weight: 550; }
  .step-status-text { font-size: 0.68rem; font-weight: 500; flex-shrink: 0; }

  .step-done { border-color: rgba(52, 211, 153, 0.3); }
  .step-done .step-icon { color: var(--success); }
  .step-done .step-status-text { color: var(--success); }

  .step-running { border-color: rgba(245, 158, 11, 0.3); }
  .step-running .step-icon { color: var(--state-running); }
  .step-running .step-status-text { color: var(--state-running); }

  .step-failed { border-color: rgba(251, 113, 133, 0.3); }
  .step-failed .step-icon { color: var(--error); }
  .step-failed .step-status-text { color: var(--error); }

  .step-pending { opacity: 0.5; }
  .step-pending .step-icon { color: var(--text-dim); }
  .step-pending .step-status-text { color: var(--text-dim); }

  .step-active {
    border-color: var(--accent) !important;
    background: var(--accent-soft);
    opacity: 1;
  }

  .next-step-bar {
    padding: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .next-step-btn {
    width: 100%;
    background: var(--accent-gradient);
    color: var(--accent-text);
    border: none;
    border-radius: 10px;
    padding: 0.55rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .next-step-btn:hover { filter: brightness(1.1); }

  .pipeline-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .footer-item { display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; }
  .footer-label { color: var(--text-dim); font-weight: 500; }
  .footer-value { color: var(--text-secondary); font-weight: 600; }
</style>
