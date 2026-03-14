<script lang="ts">
  import { onMount } from "svelte";
  import { fetchConfig, updateConfig } from "../lib/api";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let lang = $state(getLanguage());

  let interval: string = $state("1h");
  let model: string = $state("sonnet");
  let autoRun: boolean = $state(false);
  let port: number = $state(3271);
  // Task scheduling
  let taskMaxActive: number = $state(10);
  let taskMaxConcurrent: number = $state(3);
  let taskTimeoutMinutes: number = $state(10);
  let taskMaxRetries: number = $state(3);
  let taskMaxRunsPerTask: number = $state(20);

  let saving: boolean = $state(false);
  let message: string = $state("");
  let messageType: "success" | "error" = $state("success");

  onMount(async () => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    try {
      const c = await fetchConfig();
      interval = c.interval;
      model = c.model;
      autoRun = c.autoRun;
      port = c.port;
      taskMaxActive = (c as any).taskMaxActive ?? 10;
      taskMaxConcurrent = (c as any).taskMaxConcurrent ?? 3;
      taskTimeoutMinutes = (c as any).taskTimeoutMinutes ?? 10;
      taskMaxRetries = (c as any).taskMaxRetries ?? 3;
      taskMaxRunsPerTask = (c as any).taskMaxRunsPerTask ?? 20;
    } catch {
      // use defaults
    }
    return () => unsub();
  });

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
</script>

<div class="settings" data-lang={lang}>
  <div class="page-header">
    <div>
      <h2>{t("settings")}</h2>
      <p class="page-desc">{t("settingsDesc")}</p>
    </div>
  </div>

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

  <!-- Actions -->
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

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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

  /* ── Settings Grid ───────────────────────────────────────────────────── */
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

  /* ── Fields ──────────────────────────────────────────────────────────── */
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

  input[type="text"],
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

  /* ── Toggle Switch ───────────────────────────────────────────────────── */
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

  /* ── Actions ─────────────────────────────────────────────────────────── */
  .actions-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-top: 0.5rem;
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

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
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

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
