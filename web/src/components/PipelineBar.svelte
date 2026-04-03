<script lang="ts">
  import type { PipelineStep } from "../lib/api";

  let {
    pipeline = {},
    currentStep = "",
    streaming = false,
    canAdvance = false,
    onSelectStep,
  }: {
    pipeline: Record<string, PipelineStep>;
    currentStep: string;
    streaming?: boolean;
    canAdvance?: boolean;
    onSelectStep?: (stepKey: string) => void;
  } = $props();

  let stepKeys = $derived(Object.keys(pipeline));

  function statusIcon(status: string): string {
    if (status === "done") return "\u2713";
    if (status === "active") return "\u25cf";
    if (status === "evaluating") return "\u25ce";
    if (status === "eval_blocked") return "\u26a0";
    if (status === "skipped") return "\u2014";
    return "\u25cb";
  }

  function isClickable(status: string, key: string): boolean {
    if (status === "done" || status === "skipped") return true;
    if (status === "pending" && canAdvance && !streaming) return true;
    return false;
  }

  function handleClick(key: string) {
    const status = pipeline[key]?.status ?? "pending";
    if (isClickable(status, key) && onSelectStep) {
      onSelectStep(key);
    }
  }
</script>

<div class="pipeline-bar">
  {#each stepKeys as key, i}
    {@const step = pipeline[key]}
    {@const status = step?.status ?? "pending"}
    {#if i > 0}
      <div class="connector" class:connector-done={pipeline[stepKeys[i - 1]]?.status === "done"}></div>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="step"
      class:step-done={status === "done"}
      class:step-active={status === "active"}
      class:step-evaluating={status === "evaluating"}
      class:step-blocked={status === "eval_blocked"}
      class:step-pending={status === "pending"}
      class:step-skipped={status === "skipped"}
      class:step-current={key === currentStep}
      class:step-clickable={isClickable(status, key)}
      onclick={() => handleClick(key)}
    >
      <span class="step-num">{i + 1}</span>
      <span class="step-name">{step?.name ?? key}</span>
      <span class="step-icon" class:pulse={status === "active" || status === "evaluating"}>{statusIcon(status)}</span>
    </div>
  {/each}
</div>

<style>
  .pipeline-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    padding: 0 1rem;
    gap: 0;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated);
    flex-shrink: 0;
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
  }

  .connector {
    width: 28px;
    height: 2px;
    background: var(--border);
    flex-shrink: 0;
    position: relative;
  }
  .connector::after {
    content: "\2192";
    position: absolute;
    right: -6px;
    top: -8px;
    font-size: 12px;
    color: var(--border);
    line-height: 1;
  }
  .connector-done {
    background: var(--state-done, #22c55e);
  }
  .connector-done::after {
    color: var(--state-done, #22c55e);
  }

  .step {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: none;
    cursor: default;
    user-select: none;
    transition: all 0.15s ease;
    white-space: nowrap;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-dim);
  }

  .step-num {
    font-size: 0.68rem;
    font-weight: 700;
    opacity: 0.5;
    font-variant-numeric: tabular-nums;
  }

  .step-name {
    font-weight: 600;
    font-size: 0.78rem;
  }

  .step-icon {
    font-size: 0.82rem;
    line-height: 1;
  }

  /* Done */
  .step-done {
    color: var(--state-done, #22c55e);
    border-color: var(--state-done, #22c55e);
  }
  .step-done .step-num { opacity: 0.7; }

  /* Active */
  .step-active {
    color: var(--spark-red, #FE2C55);
    border-color: var(--spark-red, #FE2C55);
  }

  /* Evaluating */
  .step-evaluating {
    color: var(--amber, #f59e0b);
    border-color: var(--amber, #f59e0b);
  }

  /* Eval blocked */
  .step-blocked {
    color: var(--spark-red, #ef4444);
    border-color: var(--spark-red, #ef4444);
  }

  /* Pending */
  .step-pending {
    opacity: 0.4;
  }

  /* Skipped */
  .step-skipped {
    opacity: 0.4;
    color: var(--text-dim);
  }

  /* Current highlight */
  .step-current {
    background: var(--selected, rgba(254, 44, 85, 0.08));
    opacity: 1;
  }

  /* Clickable */
  .step-clickable {
    cursor: pointer;
  }
  .step-clickable:hover {
    background: var(--bg-hover, rgba(148, 163, 184, 0.08));
    opacity: 1;
  }

  /* Pulse animation */
  .pulse {
    animation: pulse-glow 2s ease-in-out infinite;
  }
  @keyframes pulse-glow {
    0%, 100% { text-shadow: 0 0 0 transparent; }
    50% { text-shadow: 0 0 8px currentColor; }
  }

  /* Responsive: hide step names on very small screens */
  @media (max-width: 600px) {
    .step-name { display: none; }
    .connector { width: 16px; }
  }
</style>
