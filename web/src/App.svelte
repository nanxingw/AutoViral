<script lang="ts">
  import { onMount } from "svelte";
  import FeatureDetail from "./pages/FeatureDetail.svelte";
  import Explore from "./pages/Explore.svelte";
  import Analytics from "./pages/Analytics.svelte";
  import { fetchConfig, updateConfig, triggerEvolution } from "./lib/api";
  import { t, getLanguage, setLanguage, subscribe } from "./lib/i18n";

  let theme: "light" | "dark" = $state("dark");
  let lang = $state(getLanguage());

  // Config state
  let interval: string = $state("1h");
  let model: string = $state("sonnet");
  let autoRun: boolean = $state(false);
  let saving: boolean = $state(false);
  let message: string = $state("");
  let messageType: "success" | "error" = $state("success");
  let researching: boolean = $state(false);
  let researchMessage: string = $state("");

  // Tab state
  type Tab = "works" | "explore" | "analytics";
  let activeTab: Tab = $state("works");

  // View state: null = gallery, "new" = new work pipeline, string = existing work
  let activeView: string | null = $state(null);

  // Flag to scroll to insights on analytics page
  let scrollToInsightsFlag = $state(false);

  function goToInsights() {
    scrollToInsightsFlag = true;
    activeTab = "analytics";
    activeView = null;
    // Reset flag after navigation
    setTimeout(() => { scrollToInsightsFlag = false; }, 500);
  }

  // Mock works data
  interface Work {
    id: string;
    title: string;
    cover: string; // gradient color as cover
    date: string;
    status: "complete" | "draft";
  }

  const mockWorks: Work[] = [
    { id: "w1", title: "3 Tips to 10x Your Reach", cover: "https://i.ytimg.com/vi/lHGgMOT1gGM/hq720.jpg", date: "Mar 12", status: "complete" },
    { id: "w2", title: "Why Nobody Watches Your Videos", cover: "https://i.ytimg.com/vi/QfFOm4rMER0/hq720.jpg", date: "Mar 10", status: "complete" },
    { id: "w3", title: "Hook Formula That Works", cover: "https://i.ytimg.com/vi/krsBRQlAFbY/hq720.jpg", date: "Mar 8", status: "complete" },
    { id: "w4", title: "Competitor Blind Spots", cover: "https://i.ytimg.com/vi/JpLFn2_2V8M/hq720.jpg", date: "Mar 5", status: "draft" },
    { id: "w5", title: "Weekend Posting Strategy", cover: "https://i.ytimg.com/vi/OM3Z_Cc7wJY/hq720.jpg", date: "Mar 3", status: "complete" },
  ];

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
    return () => unsub();
  });
</script>

