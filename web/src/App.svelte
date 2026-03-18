<script lang="ts">
  import { onMount } from "svelte";
  import Explore from "./pages/Explore.svelte";
  import Analytics from "./pages/Analytics.svelte";
  import Studio from "./pages/Studio.svelte";
  import Works from "./pages/Works.svelte";
  import NewWorkModal from "./components/NewWorkModal.svelte";
  import { fetchConfig, updateConfig, fetchWorks, createWorkApi, type WorkSummary } from "./lib/api";
  import { t, getLanguage, setLanguage, subscribe } from "./lib/i18n";

  let theme: "light" | "dark" = $state("dark");
  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  // App state
  type Tab = "explore" | "works" | "analytics";
  let activeTab: Tab = $state("works");
  let showStudio = $state(false);
  let currentWorkId: string | null = $state(null);
  let showSettings = $state(false);
  let showNewWorkModal = $state(false);

  // Config state
  let interval: string = $state("1h");
  let model: string = $state("sonnet");
  let autoRun: boolean = $state(false);
  let saving: boolean = $state(false);
  let settingsMessage: string = $state("");

  // Sidebar hover
  let sidebarExpanded = $state(false);

  function openStudio(workId: string) {
    currentWorkId = workId;
    showStudio = true;
  }

  function closeStudio() {
    showStudio = false;
    currentWorkId = null;
  }

  async function handleCreateWork(data: { title: string; type: string; platforms: string[]; topicHint: string }) {
    showNewWorkModal = false;
    try {
      const newWork = await createWorkApi({
        title: data.title || "Untitled",
        type: data.type as any,
        platforms: data.platforms,
        topicHint: data.topicHint || undefined,
      });
      currentWorkId = newWork.id;
      showStudio = true;
    } catch {
      // creation failed
    }
  }

  async function handleSaveSettings() {
    saving = true;
    settingsMessage = "";
    try {
      await updateConfig({ interval, model, autoRun });
      settingsMessage = tt("settingsSaved");
      setTimeout(() => { settingsMessage = ""; }, 3000);
    } catch {
      settingsMessage = tt("settingsSaveFailed");
    } finally {
      saving = false;
    }
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("se-theme", theme);
  }

  function toggleLanguage() {
    const next = lang === "en" ? "zh" : "en";
    setLanguage(next);
  }

  onMount(async () => {
    const current = document.documentElement.getAttribute("data-theme") as "light" | "dark" | null;
    theme = current ?? "dark";
    const unsub = subscribe(() => { lang = getLanguage(); });
    try {
      const c = await fetchConfig();
      interval = c.interval;
      model = c.model;
      autoRun = c.autoRun;
    } catch {}
    return () => {
      unsub();
    };
  });

  const navItems = [
    { tab: "explore" as Tab, icon: "search", labelKey: "explore" },
    { tab: "works" as Tab, icon: "works", labelKey: "works" },
    { tab: "analytics" as Tab, icon: "analytics", labelKey: "analytics" },
  ];
</script>

