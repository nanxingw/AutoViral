<script lang="ts">
  import { onMount } from "svelte";
  import { fetchConfig, updateConfig } from "../lib/api";

  let interval: string = $state("1h");
  let model: string = $state("sonnet");
  let autoRun: boolean = $state(false);
  let port: number = $state(3271);
  let saving: boolean = $state(false);
  let message: string = $state("");
  let messageType: "success" | "error" = $state("success");

  onMount(async () => {
    try {
      const c = await fetchConfig();
      interval = c.interval;
      model = c.model;
      autoRun = c.autoRun;
      port = c.port;
    } catch {
      // use defaults
    }
  });

  async function handleSave() {
    saving = true;
    message = "";
    try {
      await updateConfig({ interval, model, autoRun, port });
      message = "Settings saved.";
      messageType = "success";
    } catch {
      message = "Failed to save settings.";
      messageType = "error";
    } finally {
      saving = false;
    }
  }
</script>

<div class="settings">
  <h2>Settings</h2>

  <div class="form">
    <label>
      <span>Interval</span>
      <input type="text" bind:value={interval} placeholder="e.g. 1h, 30m" />
    </label>

    <label>
      <span>Model</span>
      <select bind:value={model}>
        <option value="sonnet">Sonnet</option>
        <option value="opus">Opus</option>
        <option value="haiku">Haiku</option>
      </select>
    </label>

    <label class="toggle-row">
      <span>Auto Run</span>
      <input type="checkbox" bind:checked={autoRun} />
    </label>

    <label>
      <span>Port</span>
      <input type="number" bind:value={port} />
    </label>

    <button class="save-btn" onclick={handleSave} disabled={saving}>
      {saving ? "Saving..." : "Save"}
    </button>

    {#if message}
      <p class="message" class:error={messageType === "error"}>{message}</p>
    {/if}
  </div>
</div>

<style>
  .settings h2 {
    font-size: 1.1rem;
    margin-bottom: 1rem;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 400px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  label span {
    font-size: 0.8rem;
    text-transform: uppercase;
    color: #888;
  }

  input[type="text"],
  input[type="number"],
  select {
    background: #16213e;
    color: #e0e0e0;
    border: 1px solid #2a2a4a;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: #4ecdc4;
  }

  .toggle-row {
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
  }

  .toggle-row input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: #4ecdc4;
  }

  .save-btn {
    align-self: flex-start;
    background: #4ecdc4;
    color: #1a1a2e;
    border: none;
    padding: 0.6rem 1.5rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.95rem;
    transition: opacity 0.15s;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .message {
    font-size: 0.85rem;
    color: #4ecdc4;
  }

  .message.error {
    color: #e74c3c;
  }
</style>