<div class="shell" data-lang={lang}>
  <header>
    <div class="brand">
      <div class="logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      </div>
      <h1>CreatorPilot</h1>
    </div>
    <nav class="tab-bar">
      <button class="tab-btn" class:active={activeTab === "works"} onclick={() => { activeTab = "works"; activeView = null; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        {t("tabWorks")}
      </button>
      <button class="tab-btn" class:active={activeTab === "explore"} onclick={() => { activeTab = "explore"; activeView = null; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
        {t("tabExplore")}
      </button>
      <button class="tab-btn" class:active={activeTab === "analytics"} onclick={() => { activeTab = "analytics"; activeView = null; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        {t("tabAnalytics")}
      </button>
    </nav>
    <div class="header-actions">
      <div class="lang-switcher">
        <span class="lang-label" class:active={lang === "en"}>EN</span>
        <button class="lang-toggle" class:zh={lang === "zh"} onclick={toggleLanguage} title="Switch language">
          <span class="lang-thumb"></span>
        </button>
        <span class="lang-label" class:active={lang === "zh"}>中文</span>
      </div>
      <button class="theme-toggle" onclick={toggleTheme} title="Toggle theme">
        {#if theme === "dark"}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        {/if}
      </button>
    </div>
  </header>

  <main>
    {#if activeTab === "explore"}
      <Explore />
    {:else if activeTab === "analytics"}
      <Analytics scrollToInsights={scrollToInsightsFlag} />
    {:else if activeView !== null}
      <FeatureDetail workId={activeView} onBack={() => activeView = null} />
    {:else}
      <!-- Greeting Section -->
      <div class="greeting">
        <p class="greeting-line1">{t("greetingLine1")}</p>
        <p class="greeting-line2">{t("greetingLine2a").replace("{count}", "47")}<span class="greeting-link" role="button" tabindex="0" onclick={goToInsights} onkeydown={(e) => e.key === "Enter" && goToInsights()}>{t("greetingLine2b").replace("{insights}", "3")}</span>{t("greetingLine2c")}</p>
      </div>

      <!-- Research Config Area -->
      <div class="config-area">
        <div class="config-area-header">
          <div class="config-area-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <h3>{t("researchConfig")}</h3>
          </div>
          <div class="config-area-actions">
            {#if message}
              <span class="action-msg" class:error={messageType === "error"} class:success={messageType === "success"}>{message}</span>
            {/if}
            {#if researchMessage}
              <span class="action-msg success">{researchMessage}</span>
            {/if}
            <button class="save-btn" onclick={handleSave} disabled={saving}>
              {#if saving}
                <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
                {t("saving")}
              {:else}
                {t("saveChanges")}
              {/if}
            </button>
            <button class="research-btn" onclick={handleStartResearch} disabled={researching}>
              {#if researching}
                <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
                {t("researchingDots")}
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                {t("startResearch")}
              {/if}
            </button>
          </div>
        </div>

        <div class="config-fields-inline">
          <label class="config-field-inline">
            <span class="field-label">{t("researchInterval")}</span>
            <select bind:value={interval}>
              <option value="15m">{t("minutes15")}</option>
              <option value="30m">{t("minutes30")}</option>
              <option value="1h">{t("hour1")}</option>
              <option value="2h">{t("hours2")}</option>
              <option value="4h">{t("hours4")}</option>
              <option value="8h">{t("hours8")}</option>
            </select>
          </label>
          <label class="config-field-inline">
            <span class="field-label">{t("aiModel")}</span>
            <select bind:value={model}>
              <option value="haiku">{t("claudeHaikuFast")}</option>
              <option value="sonnet">{t("claudeSonnetBalanced")}</option>
              <option value="opus">{t("claudeOpusCapable")}</option>
            </select>
          </label>
          <div class="config-toggle-inline">
            <span class="field-label">{t("autoResearch")}</span>
            <button class="toggle-switch" class:on={autoRun} onclick={() => autoRun = !autoRun} role="switch" aria-checked={autoRun}>
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Works Gallery -->
      <div class="gallery-section">
        <h3 class="gallery-title">{t("myWorks")}</h3>
        <div class="gallery-grid">
          <!-- New Work Card -->
          <button class="gallery-card new-card" onclick={() => activeView = "new"}>
            <div class="new-card-inner">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>{t("newWork")}</span>
            </div>
          </button>

          <!-- Existing Works -->
          {#each mockWorks as work}
            <button class="gallery-card" onclick={() => activeView = work.id}>
              <div class="card-cover">
                <img src={work.cover} alt={work.title} loading="lazy" />
                {#if work.status === "draft"}
                  <span class="draft-badge">Draft</span>
                {/if}
              </div>
              <div class="card-info">
                <span class="card-title">{work.title}</span>
                <span class="card-date">{work.date}</span>
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  :global(:root),
  :global([data-theme="dark"]) {
    --bg: #121110;
    --bg-elevated: #1a1816;
    --bg-surface: #201e1b;
    --bg-inset: #161412;
    --bg-hover: #2a2725;
    --border: #2e2a27;
    --border-subtle: #252220;
    --text: #ede9e5;
    --text-secondary: #c8c3bd;
    --text-muted: #8c857e;
    --text-dim: #5c5650;
    --accent: #d4845a;
    --accent-soft: rgba(212, 132, 90, 0.12);
    --accent-hover: #c67848;
    --accent-text: #fff;
    --badge-text: #121110;
    --state-running: #e5a836;
    --state-idle: #d4845a;
    --state-default: #5c5650;
    --success: #4ade80;
    --success-soft: rgba(74, 222, 128, 0.1);
    --error: #ef4444;
    --error-soft: rgba(239, 68, 68, 0.1);
    --info: #60a5fa;
    --info-soft: rgba(96, 165, 250, 0.1);
    --scrollbar: #3a3530;
    --selection: rgba(212, 132, 90, 0.25);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
    --shadow-lg: 0 12px 40px rgba(0,0,0,0.5);
    --nav-hover: #1a1816;
    --nav-active-bg: rgba(212, 132, 90, 0.1);
    --glow: 0 0 20px rgba(212, 132, 90, 0.08);
  }

  :global([data-theme="light"]) {
    --bg: #faf9f7;
    --bg-elevated: #ffffff;
    --bg-surface: #f0eee9;
    --bg-inset: #f5f3ef;
    --bg-hover: #e8e5e0;
    --border: #ddd9d3;
    --border-subtle: #e8e5e0;
    --text: #1c1917;
    --text-secondary: #44403c;
    --text-muted: #78716c;
    --text-dim: #a8a29e;
    --accent: #c4704b;
    --accent-soft: rgba(196, 112, 75, 0.08);
    --accent-hover: #b5633f;
    --accent-text: #fff;
    --badge-text: #fff;
    --state-running: #d97706;
    --state-idle: #c4704b;
    --state-default: #a8a29e;
    --success: #22c55e;
    --success-soft: rgba(34, 197, 94, 0.08);
    --error: #dc2626;
    --error-soft: rgba(220, 38, 38, 0.06);
    --info: #3b82f6;
    --info-soft: rgba(59, 130, 246, 0.06);
    --scrollbar: #d6d3d1;
    --selection: rgba(196, 112, 75, 0.15);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
    --shadow-lg: 0 12px 40px rgba(0,0,0,0.08);
    --nav-hover: #f0eee9;
    --nav-active-bg: rgba(196, 112, 75, 0.08);
    --glow: none;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: var(--bg);
    color: var(--text);
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-weight: 400;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    transition: background 0.3s ease, color 0.3s ease;
  }

  :global(::selection) {
    background: var(--selection);
  }

  :global(::-webkit-scrollbar) {
    width: 6px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: var(--scrollbar);
    border-radius: 3px;
  }

  :global(:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .shell {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 1.5rem 2rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1rem 0;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-shrink: 0;
  }

  .logo {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #ef4444, #f59e0b);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    box-shadow: var(--shadow-sm);
  }

  h1 {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    letter-spacing: -0.02em;
  }

  /* ── Tab Bar ────────────────────────────────────────────────────────── */
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: var(--bg-surface);
    border-radius: 10px;
    padding: 0.2rem;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.4rem 0.85rem;
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 550;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    font-family: inherit;
  }

  .tab-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .tab-btn.active {
    color: var(--accent);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-sm);
  }

  .tab-btn svg {
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .tab-btn span { display: none; }
    .tab-bar { gap: 0.15rem; padding: 0.15rem; }
    .tab-btn { padding: 0.4rem 0.6rem; }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .lang-switcher {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .lang-label {
    font-size: 0.72rem;
    font-weight: 550;
    color: var(--text-dim);
    transition: color 0.2s ease;
    user-select: none;
  }

  .lang-label.active {
    color: var(--text);
  }

  .lang-toggle {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--text-dim);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s ease;
    padding: 0;
    flex-shrink: 0;
  }

  .lang-toggle.zh {
    background: var(--accent);
  }

  .lang-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .lang-toggle.zh .lang-thumb {
    transform: translateX(16px);
  }

  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 0.4rem;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .theme-toggle:hover {
    color: var(--text);
    border-color: var(--text-dim);
    background: var(--bg-hover);
  }

  /* ── Greeting ──────────────────────────────────────────────────────────── */
  .greeting {
    padding: 1.5rem 0 0.75rem;
  }

  .greeting-line1 {
    font-size: 0.88rem;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
  }

  .greeting-line2 {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.45;
    color: var(--text);
  }

  .greeting-link {
    color: var(--text);
    cursor: pointer;
    transition: color 0.15s ease;
    text-decoration: none;
  }

  .greeting-link:hover {
    color: var(--accent);
  }

  /* ── Config Area ─────────────────────────────────────────────────────── */
  .config-area {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1.25rem;
    box-shadow: var(--shadow-sm);
    margin-bottom: 1.5rem;
  }

  .config-area-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .config-area-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .config-area-title svg {
    color: var(--accent);
  }

  .config-area-title h3 {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .config-area-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .action-msg {
    font-size: 0.78rem;
    font-weight: 500;
    animation: fadeIn 0.2s ease;
  }

  .action-msg.success { color: var(--success); }
  .action-msg.error { color: var(--error); }

  .save-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 0.45rem 1rem;
    border-radius: 8px;
    font-weight: 550;
    cursor: pointer;
    font-size: 0.82rem;
    transition: all 0.2s ease;
    white-space: nowrap;
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
    gap: 0.35rem;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 0.45rem 1rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.82rem;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
    white-space: nowrap;
  }

  .research-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .research-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .config-fields-inline {
    display: flex;
    align-items: flex-end;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .config-field-inline {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    min-width: 140px;
  }

  .config-toggle-inline {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding-bottom: 0.15rem;
    flex-shrink: 0;
  }

  .field-label {
    font-size: 0.8rem;
    font-weight: 550;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  select {
    background: var(--bg-surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.7rem;
    font-size: 0.85rem;
    font-family: inherit;
    transition: border-color 0.2s ease;
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
    background: #fff;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }

  .toggle-switch.on .toggle-thumb {
    transform: translateX(18px);
  }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Gallery ──────────────────────────────────────────────────────────── */
  .gallery-section {
    margin-top: 0.5rem;
  }

  .gallery-title {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 1rem;
    letter-spacing: -0.01em;
  }

  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  @media (max-width: 768px) {
    .gallery-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .gallery-grid {
      grid-template-columns: 1fr;
    }
  }

  .gallery-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    color: var(--text);
    font-family: inherit;
    padding: 0;
    box-shadow: var(--shadow-sm);
  }

  .gallery-card:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow-md), var(--glow);
    transform: translateY(-3px);
  }

  .gallery-card:active {
    transform: translateY(0);
  }

  /* New work card */
  .new-card {
    border-style: dashed;
    border-width: 2px;
    background: transparent;
  }

  .new-card-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 3rem 1rem;
    color: var(--text-dim);
    transition: color 0.2s ease;
  }

  .new-card:hover .new-card-inner {
    color: var(--accent);
  }

  .new-card-inner span {
    font-size: 0.85rem;
    font-weight: 550;
  }

  /* Existing work card */
  .card-cover {
    aspect-ratio: 16 / 10;
    position: relative;
    overflow: hidden;
    background: var(--bg-surface);
  }

  .card-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .draft-badge {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 0.15rem 0.5rem;
    border-radius: 9999px;
    background: rgba(0,0,0,0.5);
    color: #fff;
    backdrop-filter: blur(4px);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .card-info {
    padding: 0.75rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .card-title {
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-date {
    font-size: 0.72rem;
    color: var(--text-dim);
  }

  @media (max-width: 768px) {
    .lang-label {
      display: none;
    }
  }
</style>