<div class="shell" data-lang={lang}>
  <!-- Sidebar -->
  <nav
    class="sidebar"
    class:expanded={sidebarExpanded}
    onmouseenter={() => sidebarExpanded = true}
    onmouseleave={() => sidebarExpanded = false}
  >
    <div class="sidebar-logo">
      <div class="logo-icon">
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
          <path d="M8 6L20 16L8 26V6Z" fill="url(#sidebar-grad)" opacity="0.9"/>
          <path d="M16 6L28 16L16 26V6Z" fill="#fff" opacity="0.45"/>
          <defs><linearGradient id="sidebar-grad" x1="8" y1="6" x2="20" y2="26"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0.6"/></linearGradient></defs>
        </svg>
      </div>
      {#if sidebarExpanded}
        <span class="logo-text">AutoViral</span>
      {/if}
    </div>

    <div class="nav-items">
      {#each navItems as item}
        <button
          class="nav-item"
          class:active={activeTab === item.tab && !showStudio}
          onclick={() => { activeTab = item.tab; showStudio = false; currentWorkId = null; }}
        >
          <span class="nav-icon">
            {#if item.icon === "search"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            {:else if item.icon === "works"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            {:else if item.icon === "analytics"}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            {/if}
          </span>
          {#if sidebarExpanded}
            <span class="nav-label">{tt(item.labelKey)}</span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="nav-bottom">
      <button
        class="nav-item"
        class:active={showSettings}
        onclick={() => { showSettings = !showSettings; }}
      >
        <span class="nav-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </span>
        {#if sidebarExpanded}
          <span class="nav-label">{tt("settings")}</span>
        {/if}
      </button>
    </div>
  </nav>

  <!-- Main Content -->
  <main class="main-content">
    {#if showStudio && currentWorkId}
      <Studio workId={currentWorkId} onBack={closeStudio} />
    {:else if activeTab === "explore"}
      <Explore />
    {:else if activeTab === "analytics"}
      <Analytics />
    {:else}
      <Works
        onOpenStudio={openStudio}
        onCreateNew={() => showNewWorkModal = true}
      />
    {/if}
  </main>

  <!-- Settings Slide-out -->
  {#if showSettings}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="settings-overlay" onclick={() => showSettings = false}></div>
    <aside class="settings-panel">
      <div class="settings-header">
        <h2>{tt("settingsTitle")}</h2>
        <button class="close-settings" onclick={() => showSettings = false}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="settings-body">
        <!-- Language -->
        <div class="setting-group">
          <label class="setting-label">{tt("languageSetting")}</label>
          <div class="lang-switcher">
            <span class="lang-opt" class:active={lang === "en"}>EN</span>
            <button class="lang-toggle" class:zh={lang === "zh"} onclick={toggleLanguage}>
              <span class="lang-thumb"></span>
            </button>
            <span class="lang-opt" class:active={lang === "zh"}>中文</span>
          </div>
        </div>

        <!-- Theme -->
        <div class="setting-group">
          <label class="setting-label">{tt("themeSetting")}</label>
          <button class="theme-btn" onclick={toggleTheme}>
            {#if theme === "dark"}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              {tt("darkTheme")}
            {:else}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              {tt("lightTheme")}
            {/if}
          </button>
        </div>

        <!-- Research Config -->
        <div class="setting-group">
          <label class="setting-label">{tt("researchConfig")}</label>
          <div class="config-fields">
            <div class="config-field">
              <span class="field-label">{tt("researchInterval")}</span>
              <select bind:value={interval}>
                <option value="15m">{tt("minutes15")}</option>
                <option value="30m">{tt("minutes30")}</option>
                <option value="1h">{tt("hour1")}</option>
                <option value="2h">{tt("hours2")}</option>
                <option value="4h">{tt("hours4")}</option>
                <option value="8h">{tt("hours8")}</option>
              </select>
            </div>
            <div class="config-field">
              <span class="field-label">{tt("aiModel")}</span>
              <select bind:value={model}>
                <option value="haiku">{tt("claudeHaikuFast")}</option>
                <option value="sonnet">{tt("claudeSonnetBalanced")}</option>
                <option value="opus">{tt("claudeOpusCapable")}</option>
              </select>
            </div>
            <div class="config-field toggle-field">
              <span class="field-label">{tt("autoResearch")}</span>
              <button class="toggle-switch" class:on={autoRun} onclick={() => autoRun = !autoRun} role="switch" aria-checked={autoRun}>
                <span class="toggle-thumb"></span>
              </button>
            </div>
          </div>
        </div>

        {#if settingsMessage}
          <p class="settings-msg">{settingsMessage}</p>
        {/if}

        <button class="save-settings-btn" onclick={handleSaveSettings} disabled={saving}>
          {#if saving}
            <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
          {/if}
          {saving ? tt("saving") : tt("saveChanges")}
        </button>
      </div>
    </aside>
  {/if}

  <NewWorkModal
    open={showNewWorkModal}
    onClose={() => showNewWorkModal = false}
    onCreate={handleCreateWork}
  />
</div>

<style>
  :global(:root),
  :global([data-theme="dark"]) {
    --bg: #08090e;
    --bg-elevated: rgba(18, 20, 30, 0.7);
    --bg-surface: rgba(22, 25, 38, 0.6);
    --bg-inset: #0c0d14;
    --bg-hover: rgba(30, 33, 48, 0.6);
    --border: rgba(255, 255, 255, 0.06);
    --border-subtle: rgba(255, 255, 255, 0.04);
    --text: #eaedf6;
    --text-secondary: #b0b5c8;
    --text-muted: #6b7194;
    --text-dim: #3d4264;
    --accent: #8678bf;
    --accent-soft: rgba(134, 120, 191, 0.1);
    --accent-hover: #7a6db3;
    --accent-text: #fff;
    --accent-gradient: linear-gradient(135deg, #8678bf, #636a9e);
    --badge-text: #fff;
    --state-running: #f59e0b;
    --state-idle: #8678bf;
    --state-default: #3d4264;
    --success: #34d399;
    --success-soft: rgba(52, 211, 153, 0.08);
    --error: #fb7185;
    --error-soft: rgba(251, 113, 133, 0.08);
    --info: #60a5fa;
    --info-soft: rgba(96, 165, 250, 0.08);
    --scrollbar: rgba(255,255,255,0.06);
    --selection: rgba(134, 120, 191, 0.25);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03);
    --shadow-md: 0 8px 24px rgba(0,0,0,0.4);
    --shadow-lg: 0 20px 60px rgba(0,0,0,0.5);
    --glow: 0 0 30px rgba(134, 120, 191, 0.08);
    --card-radius: 20px;
    --card-bg: rgba(16, 18, 28, 0.65);
    --card-border: rgba(255, 255, 255, 0.06);
    --card-blur: blur(20px);
    --transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    --transition-normal: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    --sidebar-bg: rgba(12, 13, 20, 0.85);
  }

  :global([data-theme="light"]) {
    --bg: #f4f5f9;
    --bg-elevated: rgba(255, 255, 255, 0.75);
    --bg-surface: rgba(235, 237, 245, 0.6);
    --bg-inset: #edeef4;
    --bg-hover: rgba(220, 222, 235, 0.6);
    --border: rgba(0, 0, 0, 0.07);
    --border-subtle: rgba(0, 0, 0, 0.04);
    --text: #111327;
    --text-secondary: #3b3e5c;
    --text-muted: #7274a0;
    --text-dim: #a3a5c2;
    --accent: #7568b0;
    --accent-soft: rgba(117, 104, 176, 0.07);
    --accent-hover: #685ca4;
    --accent-text: #fff;
    --accent-gradient: linear-gradient(135deg, #7568b0, #565a8a);
    --badge-text: #fff;
    --state-running: #d97706;
    --state-idle: #7568b0;
    --state-default: #a3a5c2;
    --success: #10b981;
    --success-soft: rgba(16, 185, 129, 0.06);
    --error: #ef4444;
    --error-soft: rgba(239, 68, 68, 0.05);
    --info: #3b82f6;
    --info-soft: rgba(59, 130, 246, 0.05);
    --scrollbar: rgba(0,0,0,0.08);
    --selection: rgba(117, 104, 176, 0.15);
    --shadow-sm: 0 1px 4px rgba(0,0,0,0.06);
    --shadow-md: 0 8px 24px rgba(0,0,0,0.08);
    --shadow-lg: 0 20px 60px rgba(0,0,0,0.1);
    --glow: none;
    --card-radius: 20px;
    --card-bg: rgba(255, 255, 255, 0.65);
    --card-border: rgba(0, 0, 0, 0.06);
    --card-blur: blur(20px);
    --transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    --transition-normal: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    --sidebar-bg: rgba(255, 255, 255, 0.85);
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: var(--bg);
    color: var(--text);
    font-family: "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-weight: 400;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    transition: background var(--transition-normal), color var(--transition-normal);
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  }

  :global(::selection) { background: var(--selection); }
  :global(::-webkit-scrollbar) { width: 5px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) { background: var(--scrollbar); border-radius: 3px; }
  :global(::-webkit-scrollbar-thumb:hover) { background: var(--text-dim); }
  :global(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }

  .shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Sidebar ──────────────────────────────────────────────────── */
  .sidebar {
    width: 60px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--sidebar-bg);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-right: 1px solid var(--border);
    padding: 0.75rem 0;
    transition: width var(--transition-normal);
    overflow: hidden;
    z-index: 200;
  }

  .sidebar.expanded {
    width: 200px;
  }

  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.5rem 0.85rem 1.5rem;
    white-space: nowrap;
    overflow: hidden;
  }

  .logo-icon {
    width: 36px;
    height: 36px;
    min-width: 36px;
    background: var(--accent-gradient);
    border-radius: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(134, 120, 191, 0.25);
  }

  .logo-text {
    font-size: 1.1rem;
    font-weight: 750;
    letter-spacing: -0.04em;
    color: var(--text);
    animation: fadeInLabel 0.2s ease;
  }

  .nav-items {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0 0.5rem;
  }

  .nav-bottom {
    padding: 0 0.5rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
    margin-top: 0.5rem;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.7rem;
    border-radius: 12px;
    border: none;
    background: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 550;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
    overflow: hidden;
    width: 100%;
    text-align: left;
  }

  .nav-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .nav-item.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .nav-item.active .nav-icon {
    color: var(--accent);
  }

  .nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    min-width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  .nav-label {
    animation: fadeInLabel 0.2s ease;
  }

  @keyframes fadeInLabel {
    from { opacity: 0; transform: translateX(-4px); }
    to { opacity: 1; transform: translateX(0); }
  }

  /* ── Main Content ─────────────────────────────────────────── */
  .main-content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1.5rem 2.5rem 4rem;
  }

  /* ── Settings Panel ───────────────────────────────────────── */
  .settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 500;
    animation: fadeIn 0.2s ease;
  }

  .settings-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(400px, 90vw);
    background: var(--sidebar-bg);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border-left: 1px solid var(--border);
    z-index: 600;
    display: flex;
    flex-direction: column;
    animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: var(--shadow-lg);
  }

  @keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .settings-header h2 {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .close-settings {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    padding: 0.35rem;
    cursor: pointer;
    display: flex;
    transition: all 0.15s ease;
  }

  .close-settings:hover {
    color: var(--text);
    border-color: var(--text-dim);
    background: var(--bg-hover);
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }

  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .setting-label {
    font-size: 0.78rem;
    font-weight: 650;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Lang switcher */
  .lang-switcher {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .lang-opt {
    font-size: 0.8rem;
    font-weight: 550;
    color: var(--text-dim);
    transition: color 0.2s ease;
    user-select: none;
  }

  .lang-opt.active { color: var(--text); }

  .lang-toggle {
    width: 40px;
    height: 22px;
    border-radius: 11px;
    background: var(--text-dim);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s ease;
    padding: 0;
    flex-shrink: 0;
  }

  .lang-toggle.zh { background: var(--accent-gradient); }

  .lang-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .lang-toggle.zh .lang-thumb { transform: translateX(18px); }

  /* Theme button */
  .theme-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.55rem 1rem;
    color: var(--text);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 550;
    cursor: pointer;
    transition: all 0.15s ease;
    width: fit-content;
  }

  .theme-btn:hover {
    border-color: var(--text-dim);
    background: var(--bg-hover);
  }

  /* Config fields in settings */
  .config-fields {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .config-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .config-field .field-label {
    font-size: 0.78rem;
    font-weight: 550;
    color: var(--text-muted);
  }

  .toggle-field {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0;
  }

  select {
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.55rem 2rem 0.55rem 0.8rem;
    font-size: 0.85rem;
    font-family: inherit;
    transition: border-color var(--transition-fast);
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7194' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.8rem center;
    background-size: 12px;
    cursor: pointer;
  }

  select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .toggle-switch {
    width: 40px;
    height: 22px;
    border-radius: 11px;
    background: var(--text-dim);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s ease;
    flex-shrink: 0;
    padding: 0;
  }

  .toggle-switch.on { background: var(--accent-gradient); }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle-switch.on .toggle-thumb { transform: translateX(18px); }

  .settings-msg {
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--success);
    animation: fadeIn 0.2s ease;
  }

  .save-settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    background: var(--accent-gradient);
    color: var(--accent-text);
    border: none;
    border-radius: 12px;
    padding: 0.65rem 1.5rem;
    font-size: 0.85rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition-fast);
    box-shadow: 0 4px 14px rgba(134, 120, 191, 0.25);
    width: 100%;
  }

  .save-settings-btn:hover:not(:disabled) {
    box-shadow: 0 6px 22px rgba(134, 120, 191, 0.35);
    transform: translateY(-1px);
    filter: brightness(1.1);
  }

  .save-settings-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Responsive ───────────────────────────────────────────── */
  @media (max-width: 768px) {
    .sidebar {
      width: 0;
      border-right: none;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
    }
    .sidebar.expanded {
      width: 200px;
      box-shadow: var(--shadow-lg);
    }
    .main-content {
      padding: 1rem 1rem 3rem;
    }
  }
</style>
