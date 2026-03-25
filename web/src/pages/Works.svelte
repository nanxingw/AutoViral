<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { fetchWorks, deleteWorkApi, type WorkSummary } from "../lib/api";
  import InterestTags from "../components/InterestTags.svelte";

  let {
    onOpenStudio,
    onCreateNew,
    onCreateFromTrend,
    onGoToInsights,
  }: {
    onOpenStudio: (workId: string) => void;
    onCreateNew: () => void;
    onCreateFromTrend: (title: string, topicHint: string) => void;
    onGoToInsights?: () => void;
  } = $props();

  let autoResearchOn = $state(false);
  let insightCount = $state(0);
  let competitorCount = $state(0);

  async function loadInsightData() {
    try {
      const configRes = await fetch("/api/config");
      if (configRes.ok) {
        const config = await configRes.json();
        autoResearchOn = config.autoRun ?? false;
      }
    } catch {}
    try {
      // Count trend directions as "ideas"
      for (const platform of ["douyin", "xiaohongshu"]) {
        const res = await fetch(`/api/trends/${platform}`);
        if (res.ok) {
          const data = await res.json();
          const arr = data.topics ?? data.directions ?? data.trends ?? data.items ?? [];
          if (Array.isArray(arr)) {
            insightCount += arr.length;
            competitorCount += Math.max(arr.length * 2, 5); // approximate
          }
        }
      }
    } catch {}
  }

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  let works: WorkSummary[] = $state([]);
  let loading = $state(true);
  let filter: "all" | "draft" | "published" = $state("all");

  let filteredWorks = $derived.by(() => {
    if (filter === "all") return works;
    if (filter === "draft") return works.filter(w => w.status !== "ready");
    return works.filter(w => w.status === "ready");
  });

  async function loadWorks() {
    loading = true;
    try {
      works = await fetchWorks();
    } catch {
      works = [];
    } finally {
      loading = false;
    }
  }

  function statusLabel(status: string): string {
    if (status === "ready") return tt("workReady");
    return tt("workDraft");
  }

  function statusClass(status: string): string {
    if (status === "ready") return "status-published";
    return "status-draft";
  }

  function isPublished(status: string): boolean {
    return status === "ready";
  }

  // Mock stats for published works (in real app, fetched from analytics API)
  function getWorkStats(workId: string): { likes: number; comments: number; newFollowers: number } {
    let hash = 0;
    for (let i = 0; i < workId.length; i++) {
      hash = workId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const seed = Math.abs(hash);
    return {
      likes: (seed % 9000) + 1000,
      comments: (seed % 500) + 50,
      newFollowers: (seed % 200) + 10,
    };
  }

  function formatNum(n: number): string {
    if (n >= 10000) return (n / 10000).toFixed(1) + "w";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
  }

  function typeLabel(type: string): string {
    if (type === "short-video") return tt("shortVideo");
    if (type === "image-text") return tt("imageText");
    return type;
  }

  function platformLabel(p: string): string {
    if (p === "douyin") return tt("douyin");
    if (p === "xiaohongshu") return tt("xiaohongshu");
    return p;
  }

  const gradients = [
    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
    "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
    "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
    "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  ];

  async function handleDelete(e: MouseEvent, workId: string, title: string) {
    e.stopPropagation(); // Don't open studio
    if (!confirm(lang === "zh" ? `确定删除「${title}」？` : `Delete "${title}"?`)) return;
    try {
      await deleteWorkApi(workId);
      works = works.filter(w => w.id !== workId);
    } catch { /* ignore */ }
  }

  function cardGradient(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return gradients[Math.abs(hash) % gradients.length];
  }

  // Inspiration data (embedded from old Explore)
  interface TrendDirection {
    title: string;
    heat: number;
    description: string;
    tags?: string[];
    contentAngles?: string[];
    exampleHook?: string;
    opportunity?: string;
    competition?: string;
    category?: string;
    emotionType?: string;
    emotionSubtype?: string;
  }

  let douyinDirections: TrendDirection[] = $state([]);
  let xhsDirections: TrendDirection[] = $state([]);
  let selectedTrend: TrendDirection | null = $state(null);
  let inspirationPlatform: "douyin" | "xiaohongshu" = $state("douyin");
  let interests: string[] = $state([]);
  let researchLoading = $state(false);
  let researchSeconds = $state(0);
  let researchTimer: ReturnType<typeof setInterval> | null = null;
  let showResearchModal = $state(false);
  let configInterval = $state("1h");
  let configModel = $state("sonnet");

  async function loadConfig() {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        configInterval = data.interval ?? "1h";
        configModel = data.model ?? "sonnet";
      }
    } catch {}
  }

  function openResearchModal() {
    if (researchLoading) return;
    showResearchModal = true;
  }

  async function startResearchFromModal() {
    showResearchModal = false;
    researchLoading = true;
    researchSeconds = 30;
    // Clear old directions immediately so user sees fresh results
    if (inspirationPlatform === "douyin") douyinDirections = [];
    else xhsDirections = [];
    // Save config
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRun: autoResearchOn, interval: configInterval, model: configModel }),
      });
    } catch {}
    // Start countdown
    researchTimer = setInterval(() => {
      researchSeconds--;
      if (researchSeconds <= 0) {
        if (researchTimer) clearInterval(researchTimer);
        researchTimer = null;
      }
    }, 1000);
    // Start research — pass interests and competitors
    try {
      await fetch("/api/trends/refresh-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: inspirationPlatform, interests, competitors: [] }),
      });
      // Wait then reload
      setTimeout(async () => {
        if (researchTimer) clearInterval(researchTimer);
        researchTimer = null;
        researchSeconds = 0;
        await loadInspirationDirections();
        await loadInsightData();
        researchLoading = false;
      }, 30000);
    } catch {
      if (researchTimer) clearInterval(researchTimer);
      researchTimer = null;
      researchSeconds = 0;
      researchLoading = false;
    }
  }

  async function toggleAutoResearch() {
    autoResearchOn = !autoResearchOn;
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRun: autoResearchOn }),
      });
    } catch {
      autoResearchOn = !autoResearchOn;
    }
  }

  let inspirationDirections = $derived(
    inspirationPlatform === "douyin" ? douyinDirections : xhsDirections
  );

  async function loadInspirationDirections() {
    for (const platform of ["douyin", "xiaohongshu"] as const) {
      try {
        const res = await fetch(`/api/trends/${platform}`);
        if (res.ok) {
          const data = await res.json();
          const arr = data.topics ?? data.directions ?? data.trends ?? data.items ?? [];
          if (Array.isArray(arr)) {
            const mapped = arr.map((item: any) => ({
              title: item.title ?? item.name ?? "",
              heat: Math.min(5, Math.max(1, Number(item.heat ?? item.score ?? 3))),
              description: item.description ?? item.desc ?? "",
              tags: Array.isArray(item.tags) ? item.tags : [],
              contentAngles: Array.isArray(item.contentAngles) ? item.contentAngles : [],
              exampleHook: item.exampleHook ?? "",
              opportunity: item.opportunity ?? "",
              competition: item.competition ?? "",
              category: item.category ?? "",
              emotionType: item.emotionType ?? "",
              emotionSubtype: item.emotionSubtype ?? "",
            }));
            if (platform === "douyin") douyinDirections = mapped;
            else xhsDirections = mapped;
          }
        }
      } catch {}
    }
  }

  async function loadInterests() {
    try {
      const res = await fetch("/api/interests");
      if (res.ok) {
        const data = await res.json();
        interests = data.interests ?? [];
      }
    } catch {}
  }

  async function saveInterests(updated: string[]) {
    interests = updated;
    await fetch("/api/interests", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interests: updated }),
    }).catch(() => {});
  }

  function dispatchCreate(dir: TrendDirection) {
    const hint = [
      dir.emotionType ? `目标情绪: ${dir.emotionType}${dir.emotionSubtype ? `（${dir.emotionSubtype}）` : ""}` : "",
      dir.description,
      dir.contentAngles?.length ? `切入角度: ${dir.contentAngles.join("; ")}` : "",
      dir.exampleHook ? `爆款钩子: ${dir.exampleHook}` : "",
      dir.tags?.length ? dir.tags.map(t => "#" + t).join(" ") : "",
    ].filter(Boolean).join("\n");
    onCreateFromTrend(dir.title, hint);
  }

  function heatDots(level: number): string {
    return Array.from({ length: 5 }, (_, i) => i < level ? "\u{1F525}" : "\u00B7").join("");
  }

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    loadWorks();
    loadInsightData();
    loadInspirationDirections();
    loadInterests();
    loadConfig();
    return () => {
      unsub();
      if (researchTimer) clearInterval(researchTimer);
    };
  });
