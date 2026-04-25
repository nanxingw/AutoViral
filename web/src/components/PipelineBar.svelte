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
  <div class="pipeline-track">
    {#each stepKeys as key, i}
      {@const step = pipeline[key]}
      {@const status = step?.status ?? "pending"}
      {@const isCurrent = key === currentStep}
      <div
        class="step"
        class:step-done={status === "done"}
        class:step-active={status === "active"}
        class:step-evaluating={status === "evaluating"}
        class:step-blocked={status === "eval_blocked"}
        class:step-pending={status === "pending"}
        class:step-skipped={status === "skipped"}
        class:step-current={isCurrent}
        class:step-clickable={isClickable(status, key)}
        role="button"
        tabindex="0"
        aria-label="{step?.name ?? key}: {status}"
        aria-disabled={!isClickable(status, key)}
        onclick={() => handleClick(key)}
        onkeydown={(e) => { if ((e.key === "Enter" || e.key === " ") && isClickable(status, key)) { e.preventDefault(); handleClick(key); } }}
      >
        <span class="step-dot">
          {#if status === "done"}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {:else if status === "active" || status === "evaluating"}
            <span class="dot-inner" class:pulse={true}></span>
          {:else if status === "eval_blocked"}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
          {:else}
            <span class="dot-inner dot-empty"></span>
          {/if}
        </span>
        <span class="step-name">{step?.name ?? key}</span>
      </div>
      {#if i < stepKeys.length - 1}
        <div class="connector" class:connector-done={status === "done"}></div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .pipeline-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 1.5rem;
    background: var(--bg-elevated);
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
  }

  .pipeline-track {
    display: flex;
    align-items: center;
    gap: 0;
  }

  /* Connector line */
  .connector {
    width: 32px;
    height: 2px;
    background: var(--border);
    flex-shrink: 0;
    transition: background 0.3s ease;
  }
  .connector-done {
    background: var(--success, #22c55e);
  }

  /* Step */
  .step {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px 5px 8px;
    border-radius: var(--radius-pill);
    background: transparent;
    border: none;
    cursor: default;
    user-select: none;
    transition: all 0.2s ease;
    white-space: nowrap;
    position: relative;
  }

  .step-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.01em;
    transition: color 0.2s ease;
  }

  /* Dot indicator */
  .step-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 2px solid var(--border);
    background: var(--bg-elevated);
    transition: all 0.2s ease;
    color: var(--text-dim);
  }

  .dot-inner {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .dot-empty {
    background: var(--border);
  }

  /* Done */
  .step-done .step-dot {
    background: var(--success, #22c55e);
    border-color: var(--success, #22c55e);
    color: #fff;
  }
  .step-done .step-name {
    color: var(--text-muted);
  }

  /* Active */
  .step-active .step-dot {
    border-color: var(--spark-red, #FE2C55);
    color: var(--spark-red, #FE2C55);
  }
  .step-active .step-name {
    color: var(--text);
    font-weight: 700;
  }

  /* Evaluating */
  .step-evaluating .step-dot {
    border-color: var(--state-running, #f59e0b);
    color: var(--state-running, #f59e0b);
  }
  .step-evaluating .step-name {
    color: var(--state-running, #f59e0b);
  }

  /* Blocked */
  .step-blocked .step-dot {
    border-color: var(--error, #ef4444);
    color: var(--error, #ef4444);
  }
  .step-blocked .step-name {
    color: var(--error, #ef4444);
  }

  /* Pending */
  .step-pending {
    opacity: 0.45;
  }

  /* Skipped */
  .step-skipped {
    opacity: 0.35;
  }

  /* Current */
  .step-current {
    background: color-mix(in srgb, var(--text) 4%, transparent);
    opacity: 1;
  }

  /* Clickable */
  .step-clickable {
    cursor: pointer;
  }
  .step-clickable:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
    opacity: 1;
  }
  .step-clickable:hover .step-name {
    color: var(--text);
  }

  /* Pulse animation for active dot */
  .pulse {
    animation: pulse-scale 2s ease-in-out infinite;
  }
  @keyframes pulse-scale {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.4); opacity: 0.6; }
  }

  /* Responsive */
  @media (max-width: 600px) {
    .step-name { display: none; }
    .step { padding: 5px 6px; }
    .connector { width: 20px; }
  }
</style>
