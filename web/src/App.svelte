<script lang="ts">
  import { onMount } from "svelte";
  import FeatureDetail from "./pages/FeatureDetail.svelte";
  import Explore from "./pages/Explore.svelte";
  import Analytics from "./pages/Analytics.svelte";
  import { fetchConfig, updateConfig, triggerEvolution } from "./lib/api";
  import { t, getLanguage, setLanguage, subscribe } from "./lib/i18n";

  let theme: "light" | "dark" = $state("dark");
  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

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
    titleZh: string;
    cover: string;
    date: string;
    dateZh: string;
    status: "complete" | "draft";
  }

  const mockWorks: Work[] = [
    { id: "w1", title: "3 Tips to 10x Your Reach", titleZh: "播放量翻 10 倍的 3 个技巧", cover: "/covers/cover1.svg", date: "Mar 12", dateZh: "3月12日", status: "complete" },
    { id: "w2", title: "Why Nobody Watches Your Videos", titleZh: "为什么没人看你的视频", cover: "/covers/cover2.svg", date: "Mar 10", dateZh: "3月10日", status: "complete" },
    { id: "w3", title: "Hook Formula That Works", titleZh: "百试百灵的开头钩子公式", cover: "/covers/cover3.svg", date: "Mar 8", dateZh: "3月8日", status: "complete" },
    { id: "w4", title: "Competitor Blind Spots", titleZh: "竞品看不到的盲区", cover: "/covers/cover4.svg", date: "Mar 5", dateZh: "3月5日", status: "draft" },
    { id: "w5", title: "Weekend Posting Strategy", titleZh: "周末发布策略", cover: "/covers/cover5.svg", date: "Mar 3", dateZh: "3月3日", status: "complete" },
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
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
          <path d="M8 6L20 16L8 26V6Z" fill="url(#logo-grad)" opacity="0.9"/>
          <path d="M16 6L28 16L16 26V6Z" fill="#fff" opacity="0.45"/>
          <defs><linearGradient id="logo-grad" x1="8" y1="6" x2="20" y2="26"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0.6"/></linearGradient></defs>
        </svg>
      </div>
      <h1>AutoViral</h1>
    </div>
    <nav class="tab-bar">
      <button class="tab-btn" class:active={activeTab === "works"} onclick={() => { activeTab = "works"; activeView = null; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        {tt("tabWorks")}
      </button>
      <button class="tab-btn" class:active={activeTab === "explore"} onclick={() => { activeTab = "explore"; activeView = null; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
        {tt("tabExplore")}
      </button>
      <button class="tab-btn" class:active={activeTab === "analytics"} onclick={() => { activeTab = "analytics"; activeView = null; }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        {tt("tabAnalytics")}
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
        <p class="greeting-line1">{tt("greetingLine1")}</p>
        <p class="greeting-line2">{tt("greetingLine2a").replace("{count}", "47")}<span class="greeting-link" role="button" tabindex="0" onclick={goToInsights} onkeydown={(e) => e.key === "Enter" && goToInsights()}>{tt("greetingLine2b").replace("{insights}", "3")}</span>{tt("greetingLine2c")}</p>
      </div>

      <!-- Research Config Area -->
      <div class="config-area">
        <div class="config-area-header">
          <div class="config-area-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <h3>{tt("researchConfig")}</h3>
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
                {tt("saving")}
              {:else}
                {tt("saveChanges")}
              {/if}
            </button>
            <button class="research-btn" onclick={handleStartResearch} disabled={researching}>
              {#if researching}
                <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>
                {tt("researchingDots")}
              {:else}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                {tt("startResearch")}
              {/if}
            </button>
          </div>
        </div>

        <div class="config-fields-inline">
          <label class="config-field-inline">
            <span class="field-label">{tt("researchInterval")}</span>
            <select bind:value={interval}>
              <option value="15m">{tt("minutes15")}</option>
              <option value="30m">{tt("minutes30")}</option>
              <option value="1h">{tt("hour1")}</option>
              <option value="2h">{tt("hours2")}</option>
              <option value="4h">{tt("hours4")}</option>
              <option value="8h">{tt("hours8")}</option>
            </select>
          </label>
          <label class="config-field-inline">
            <span class="field-label">{tt("aiModel")}</span>
            <select bind:value={model}>
              <option value="haiku">{tt("claudeHaikuFast")}</option>
              <option value="sonnet">{tt("claudeSonnetBalanced")}</option>
              <option value="opus">{tt("claudeOpusCapable")}</option>
            </select>
          </label>
          <div class="config-toggle-inline">
            <span class="field-label">{tt("autoResearch")}</span>
            <button class="toggle-switch" class:on={autoRun} onclick={() => autoRun = !autoRun} role="switch" aria-checked={autoRun}>
              <span class="toggle-thumb"></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Works Gallery -->
      <div class="gallery-section">
        <h3 class="gallery-title">{tt("myWorks")}</h3>
        <div class="gallery-grid">
          <!-- New Work Card -->
          <button class="gallery-card new-card" onclick={() => activeView = "new"}>
            <div class="new-card-inner">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>{tt("newWork")}</span>
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
                <span class="card-title">{lang === "zh" ? work.titleZh : work.title}</span>
                <span class="card-date">{lang === "zh" ? work.dateZh : work.date}</span>
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

  :global(::selection) {
    background: var(--selection);
  }

  :global(::-webkit-scrollbar) {
    width: 5px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: var(--scrollbar);
    border-radius: 3px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--text-dim);
  }

  :global(:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .shell {
    max-width: 1120px;
    margin: 0 auto;
    padding: 0 2.5rem 4rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.25rem 0;
    margin-bottom: 2.5rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 100;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .logo {
    width: 36px;
    height: 36px;
    background: var(--accent-gradient);
    border-radius: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    box-shadow: 0 4px 12px rgba(134, 120, 191, 0.25);
  }

  h1 {
    font-size: 1.25rem;
    font-weight: 750;
    color: var(--text);
    white-space: nowrap;
    letter-spacing: -0.04em;
  }

  /* ── Tab Bar ────────────────────────────────────────────────────────── */
  .tab-bar {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    background: var(--bg-surface);
    border-radius: 14px;
    padding: 0.3rem;
    border: 1px solid var(--border);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 0.55rem 1.1rem;
    border-radius: 11px;
    font-size: 0.82rem;
    font-weight: 550;
    cursor: pointer;
    transition: all var(--transition-fast);
    white-space: nowrap;
    font-family: inherit;
  }

  .tab-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .tab-btn.active {
    color: var(--accent);
    background: var(--card-bg);
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
  }

  .tab-btn svg {
    flex-shrink: 0;
    opacity: 0.5;
  }

  .tab-btn.active svg {
    opacity: 1;
  }

  @media (max-width: 640px) {
    .tab-btn span { display: none; }
    .tab-bar { gap: 0.1rem; padding: 0.2rem; }
    .tab-btn { padding: 0.5rem 0.7rem; }
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
    background: var(--accent-gradient);
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
    padding: 2rem 0 1.25rem;
  }

  .greeting-line1 {
    font-size: 0.82rem;
    color: var(--text-dim);
    margin-bottom: 0.6rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 550;
  }

  .greeting-line2 {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.5;
    color: var(--text);
  }

  .greeting-link {
    color: var(--accent);
    cursor: pointer;
    transition: all var(--transition-fast);
    text-decoration: none;
    border-bottom: 1.5px solid rgba(134, 120, 191, 0.3);
  }

  .greeting-link:hover {
    border-bottom-color: var(--accent);
  }

  /* ── Config Area ─────────────────────────────────────────────────────── */
  .config-area {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.5rem;
    box-shadow: var(--shadow-sm);
    margin-bottom: 2.5rem;
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
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
    gap: 0.4rem;
    background: var(--accent-gradient);
    color: var(--accent-text);
    border: none;
    padding: 0.55rem 1.25rem;
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.82rem;
    transition: all var(--transition-fast);
    box-shadow: 0 4px 14px rgba(134, 120, 191, 0.25);
    white-space: nowrap;
  }

  .research-btn:hover:not(:disabled) {
    box-shadow: 0 6px 22px rgba(134, 120, 191, 0.35);
    transform: translateY(-1px);
    filter: brightness(1.1);
  }

  .research-btn:active:not(:disabled) {
    transform: translateY(0);
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

  .toggle-switch.on {
    background: var(--accent-gradient);
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
    margin-top: 0.75rem;
  }

  .gallery-title {
    font-size: 1rem;
    font-weight: 650;
    margin-bottom: 1.25rem;
    letter-spacing: -0.015em;
    color: var(--text);
  }

  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.125rem;
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
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    overflow: hidden;
    cursor: pointer;
    transition: all var(--transition-normal);
    text-align: left;
    color: var(--text);
    font-family: inherit;
    padding: 0;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .gallery-card:hover {
    border-color: rgba(134, 120, 191, 0.3);
    box-shadow: var(--shadow-md), var(--glow);
    transform: translateY(-6px) scale(1.01);
  }

  .gallery-card:active {
    transform: translateY(-2px) scale(1.005);
    transition-duration: 0.1s;
  }

  /* New work card */
  .new-card {
    border-style: dashed;
    border-width: 1.5px;
    border-color: var(--text-dim);
    background: transparent;
    backdrop-filter: none;
  }

  .new-card:hover {
    border-color: var(--accent);
    background: var(--accent-soft);
    border-style: solid;
  }

  .new-card-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3.5rem 1rem;
    color: var(--text-dim);
    transition: color var(--transition-fast);
  }

  .new-card:hover .new-card-inner {
    color: var(--accent);
  }

  .new-card-inner span {
    font-size: 0.85rem;
    font-weight: 600;
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
    transition: transform var(--transition-normal);
  }

  .gallery-card:hover .card-cover img {
    transform: scale(1.03);
  }

  .draft-badge {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    font-size: 0.62rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    background: rgba(0,0,0,0.55);
    color: #fff;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .card-info {
    padding: 0.875rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .card-title {
    font-size: 0.88rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-date {
    font-size: 0.72rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  @media (max-width: 768px) {
    .lang-label {
      display: none;
    }
    .shell {
      padding: 0 1.25rem 2rem;
    }
  }
</style>
