<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let { show = false, onclose }: { show: boolean; onclose?: () => void } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  let loading = $state(false);
  let saving = $state(false);

  // Config fields
  let jimengAccessKey = $state("");
  let jimengSecretKey = $state("");
  let openrouterKey = $state("");
  let researchEnabled = $state(false);
  let researchCron = $state("0 9 * * *");
  let model = $state("sonnet");
  let douyinUrl = $state("")
  let memorySyncEnabled = $state(false)

  // Show/hide password toggles
  let showAccessKey = $state(false);
  let showSecretKey = $state(false);
  let showOpenRouter = $state(false);

  const modelOptions = [
    { value: "opus", label: "Claude Opus" },
    { value: "sonnet", label: "Claude Sonnet" },
    { value: "haiku", label: "Claude Haiku" },
  ];

  async function loadConfig() {
    loading = true;
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        jimengAccessKey = data.jimengAccessKey ?? data.accessKey ?? "";
        jimengSecretKey = data.jimengSecretKey ?? data.secretKey ?? "";
        openrouterKey = data.openrouterKey ?? data.apiKey ?? "";
        researchEnabled = data.researchEnabled ?? data.autoRun ?? false;
        researchCron = data.researchCron ?? data.interval ?? "0 9 * * *";
        model = data.model ?? "sonnet";
        douyinUrl = data.douyinUrl ?? ""
        memorySyncEnabled = data.memorySyncEnabled ?? false
      }
    } catch {
      // silently fail
    } finally {
      loading = false;
    }
  }

  async function saveConfig() {
    saving = true;
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jimengAccessKey,
          jimengSecretKey,
          openrouterKey,
          researchEnabled,
          researchCron,
          model,
          douyinUrl,
          memorySyncEnabled,
        }),
      });
    } catch {
      // ignore
    } finally {
      saving = false;
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("settings-overlay")) {
      onclose?.();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onclose?.();
    }
  }

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return unsub;
  });

  $effect(() => {
    if (show) {
      loadConfig();
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="settings-overlay" onclick={handleOverlayClick}>
    <div class="settings-panel" class:visible={show}>
      <div class="panel-header">
        <h2 class="panel-title">{tt('settingsTitle')}</h2>
        <button class="close-btn" onclick={() => onclose?.()} aria-label={tt('settingsClose')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {#if loading}
        <div class="panel-loading">
          <div class="loader-sm"></div>
          <span>{tt('settingsLoadingConfig')}</span>
        </div>
      {:else}
        <div class="panel-body">
          <!-- Jimeng API -->
          <section class="config-section">
            <h3 class="section-label">{tt('jimengApi')}</h3>
            <div class="field-group">
              <label class="field-label">
                AccessKey
                <div class="input-row">
                  <input
                    type={showAccessKey ? "text" : "password"}
                    class="field-input"
                    bind:value={jimengAccessKey}
                    placeholder={tt('enterAccessKey')}
                  />
                  <button class="toggle-vis" onclick={() => showAccessKey = !showAccessKey} aria-label={tt('toggleVisibility')}>
                    {showAccessKey ? tt('toggleHide') : tt('toggleShow')}
                  </button>
                </div>
              </label>
              <label class="field-label">
                SecretKey
                <div class="input-row">
                  <input
                    type={showSecretKey ? "text" : "password"}
                    class="field-input"
                    bind:value={jimengSecretKey}
                    placeholder={tt('enterSecretKey')}
                  />
                  <button class="toggle-vis" onclick={() => showSecretKey = !showSecretKey} aria-label={tt('toggleVisibility')}>
                    {showSecretKey ? tt('toggleHide') : tt('toggleShow')}
                  </button>
                </div>
              </label>
            </div>
          </section>

          <!-- OpenRouter API -->
          <section class="config-section">
            <h3 class="section-label">OpenRouter API</h3>
            <div class="field-group">
              <label class="field-label">
                API Key
                <div class="input-row">
                  <input
                    type={showOpenRouter ? "text" : "password"}
                    class="field-input"
                    bind:value={openrouterKey}
                    placeholder={tt('enterApiKey')}
                  />
                  <button class="toggle-vis" onclick={() => showOpenRouter = !showOpenRouter} aria-label={tt('toggleVisibility')}>
                    {showOpenRouter ? tt('toggleHide') : tt('toggleShow')}
                  </button>
                </div>
              </label>
            </div>
          </section>

          <!-- Research Settings -->
          <section class="config-section">
            <h3 class="section-label">{tt('researchSettings')}</h3>
            <div class="field-group">
              <div class="toggle-row">
                <span class="toggle-label">{tt('enableAutoResearch')}</span>
                <button
                  class="toggle-switch"
                  class:on={researchEnabled}
                  onclick={() => researchEnabled = !researchEnabled}
                  role="switch"
                  aria-checked={researchEnabled}
                  aria-label={tt('enableAutoResearch')}
                >
                  <span class="toggle-thumb"></span>
                </button>
              </div>
              {#if researchEnabled}
                <label class="field-label">
                  {tt('cronExpression')}
                  <input
                    type="text"
                    class="field-input"
                    bind:value={researchCron}
                    placeholder="0 9 * * *"
                  />
                </label>
              {/if}
            </div>
          </section>

          <!-- Model Selection -->
          <section class="config-section">
            <h3 class="section-label">{tt('modelSelection')}</h3>
            <div class="field-group">
              <label class="field-label">
                {tt('defaultModel')}
                <select class="field-select" bind:value={model}>
                  {#each modelOptions as opt}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              </label>
            </div>
          </section>

          <!-- Creator Data Collection -->
          <section class="config-section">
            <h3 class="section-label">{tt('creatorDataLabel')}</h3>
            <div class="field-group">
              <label class="field-label">
                {tt('douyinHomeUrl')}
                <input
                  type="text"
                  class="field-input"
                  bind:value={douyinUrl}
                  placeholder="https://v.douyin.com/xxx"
                />
              </label>
              <p class="field-hint">{tt('douyinUrlHint')}</p>
            </div>
          </section>

          <!-- Memory Sync -->
          <section class="config-section">
            <h3 class="section-label">{tt('aiMemory')}</h3>
            <div class="field-group">
              <div class="toggle-row">
                <div class="toggle-info">
                  <span class="toggle-label">{tt('memorySync')}</span>
                  <p class="field-hint">{tt('memorySyncDesc')}</p>
                </div>
                <button
                  class="toggle-switch"
                  class:on={memorySyncEnabled}
                  onclick={() => memorySyncEnabled = !memorySyncEnabled}
                  role="switch"
                  aria-checked={memorySyncEnabled}
                  aria-label={tt('memorySync')}
                >
                  <span class="toggle-thumb"></span>
                </button>
              </div>
              <p class="field-hint field-hint--muted">{tt('memorySyncEnvHint')}</p>
            </div>
          </section>
        </div>

        <div class="panel-footer">
          <button class="save-btn" onclick={saveConfig} disabled={saving}>
            {saving ? tt('savingSettings') : tt('saveSettings')}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    justify-content: flex-end;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .settings-panel {
    width: 400px;
    max-width: 100vw;
    height: 100%;
    background: rgba(12, 12, 20, 0.95);
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    display: flex;
    flex-direction: column;
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }

  @keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
    margin: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }

  .panel-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    flex: 1;
    font-size: 0.82rem;
    color: var(--text-dim);
  }

  .loader-sm {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(0, 0, 0, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .config-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
    margin: 0;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .field-label {
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .input-row {
    display: flex;
    gap: 0.4rem;
  }

  .field-input {
    flex: 1;
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text);
    font-size: 0.82rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .field-input:focus {
    border-color: rgba(0, 0, 0, 0.5);
  }

  .field-input::placeholder {
    color: var(--text-dim);
    opacity: 0.6;
  }

  .field-select {
    width: 100%;
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text);
    font-size: 0.82rem;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s ease;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    padding-right: 2rem;
  }

  .field-select:focus {
    border-color: rgba(0, 0, 0, 0.5);
  }

  .field-select option {
    background: #1a1a2e;
    color: var(--text);
  }

  .toggle-vis {
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: none;
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .toggle-vis:hover {
    border-color: rgba(255, 255, 255, 0.15);
    color: var(--text-secondary);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .toggle-label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .toggle-switch {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    cursor: pointer;
    transition: background 0.2s ease;
    padding: 0;
    flex-shrink: 0;
  }

  .toggle-switch.on {
    background: var(--accent);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .toggle-switch.on .toggle-thumb {
    transform: translateX(18px);
  }

  .panel-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .save-btn {
    width: 100%;
    padding: 0.65rem 1rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.85rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .save-btn:hover:not(:disabled) {
    opacity: 0.9;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .field-hint {
    font-size: 0.72rem;
    color: var(--text-dim);
    margin: 0;
    line-height: 1.5;
    opacity: 0.75;
  }

  .field-hint--muted {
    opacity: 0.5;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
  }
</style>
