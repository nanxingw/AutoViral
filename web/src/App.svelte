<script lang="ts">
  import { onMount } from "svelte";
  import FeatureDetail from "./pages/FeatureDetail.svelte";
  import { t, getLanguage, setLanguage, subscribe } from "./lib/i18n";

  let theme: "light" | "dark" = $state("dark");
  let lang = $state(getLanguage());

  interface FeatureDef {
    id: string;
    icon: string;
    color: string;
  }

  const features: FeatureDef[] = [
    {
      id: "viral",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
      color: "linear-gradient(135deg, #f59e0b, #ef4444)",
    },
    {
      id: "hotspot",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
      color: "linear-gradient(135deg, #ef4444, #ec4899)",
    },
    {
      id: "timing",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      color: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    },
    {
      id: "pitfall",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      color: "linear-gradient(135deg, #f59e0b, #d97706)",
    },
    {
      id: "copywriting",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
      color: "linear-gradient(135deg, #10b981, #059669)",
    },
    {
      id: "competitor",
      icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
      color: "linear-gradient(135deg, #8b5cf6, #6366f1)",
    },
  ];

  let activeFeature: FeatureDef | null = $state(null);

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("se-theme", theme);
  }

  function toggleLanguage() {
    const next = lang === "en" ? "zh" : "en";
    setLanguage(next);
  }

  onMount(() => {
    const current = document.documentElement.getAttribute("data-theme") as "light" | "dark" | null;
    theme = current ?? "dark";
    const unsub = subscribe(() => { lang = getLanguage(); });
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
    {#if activeFeature}
      <FeatureDetail feature={activeFeature} onBack={() => activeFeature = null} />
    {:else}
      <!-- Hero Section -->
      <div class="hero">
        <h2 class="hero-title">{t("heroTitle")}</h2>
        <p class="hero-desc">{t("heroDesc")}</p>
      </div>

      <!-- Feature Grid -->
      <div class="feature-grid">
        {#each features as feature}
          <button class="feature-card" onclick={() => activeFeature = feature}>
            <div class="card-icon" style="background: {feature.color}">
              {@html feature.icon}
            </div>
            <div class="card-content">
              <h3>{t(`feature_${feature.id}_name`)}</h3>
              <p>{t(`feature_${feature.id}_desc`)}</p>
            </div>
            <div class="card-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          </button>
        {/each}
      </div>

      <!-- Workflow hint -->
      <div class="workflow-hint">
        <div class="workflow-steps">
          <span class="wf-step">{t("wf_research")}</span>
          <span class="wf-arrow">→</span>
          <span class="wf-step">{t("wf_topic")}</span>
          <span class="wf-arrow">→</span>
          <span class="wf-step">{t("wf_script")}</span>
          <span class="wf-arrow">→</span>
          <span class="wf-step">{t("wf_produce")}</span>
          <span class="wf-arrow">→</span>
          <span class="wf-step">{t("wf_publish")}</span>
          <span class="wf-arrow">→</span>
          <span class="wf-step">{t("wf_analyze")}</span>
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

  /* ── Hero ───────────────────────────────────────────────────────────────── */
  .hero {
    text-align: center;
    padding: 2rem 0 1.5rem;
  }

  .hero-title {
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--text), var(--accent));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero-desc {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
    max-width: 500px;
    margin-left: auto;
    margin-right: auto;
    line-height: 1.6;
  }

  /* ── Feature Grid ──────────────────────────────────────────────────────── */
  .feature-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.875rem;
    margin-top: 0.5rem;
  }

  @media (max-width: 640px) {
    .feature-grid {
      grid-template-columns: 1fr;
    }
  }

  .feature-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1.125rem 1.25rem;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    box-shadow: var(--shadow-sm);
    color: var(--text);
    font-family: inherit;
    font-size: inherit;
  }

  .feature-card:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow-md), var(--glow);
    transform: translateY(-2px);
  }

  .feature-card:active {
    transform: translateY(0);
  }

  .card-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    flex-shrink: 0;
    box-shadow: var(--shadow-sm);
  }

  .card-content {
    flex: 1;
    min-width: 0;
  }

  .card-content h3 {
    font-size: 0.92rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 0.2rem;
  }

  .card-content p {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-arrow {
    color: var(--text-dim);
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .feature-card:hover .card-arrow {
    color: var(--accent);
    transform: translateX(2px);
  }

  /* ── Workflow Hint ──────────────────────────────────────────────────────── */
  .workflow-hint {
    margin-top: 2rem;
    padding: 1rem 0;
    text-align: center;
  }

  .workflow-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .wf-step {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-surface);
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    white-space: nowrap;
  }

  .wf-arrow {
    color: var(--text-dim);
    font-size: 0.72rem;
  }

  @media (max-width: 768px) {
    .lang-label {
      display: none;
    }
  }
</style>