</script>

<div class="works-page">
  <!-- ═══ Zone 1: Greeting + Viral Ideas ═══ -->
  <div class="hero-zone">
    <p class="hero-text">
      {tt("insightBannerWithData").replace("{competitors}", String(competitorCount))}
      <span class="hero-highlight">{insightCount}{tt("viralIdeas")}</span>
      {tt("viralIdeasSuffix")}
    </p>
    <div class="section-header">
      <div class="section-title-row">
        <h2 class="section-title">{tt("inspirationTitle")}</h2>
        <InterestTags {interests} onUpdate={saveInterests} />
      </div>
      <div class="section-right">
        <div class="pill-group">
          <button class="pill" class:active={inspirationPlatform === "douyin"} onclick={() => inspirationPlatform = "douyin"}>
            {tt("douyinTab")}{#if douyinDirections.length > 0} <span class="pill-num">{douyinDirections.length}</span>{/if}
          </button>
          <button class="pill" class:active={inspirationPlatform === "xiaohongshu"} onclick={() => inspirationPlatform = "xiaohongshu"}>
            {tt("xiaohongshuTab")}{#if xhsDirections.length > 0} <span class="pill-num">{xhsDirections.length}</span>{/if}
          </button>
        </div>
        <button class="new-work-btn" onclick={openResearchModal} disabled={researchLoading}>
          {#if researchLoading}
            <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {lang === "zh" ? "思考中" : "Thinking"}{#if researchSeconds > 0} ({researchSeconds}s){/if}
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            {lang === "zh" ? "想新思路" : "New Ideas"}
          {/if}
        </button>
      </div>
    </div>
    {#if inspirationDirections.length > 0}
      <div class="inspiration-scroll">
        {#each inspirationDirections.slice(0, 10) as dir}
          <button class="inspiration-card" onclick={() => selectedTrend = dir}>
            <div class="insp-card-top">
              {#if dir.emotionType}
                <span class="insp-emotion">{dir.emotionType}</span>
              {/if}
              {#if dir.category}
                <span class="insp-category">{dir.category}</span>
              {/if}
              <span class="insp-heat">{heatDots(dir.heat)}</span>
            </div>
            <h4 class="insp-title">{dir.title}</h4>
            {#if dir.description}
              <p class="insp-desc">{dir.description}</p>
            {/if}
            {#if dir.tags && dir.tags.length > 0}
              <div class="insp-tags">
                {#each dir.tags.slice(0, 3) as tag}
                  <span class="insp-tag">#{tag}</span>
                {/each}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {:else}
      <p class="section-empty">{tt("emptyTrendsDesc")}</p>
    {/if}
  </div>

  <!-- ═══ Zone 2: Works List ═══ -->
  <div class="section">
    <div class="section-header">
      <h2 class="section-title">{tt("workList")}</h2>
      <div class="section-right">
        <div class="pill-group">
          <button class="pill" class:active={filter === "all"} onclick={() => filter = "all"}>
            {tt("filterAll")}
          </button>
          <button class="pill" class:active={filter === "draft"} onclick={() => filter = "draft"}>
            {tt("filterDraft")}
          </button>
          <button class="pill" class:active={filter === "published"} onclick={() => filter = "published"}>
            {tt("filterPublished")}
          </button>
        </div>
        <button class="new-work-btn" onclick={onCreateNew}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {tt("newWork")}
        </button>
      </div>
    </div>

  <!-- Loading -->
  {#if loading}
    <div class="loading-state">
      <div class="loader"></div>
      <p>{tt("loading")}</p>
    </div>
  <!-- Empty state -->
  {:else if filteredWorks.length === 0 && works.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      </div>
      <h3>{tt("createFirstWork")}</h3>
      <p>{tt("noWorks")}</p>
      <button class="cta-btn" onclick={onCreateNew}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {tt("newWork")}
      </button>
    </div>
  {:else if filteredWorks.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        {#if filter === "draft"}
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        {:else}
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        {/if}
      </div>
      <h3>{filter === "draft" ? tt("noDrafts") : tt("noPublished")}</h3>
      <p>{filter === "draft" ? tt("noDraftsDesc") : tt("noPublishedDesc")}</p>
    </div>
  {:else}
    <!-- Gallery grid -->
    <div class="gallery-grid">
      {#each filteredWorks as w}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="work-card" onclick={() => onOpenStudio(w.id)}>
          <!-- Cover -->
          <div class="card-cover">
            {#if w.coverImage}
              <img src={w.coverImage} alt={w.title} />
            {:else}
              <div class="cover-gradient" style="background: {cardGradient(w.id)};">
                <span class="cover-icon">
                  {#if w.type === "short-video"}
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  {:else}
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  {/if}
                </span>
              </div>
            {/if}
            <span class="status-badge {statusClass(w.status)}">{statusLabel(w.status)}</span>
          </div>

          <!-- Info -->
          <div class="card-body">
            <div class="card-title-row">
              <h3 class="card-title">{w.title}</h3>
              <button class="delete-btn" onclick={(e) => handleDelete(e, w.id, w.title)} title={tt("delete")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
            {#if isPublished(w.status)}
              {@const stats = getWorkStats(w.id)}
              <div class="card-stats">
                <span class="monitor-dot"></span>
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                  {formatNum(stats.likes)}
                </span>
                <span class="stat-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  {formatNum(stats.comments)}
                </span>
                <span class="stat-item stat-followers">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                  +{formatNum(stats.newFollowers)}
                </span>
              </div>
            {:else}
              <div class="card-meta">
                <span class="type-badge">{typeLabel(w.type)}</span>
              </div>
            {/if}
            <span class="card-date">{new Date(w.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
  </div>
</div>

{#if selectedTrend}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="trend-overlay" onclick={(e) => { if ((e.target as HTMLElement).classList.contains('trend-overlay')) selectedTrend = null; }}>
    <div class="trend-modal">
      <div class="trend-modal-head">
        <div class="trend-modal-meta">
          {#if selectedTrend.category}
            <span class="tm-category">{selectedTrend.category}</span>
          {/if}
          {#if selectedTrend.opportunity}
            <span class="tm-badge">{selectedTrend.opportunity}</span>
          {/if}
          {#if selectedTrend.competition}
            <span class="tm-badge tm-comp">{lang === "zh" ? "竞争" : "Competition: "}{selectedTrend.competition}</span>
          {/if}
        </div>
        <button class="trend-modal-close" onclick={() => selectedTrend = null}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <h2 class="trend-modal-title">{selectedTrend.title}</h2>
      <div class="tm-heat">{heatDots(selectedTrend.heat)}</div>

      {#if selectedTrend.description}
        <p class="tm-desc">{selectedTrend.description}</p>
      {/if}

      {#if selectedTrend.contentAngles && selectedTrend.contentAngles.length > 0}
        <div class="tm-section">
          <span class="tm-section-label">{lang === "zh" ? "切入角度" : "Content Angles"}</span>
          {#each selectedTrend.contentAngles as angle}
            <div class="tm-angle">{angle}</div>
          {/each}
        </div>
      {/if}

      {#if selectedTrend.exampleHook}
        <div class="tm-section">
          <span class="tm-section-label">{tt("viralHook")}</span>
          <p class="tm-hook">&ldquo;{selectedTrend.exampleHook}&rdquo;</p>
        </div>
      {/if}

      {#if selectedTrend.tags && selectedTrend.tags.length > 0}
        <div class="tm-tags">
          {#each selectedTrend.tags as tag}
            <span class="tm-tag">#{tag}</span>
          {/each}
        </div>
      {/if}

      <button class="tm-create-btn" onclick={() => { dispatchCreate(selectedTrend!); selectedTrend = null; }}>
        {tt("createFromTrend")}
      </button>
    </div>
  </div>
{/if}

{#if showResearchModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="research-overlay" onclick={(e) => { if ((e.target as HTMLElement).classList.contains('research-overlay')) showResearchModal = false; }}>
    <div class="research-modal">
      <div class="rm-head">
        <h3 class="rm-title">{lang === "zh" ? "想新思路" : "New Ideas"}</h3>
        <button class="rm-close" onclick={() => showResearchModal = false}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="rm-body">
        <label class="rm-field">
          <span class="rm-label">{tt("researchInterval")}</span>
          <select bind:value={configInterval}>
            <option value="15m">{tt("minutes15")}</option>
            <option value="30m">{tt("minutes30")}</option>
            <option value="1h">{tt("hour1")}</option>
            <option value="2h">{tt("hours2")}</option>
            <option value="4h">{tt("hours4")}</option>
            <option value="8h">{tt("hours8")}</option>
          </select>
        </label>

        <label class="rm-field">
          <span class="rm-label">{tt("aiModel")}</span>
          <select bind:value={configModel}>
            <option value="haiku">{tt("claudeHaikuFast")}</option>
            <option value="sonnet">{tt("claudeSonnetBalanced")}</option>
            <option value="opus">{tt("claudeOpusCapable")}</option>
          </select>
        </label>

        <div class="rm-switch-field">
          <span class="rm-label">{tt("autoResearchLabel")}</span>
          <button class="apple-switch" class:on={autoResearchOn} onclick={toggleAutoResearch} role="switch" aria-checked={autoResearchOn}>
            <span class="apple-switch-thumb"></span>
          </button>
        </div>
      </div>

      <button class="rm-start-btn" onclick={startResearchFromModal}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        {tt("startResearch")}
      </button>
    </div>
  </div>
{/if}

<style>
  .works-page {
    max-width: 1200px;
    margin: 0 auto;
  }

  /* ── Zone 1: Hero (Greeting + Viral Ideas) ────────── */
  .hero-zone {
    margin-bottom: 1.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .hero-text {
    font-family: var(--font-display);
    font-size: var(--size-xl);
    font-weight: 600;
    color: var(--text-secondary);
    line-height: 1.4;
    letter-spacing: -0.02em;
    margin: 1.5rem 0 1.25rem;
  }

  .hero-highlight {
    color: var(--spark-red);
    font-weight: 700;
  }

  /* ── Shared section styles (Zone 2 & 3) ──────────── */
  .section {
    margin-top: 1.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.85rem;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .section-title {
    font-family: var(--font-display);
    font-size: var(--size-base);
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.02em;
    white-space: nowrap;
  }

  .section-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  /* Pill filter group */
  .pill-group {
    display: flex;
    gap: 0.2rem;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.25rem 0.65rem;
    border: none;
    border-radius: 99px;
    background: none;
    color: var(--text-dim);
    font-family: var(--font-body);
    font-size: var(--size-xs);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .pill:hover {
    color: var(--text-secondary);
    background: var(--accent-soft);
  }

  .pill.active {
    color: var(--text);
    background: var(--selected, rgba(254, 44, 85, 0.08));
    font-weight: 600;
  }

  .pill-num {
    font-size: 0.58rem;
    opacity: 0.5;
  }

  .pill.active .pill-num {
    opacity: 0.7;
  }

  .apple-switch {
    position: relative;
    width: 38px;
    height: 22px;
    border-radius: 11px;
    border: none;
    background: var(--text-dim);
    cursor: pointer;
    transition: background 0.25s ease;
    flex-shrink: 0;
    padding: 0;
  }

  .apple-switch.on {
    background: var(--spark-red, #FE2C55);
  }

  .apple-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apple-switch.on .apple-switch-thumb {
    transform: translateX(16px);
  }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .section-empty {
    font-size: var(--size-sm);
    color: var(--text-dim);
    padding: 1rem 0;
  }

  .new-work-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    padding: 0.35rem 0.8rem;
    border-radius: 4px;
    font-family: var(--font-body);
    font-size: var(--size-xs);
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--transition-fast);
    white-space: nowrap;
  }

  .new-work-btn:hover { opacity: 0.8; }

  /* ── Loading ──────────────────────────────────────────── */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 5rem 0;
    color: var(--text-dim);
  }

  .loader {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Empty State ──────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 5rem 1rem;
    text-align: center;
  }

  .empty-icon {
    color: var(--text-dim);
    opacity: 0.4;
    margin-bottom: 0.5rem;
  }

  .empty-state h3 {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-secondary);
  }

  .empty-state p {
    font-size: 0.88rem;
    color: var(--text-muted);
    max-width: 320px;
  }

  .empty-filter-text {
    font-size: 0.88rem;
    color: var(--text-dim);
  }

  .cta-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    padding: 0.55rem 1.25rem;
    border-radius: 4px;
    font-family: var(--font-body);
    font-size: var(--size-sm);
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--transition-fast);
    margin-top: 0.75rem;
  }

  .cta-btn:hover { opacity: 0.8; }

  /* ── Gallery Grid ─────────────────────────────────────── */
  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 1.25rem 0.85rem;
  }

  @media (min-width: 900px) {
    .gallery-grid { grid-template-columns: repeat(5, 1fr); }
  }

  /* ── Work Card ────────────────────────────────────────── */
  .work-card {
    cursor: pointer;
    text-align: left;
    color: var(--text);
    font-family: inherit;
    padding: 0;
    background: none;
    border: none;
    transition: opacity 0.15s;
  }

  .work-card:hover {
    opacity: 0.85;
  }

  /* Cover — 9:16 portrait */
  .card-cover {
    aspect-ratio: 9 / 16;
    position: relative;
    overflow: hidden;
    border-radius: var(--card-radius);
    background: var(--bg-surface);
  }

  .card-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.3s ease;
  }

  .work-card:hover .card-cover img {
    transform: scale(1.03);
  }

  .cover-gradient {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cover-icon {
    color: rgba(255, 255, 255, 0.25);
  }

  .status-badge {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    font-size: var(--size-xs);
    font-weight: 600;
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .status-published { background: var(--success); color: #fff; }
  .status-draft { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.7); }

  /* Body */
  .card-body {
    padding: 0.5rem 0.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .card-title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.2rem;
  }

  .card-title {
    font-family: var(--font-display);
    font-size: var(--size-sm);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }

  .delete-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.15rem;
    border-radius: 3px;
    transition: all 0.12s;
    flex-shrink: 0;
    opacity: 0;
  }

  .work-card:hover .delete-btn { opacity: 1; }

  .delete-btn:hover {
    color: var(--error);
  }

  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.1rem;
  }

  .type-badge {
    font-size: var(--size-xs);
    font-weight: 500;
    color: var(--text-muted);
  }

  /* Published stats row */
  .card-stats {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.2rem;
  }

  .monitor-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    flex-shrink: 0;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
    50% { opacity: 0.6; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
  }

  .stat-item {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    font-size: var(--size-xs);
    font-weight: 500;
    color: var(--text-muted);
  }

  .stat-item svg {
    opacity: 0.6;
  }

  .stat-followers {
    color: var(--success);
  }

  .stat-followers svg {
    opacity: 0.8;
  }

  .card-date {
    font-size: var(--size-xs);
    color: var(--text-dim);
    font-weight: 400;
  }

  /* ── Inspiration Cards ────────────────────────────── */

  .inspiration-scroll {
    display: flex;
    gap: 0.65rem;
    overflow-x: auto;
    padding-bottom: 0.35rem;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar) transparent;
  }

  .inspiration-scroll::-webkit-scrollbar { height: 3px; }
  .inspiration-scroll::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 2px; }

  .inspiration-card {
    flex-shrink: 0;
    width: 200px;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--card-radius);
    background: var(--bg-surface);
    cursor: pointer;
    transition: border-color 0.12s;
    text-align: left;
    font-family: var(--font-body);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .inspiration-card:hover {
    border-color: var(--text-dim);
  }

  .insp-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
  }

  .insp-emotion {
    font-size: 0.62rem;
    font-weight: 600;
    color: var(--spark-red, #FE2C55);
    background: rgba(254, 44, 85, 0.08);
    padding: 0.1rem 0.4rem;
    border-radius: 9999px;
  }

  .insp-category {
    font-size: var(--size-xs);
    font-weight: 500;
    color: var(--text-dim);
  }

  .insp-heat {
    font-size: 0.65rem;
    letter-spacing: -0.02em;
  }

  .insp-title {
    font-family: var(--font-display);
    font-size: var(--size-sm);
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.02em;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .insp-desc {
    font-size: var(--size-xs);
    color: var(--text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .insp-tags {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
    margin-top: 0.15rem;
  }

  .insp-tag {
    font-size: 0.65rem;
    color: var(--text-dim);
  }

  @media (max-width: 640px) {
    .section-header { flex-direction: column; align-items: flex-start; gap: 0.5rem; }
    .section-right { width: 100%; flex-wrap: wrap; }
  }

  /* ── Trend Detail Modal ────────────────────────────── */
  .trend-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    animation: fadeIn 0.12s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .trend-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 100%;
    max-width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 1.5rem;
    box-shadow: var(--shadow-lg);
    animation: modalIn 0.15s ease;
  }

  @keyframes modalIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .trend-modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .trend-modal-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .tm-category {
    font-size: var(--size-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tm-badge {
    font-size: var(--size-xs);
    font-weight: 500;
    color: var(--spark-red);
    padding: 0.1rem 0.4rem;
    border: 1px solid currentColor;
    border-radius: 3px;
    line-height: 1.3;
  }

  .tm-comp {
    color: var(--text-muted);
  }

  .trend-modal-close {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.15rem;
    display: flex;
    transition: color 0.12s;
    flex-shrink: 0;
  }

  .trend-modal-close:hover { color: var(--text); }

  .trend-modal-title {
    font-family: var(--font-display);
    font-size: var(--size-xl);
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.03em;
    line-height: 1.25;
    margin-bottom: 0.35rem;
  }

  .tm-heat {
    font-size: var(--size-sm);
    margin-bottom: 0.75rem;
  }

  .tm-desc {
    font-size: var(--size-sm);
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 1rem;
  }

  .tm-section {
    margin-bottom: 0.85rem;
  }

  .tm-section-label {
    display: block;
    font-size: var(--size-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.35rem;
  }

  .tm-angle {
    font-size: var(--size-sm);
    color: var(--text-secondary);
    padding: 0.2rem 0;
    padding-left: 0.75rem;
    border-left: 2px solid var(--border);
    margin-bottom: 0.2rem;
  }

  .tm-hook {
    font-size: var(--size-sm);
    color: var(--text);
    font-style: italic;
    line-height: 1.5;
    padding: 0.5rem 0.75rem;
    border-left: 2px solid var(--spark-red);
    background: rgba(254, 44, 85, 0.04);
  }

  .tm-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-bottom: 1.25rem;
  }

  .tm-tag {
    font-size: var(--size-xs);
    color: var(--text-dim);
  }

  .tm-create-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 0.55rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    font-family: var(--font-body);
    font-size: var(--size-sm);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .tm-create-btn:hover { opacity: 0.8; }

  /* ── Research Config Modal ─────────────────────────── */
  .research-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    animation: fadeIn 0.12s ease;
  }

  .research-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    width: 100%;
    max-width: 360px;
    padding: 1.25rem;
    box-shadow: var(--shadow-lg);
    animation: modalIn 0.15s ease;
  }

  .rm-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .rm-title {
    font-family: var(--font-display);
    font-size: var(--size-base);
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .rm-close {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0.15rem;
    display: flex;
    transition: color 0.12s;
  }

  .rm-close:hover { color: var(--text); }

  .rm-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .rm-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .rm-label {
    font-size: var(--size-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .rm-field select {
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.4rem 2rem 0.4rem 0.6rem;
    font-size: var(--size-sm);
    font-family: var(--font-body);
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6560' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.6rem center;
    background-size: 11px;
    cursor: pointer;
  }

  .rm-field select:focus {
    outline: none;
    border-color: var(--text-muted);
  }

  .rm-switch-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.15rem 0;
  }

  .rm-start-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.55rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    font-family: var(--font-body);
    font-size: var(--size-sm);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .rm-start-btn:hover { opacity: 0.8; }
</style>
