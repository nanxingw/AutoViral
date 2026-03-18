<script lang="ts">
  import { onMount, tick } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchPlatforms, checkPlatformStatus, connectPlatform, disconnectPlatform, type PlatformInfo } from "../lib/api";

  let { scrollToInsights = false }: { scrollToInsights?: boolean } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }
  let insightsEl: HTMLElement | undefined = $state(undefined);

  // ── Real data state ──
  let totalWorks = $state(0);
  let totalViews = $state(0);
  let totalLikes = $state(0);
  let totalComments = $state(0);

  let styleProfile: string[] = $state([]);
  let insights: { content: string; summary?: string; memory_type?: string; relevance?: number }[] = $state([]);
  let loading = $state(true);

  // ── Platform connection state ──
  interface PlatformState { name: string; label: string; status: "checking" | "connected" | "disconnected" | "connecting"; }
  let platforms: PlatformState[] = $state([
    { name: "douyin", label: "抖音", status: "checking" },
    { name: "xiaohongshu", label: "小红书", status: "checking" },
  ]);

  const platformIcons: Record<string, string> = { douyin: "🎵", xiaohongshu: "📕" };

  async function loadPlatformStatus() {
    for (const p of platforms) {
      p.status = "checking";
    }
    platforms = [...platforms];

    for (const p of platforms) {
      try {
        const res = await checkPlatformStatus(p.name);
        p.status = res.loggedIn ? "connected" : (res.connecting ? "connecting" : "disconnected");
      } catch {
        p.status = "disconnected";
      }
    }
    platforms = [...platforms];
  }

  async function handleConnect(name: string) {
    const p = platforms.find(x => x.name === name);
    if (!p) return;
    p.status = "connecting";
    platforms = [...platforms];

    try {
      await connectPlatform(name);
      // Poll status — but much less aggressively (every 15s, max 8 tries = 2min)
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const res = await checkPlatformStatus(name);
          if (res.loggedIn) {
            p.status = "connected";
            platforms = [...platforms];
            clearInterval(poll);
            return;
          }
        } catch { /* keep polling */ }
        if (attempts >= 8) {
          p.status = "disconnected";
          platforms = [...platforms];
          clearInterval(poll);
        }
      }, 15000);
    } catch {
      p.status = "disconnected";
      platforms = [...platforms];
    }
  }

  async function handleDisconnect(name: string) {
    const p = platforms.find(x => x.name === name);
    if (!p) return;
    try {
      await disconnectPlatform(name);
    } catch { /* ignore */ }
    p.status = "disconnected";
    platforms = [...platforms];
  }

  // ── Fetch analytics + profile + insights ──
  async function fetchData() {
    loading = true;
    try {
      const [analyticsRes, profileRes, insightsRes] = await Promise.all([
        fetch("/api/analytics"),
        fetch("/api/memory/profile"),
        fetch("/api/memory/search?q=platform%20insights&method=hybrid&topK=7"),
      ]);

      if (analyticsRes.ok) {
        const data = await analyticsRes.json();
        totalWorks = data.totalWorks ?? 0;
        totalViews = data.totalViews ?? 0;
        totalLikes = data.totalLikes ?? 0;
        totalComments = data.totalComments ?? 0;
      }

      if (profileRes.ok) {
        const data = await profileRes.json();
        styleProfile = data.style ?? [];
      }

      if (insightsRes.ok) {
        const data = await insightsRes.json();
        insights = data.memories ?? data.profiles ?? [];
      }
    } catch (_) {
      // silently fail
    } finally {
      loading = false;
    }
  }

  function formatNum(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  onMount(async () => {
    fetchData();
    loadPlatformStatus();
    const unsub = subscribe(() => { lang = getLanguage(); });
    if (scrollToInsights) {
      await tick();
      setTimeout(() => {
        insightsEl?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    }
    return () => unsub();
  });
</script>

<div class="analytics" data-lang={lang}>
  <!-- Platform Connections -->
  <div class="platform-section">
    <h3 class="sec-title">{lang === "zh" ? "社媒连接" : "Connected Accounts"}</h3>
    <div class="platform-grid">
      {#each platforms as p}
        <div class="platform-card" class:card-connected={p.status === "connected"} class:card-connecting={p.status === "connecting"} class:card-checking={p.status === "checking"}>
          <div class="platform-header">
            <span class="platform-icon">{platformIcons[p.name] ?? "📱"}</span>
            <span class="platform-name">{p.label}</span>
            <span class="platform-dot" class:dot-green={p.status === "connected"} class:dot-orange={p.status === "checking" || p.status === "connecting"} class:dot-gray={p.status === "disconnected"}></span>
          </div>
          <div class="platform-status-text">
            {#if p.status === "checking"}
              {lang === "zh" ? "检测中..." : "Checking..."}
            {:else if p.status === "connected"}
              {lang === "zh" ? "已连接" : "Connected"}
            {:else if p.status === "connecting"}
              {lang === "zh" ? "扫码中..." : "Waiting for scan..."}
            {:else}
              {lang === "zh" ? "未连接" : "Not connected"}
            {/if}
          </div>
          <div class="platform-actions">
            {#if p.status === "connected"}
              <button class="p-btn p-btn-disconnect" onclick={() => handleDisconnect(p.name)}>
                {lang === "zh" ? "断开" : "Disconnect"}
              </button>
            {:else if p.status === "connecting"}
              <button class="p-btn p-btn-waiting" disabled>
                {lang === "zh" ? "等待扫码..." : "Waiting..."}
              </button>
            {:else if p.status === "checking"}
              <button class="p-btn" disabled>...</button>
            {:else}
              <button class="p-btn p-btn-connect" onclick={() => handleConnect(p.name)}>
                {lang === "zh" ? "连接" : "Connect"}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Research Stats -->
  <div class="research-stats-section">
    <h3 class="sec-title">{tt("researchStats")}</h3>
    <div class="stats-grid">
      <div class="rs-card">
        <span class="rs-num">{loading ? "—" : formatNum(totalWorks)}</span>
        <span class="rs-label">{tt("worksCreated")}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">{loading ? "—" : formatNum(totalViews)}</span>
        <span class="rs-label">{lang === "zh" ? "总播放量" : "Total Views"}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">{loading ? "—" : formatNum(totalLikes)}</span>
        <span class="rs-label">{lang === "zh" ? "总点赞" : "Total Likes"}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">{loading ? "—" : formatNum(totalComments)}</span>
        <span class="rs-label">{lang === "zh" ? "总评论" : "Total Comments"}</span>
      </div>
    </div>
  </div>

  <!-- Style Keywords -->
  <div class="style-section">
    <h3 class="sec-title">{tt("styleKeywords")}</h3>
    {#if loading}
      <p class="empty-msg">{tt("loading")}</p>
    {:else if styleProfile.length === 0}
      <p class="empty-msg">{lang === "zh" ? "尚无风格画像。开始创作后 AI 将自动学习你的风格。" : "No style profile yet. Start creating content and AI will learn your style."}</p>
    {:else}
      <div class="keyword-chips">
        {#each styleProfile as kw}
          <span class="keyword-chip">{kw}</span>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Demographics Placeholder -->
  <div class="demo-section">
    <h3 class="sec-title">{tt("fanDemographics")}</h3>
    <div class="demo-placeholder">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <p class="placeholder-text">{lang === "zh" ? "连接分析 API 后可查看粉丝画像数据（年龄、性别、地区分布）。" : "Connect analytics API for demographics (age, gender, regions)."}</p>
    </div>
  </div>

  <!-- Latest Insights -->
  <div class="insights-section" bind:this={insightsEl}>
    <h3 class="sec-title">{tt("latestInsights")}</h3>
    {#if loading}
      <p class="empty-msg">{tt("loading")}</p>
    {:else if insights.length === 0}
      <p class="empty-msg">{lang === "zh" ? "暂无调研洞察。启动调研后洞察将在此显示。" : "No research insights yet. Start research to see insights here."}</p>
    {:else}
      <div class="insights-list">
        {#each insights as insight}
          <div class="insight-row">
            <div class="insight-dot"></div>
            <div class="insight-body">
              <span class="insight-title">{insight.summary ?? insight.content}</span>
              {#if insight.memory_type}
                <span class="insight-type">{insight.memory_type}</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .analytics {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* Platform connection cards */
  .platform-section { margin-bottom: 0.25rem; }
  .platform-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; margin-top: 0.5rem; }
  .platform-card {
    border: 1.5px solid var(--border);
    border-radius: var(--card-radius, 14px);
    padding: 1rem 1.1rem;
    background: var(--card-bg);
    backdrop-filter: var(--card-blur);
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .platform-card:hover { border-color: var(--text-dim); }
  .card-connected { border-color: rgba(52, 211, 153, 0.4); }
  .card-connecting { border-color: rgba(134, 120, 191, 0.4); }
  .card-checking { border-color: rgba(245, 158, 11, 0.3); }

  .platform-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .platform-icon { font-size: 1.3rem; }
  .platform-name { font-size: 0.92rem; font-weight: 650; flex: 1; }
  .platform-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot-green { background: var(--success); box-shadow: 0 0 6px rgba(52, 211, 153, 0.5); }
  .dot-orange { background: var(--state-running); animation: pulse-dot 1.5s ease-in-out infinite; }
  .dot-gray { background: var(--text-dim); opacity: 0.5; }
  @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  .platform-status-text { font-size: 0.76rem; color: var(--text-muted); margin-bottom: 0.65rem; }
  .card-connected .platform-status-text { color: var(--success); }
  .card-connecting .platform-status-text { color: var(--accent); }

  .platform-actions { display: flex; gap: 0.4rem; }
  .p-btn {
    flex: 1;
    padding: 0.4rem 0.65rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-secondary);
    font-size: 0.76rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }
  .p-btn:hover:not(:disabled) { border-color: var(--text-dim); background: var(--bg-hover); }
  .p-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .p-btn-connect { background: var(--accent-gradient); color: var(--accent-text); border-color: transparent; }
  .p-btn-connect:hover { filter: brightness(1.1); }
  .p-btn-disconnect { color: var(--error); border-color: rgba(251, 113, 133, 0.3); }
  .p-btn-disconnect:hover:not(:disabled) { background: rgba(251, 113, 133, 0.08); }
  .p-btn-waiting { color: var(--accent); border-color: rgba(134, 120, 191, 0.3); animation: pulse-dot 2s ease-in-out infinite; }

  .sec-title {
    font-size: 0.92rem;
    font-weight: 700;
    margin-bottom: 0.875rem;
    letter-spacing: -0.015em;
    color: var(--text);
  }

  .empty-msg {
    font-size: 0.82rem;
    color: var(--text-dim);
    font-weight: 500;
    line-height: 1.6;
    padding: 0.5rem 0;
  }

  /* ── Style Keywords ────────────────────────────────────────────────── */
  .style-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.25rem 1.375rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .keyword-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .keyword-chip {
    font-size: 0.82rem;
    font-weight: 550;
    padding: 0.45rem 1rem;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid transparent;
    transition: all var(--transition-fast);
    cursor: default;
  }

  .keyword-chip:hover {
    background: var(--accent);
    color: var(--accent-text);
  }

  .keyword-chip:first-child {
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-weight: 650;
    box-shadow: 0 4px 14px rgba(134, 120, 191, 0.25);
  }

  /* ── Demographics Placeholder ────────────────────────────────────── */
  .demo-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.25rem 1.375rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .demo-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 1rem;
    text-align: center;
  }

  .demo-placeholder svg {
    opacity: 0.35;
  }

  .placeholder-text {
    font-size: 0.82rem;
    color: var(--text-dim);
    font-weight: 500;
    max-width: 360px;
    line-height: 1.55;
  }

  /* ── Research Stats ─────────────────────────────────────────────────── */
  .research-stats-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.25rem 1.375rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.875rem;
  }

  @media (max-width: 640px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
  }

  .rs-card {
    background: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    text-align: center;
    transition: border-color var(--transition-fast);
  }

  .rs-card:hover {
    border-color: var(--border);
  }

  .rs-num {
    font-size: 1.5rem;
    font-weight: 750;
    color: var(--accent);
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .rs-label {
    font-size: 0.65rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 550;
  }

  /* ── Insights ──────────────────────────────────────────────────────── */
  .insights-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.25rem 1.375rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .insights-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .insight-row {
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
    padding: 0.75rem 0.5rem;
    border-radius: 10px;
    transition: background var(--transition-fast);
    cursor: pointer;
  }

  .insight-row:hover { background: var(--bg-hover); }

  .insight-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    margin-top: 0.4rem;
    box-shadow: 0 0 8px rgba(134, 120, 191, 0.35);
  }

  .insight-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .insight-title {
    font-size: 0.85rem;
    font-weight: 550;
    color: var(--text);
    line-height: 1.5;
  }

  .insight-type {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
