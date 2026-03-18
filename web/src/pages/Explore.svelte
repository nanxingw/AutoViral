<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";

  let lang = $state(getLanguage());

  // Reactive t() wrapper - forces Svelte to re-evaluate when lang changes
  function tt(key: string): string { void lang; return t(key); }

  interface TrendingVideo {
    title: string;
    thumb: string;
    views: string;
    likes: string;
    comments: string;
  }

  interface HotTag {
    tag: string;
    posts: string;
    trend: "up" | "down" | "stable";
  }

  // ── Reactive data from API ──
  let section1Videos: TrendingVideo[] = $state([]);
  let section2Videos: TrendingVideo[] = $state([]);
  let section1Tags: HotTag[] = $state([]);
  let section2Tags: HotTag[] = $state([]);
  let loading = $state(true);
  let collecting = $state(false);

  async function fetchTrends() {
    loading = true;
    try {
      // Platform 1: Douyin (zh) or Xiaohongshu as primary
      const [res1, res2] = await Promise.all([
        fetch("/api/trends/xiaohongshu"),
        fetch("/api/trends/douyin"),
      ]);
      if (res1.ok) {
        const data = await res1.json();
        section2Videos = data.videos ?? [];
        section2Tags = data.tags ?? [];
      }
      if (res2.ok) {
        const data = await res2.json();
        section1Videos = data.videos ?? [];
        section1Tags = data.tags ?? [];
      }
    } catch (_) {
      // silently fail - empty state will show
    } finally {
      loading = false;
    }
  }

  async function handleCollectNow() {
    collecting = true;
    try {
      const res = await fetch("/api/collector/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "research", platforms: ["xiaohongshu", "douyin"] }),
      });
      const data = await res.json();
      if (data.collected?.length > 0) {
        await fetchTrends();
      }
    } catch (_) {
      // ignore
    } finally {
      collecting = false;
    }
  }

  let hasData = $derived(
    section1Videos.length > 0 || section2Videos.length > 0 ||
    section1Tags.length > 0 || section2Tags.length > 0
  );

  onMount(() => {
    fetchTrends();
    const unsub = subscribe(() => { lang = getLanguage(); });
    return () => unsub();
  });
</script>

<div class="explore" data-lang={lang}>
  {#if loading}
    <div class="empty-state">
      <p class="empty-text">{tt("loading")}</p>
    </div>
  {:else if !hasData}
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p class="empty-title">{lang === "zh" ? "暂无趋势数据" : "No trend data yet"}</p>
      <p class="empty-desc">{lang === "zh" ? "点击下方按钮开始采集平台趋势数据。" : "Click the button below to start collecting platform trend data."}</p>
      <button class="collect-btn" onclick={handleCollectNow} disabled={collecting}>
        {collecting ? (lang === "zh" ? "采集中..." : "Collecting...") : (lang === "zh" ? "立即采集" : "Collect Now")}
      </button>
    </div>
  {:else}
    <div class="explore-grid">
      <!-- Section 1: 抖音热门视频 / Platform 1 Trending -->
      <div class="explore-section">
        <h3 class="section-title">
          {#if lang === "zh"}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fe2c55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
          {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="#ff0000" stroke="none"/></svg>
          {/if}
          {tt("ytTrending")}
        </h3>
        {#if section1Videos.length > 0}
          <div class="video-list">
            {#each section1Videos as video, i}
              <div class="video-card">
                <div class="video-rank">{i + 1}</div>
                {#if video.thumb}
                  <div class="video-thumb">
                    <img src={video.thumb} alt={video.title} loading="lazy" />
                  </div>
                {/if}
                <div class="video-info">
                  <span class="video-title">{video.title}</span>
                  <div class="video-stats">
                    <span>▶ {video.views}</span>
                    <span>♥ {video.likes}</span>
                    <span>💬 {video.comments}</span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="section-empty">{lang === "zh" ? "暂无数据" : "No data available"}</p>
        {/if}
      </div>

      <!-- Section 2: 小红书热门视频 / Platform 2 Trending -->
      <div class="explore-section">
        <h3 class="section-title">
          {#if lang === "zh"}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fe2c55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/></svg>
          {:else}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" stroke="#69c9d0"/></svg>
          {/if}
          {tt("ttTrending")}
        </h3>
        {#if section2Videos.length > 0}
          <div class="video-list">
            {#each section2Videos as video, i}
              <div class="video-card">
                <div class="video-rank">{i + 1}</div>
                {#if video.thumb}
                  <div class="video-thumb">
                    <img src={video.thumb} alt={video.title} loading="lazy" />
                  </div>
                {/if}
                <div class="video-info">
                  <span class="video-title">{video.title}</span>
                  <div class="video-stats">
                    <span>▶ {video.views}</span>
                    <span>♥ {video.likes}</span>
                    <span>💬 {video.comments}</span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="section-empty">{lang === "zh" ? "暂无数据" : "No data available"}</p>
        {/if}
      </div>

      <!-- Section 3: Hot Tags Platform 1 -->
      <div class="explore-section">
        <h3 class="section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={lang === "zh" ? "#fe2c55" : "#ff0000"} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
          {tt("ytTags")}
        </h3>
        {#if section1Tags.length > 0}
          <div class="tag-list">
            {#each section1Tags as tag, i}
              <div class="tag-row">
                <span class="tag-rank" class:top3={i < 3}>{i + 1}</span>
                <span class="tag-name">{tag.tag}</span>
                <span class="tag-posts">{tag.posts} {tt("posts")}</span>
                <span class="tag-trend" class:trend-up={tag.trend === "up"} class:trend-down={tag.trend === "down"}>
                  {#if tag.trend === "up"}↑{:else if tag.trend === "down"}↓{:else}—{/if}
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="section-empty">{lang === "zh" ? "暂无话题数据" : "No topic data available"}</p>
        {/if}
      </div>

      <!-- Section 4: Hot Tags Platform 2 -->
      <div class="explore-section">
        <h3 class="section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={lang === "zh" ? "#fe2c55" : "#69c9d0"} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
          {tt("ttTags")}
        </h3>
        {#if section2Tags.length > 0}
          <div class="tag-list">
            {#each section2Tags as tag, i}
              <div class="tag-row">
                <span class="tag-rank" class:top3={i < 3}>{i + 1}</span>
                <span class="tag-name">{tag.tag}</span>
                <span class="tag-posts">{tag.posts} {tt("posts")}</span>
                <span class="tag-trend" class:trend-up={tag.trend === "up"} class:trend-down={tag.trend === "down"}>
                  {#if tag.trend === "up"}↑{:else if tag.trend === "down"}↓{:else}—{/if}
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="section-empty">{lang === "zh" ? "暂无话题数据" : "No topic data available"}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .explore {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .explore-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.125rem;
  }

  @media (max-width: 768px) {
    .explore-grid { grid-template-columns: 1fr; }
  }

  .explore-section {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.125rem 1.25rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.92rem;
    font-weight: 700;
    margin-bottom: 0.875rem;
    letter-spacing: -0.015em;
  }

  .section-title svg {
    opacity: 0.85;
  }

  .section-empty {
    font-size: 0.82rem;
    color: var(--text-dim);
    font-weight: 500;
    padding: 1rem 0;
  }

  /* ── Empty State ─────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 4rem 2rem;
    text-align: center;
  }

  .empty-state svg {
    opacity: 0.4;
    margin-bottom: 0.5rem;
  }

  .empty-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .empty-desc {
    font-size: 0.85rem;
    color: var(--text-dim);
    font-weight: 500;
    max-width: 360px;
    line-height: 1.5;
  }

  .empty-text {
    font-size: 0.85rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .collect-btn {
    margin-top: 0.5rem;
    padding: 0.65rem 1.5rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.85rem;
    font-weight: 650;
    cursor: pointer;
    transition: opacity var(--transition-fast);
  }

  .collect-btn:hover { opacity: 0.9; }
  .collect-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  /* ── Video List ────────────────────────────────────────────────────── */
  .video-list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    max-height: 480px;
    overflow-y: auto;
  }

  .video-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem;
    border-radius: 10px;
    transition: background var(--transition-fast);
    cursor: pointer;
  }

  .video-card:hover { background: var(--bg-hover); }

  .video-rank {
    width: 22px;
    font-size: 0.72rem;
    font-weight: 750;
    color: var(--text-dim);
    text-align: center;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .video-card:nth-child(1) .video-rank,
  .video-card:nth-child(2) .video-rank,
  .video-card:nth-child(3) .video-rank {
    color: var(--accent);
  }

  .video-thumb {
    width: 76px;
    height: 46px;
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-surface);
  }

  .video-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform var(--transition-normal);
  }

  .video-card:hover .video-thumb img {
    transform: scale(1.05);
  }

  .video-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .video-title {
    font-size: 0.8rem;
    font-weight: 550;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }

  .video-stats {
    display: flex;
    gap: 0.7rem;
    font-size: 0.68rem;
    color: var(--text-dim);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  /* ── Tag List ──────────────────────────────────────────────────────── */
  .tag-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .tag-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.5rem;
    border-radius: 8px;
    transition: background var(--transition-fast);
    cursor: pointer;
  }

  .tag-row:hover { background: var(--bg-hover); }

  .tag-rank {
    width: 22px;
    font-size: 0.72rem;
    font-weight: 750;
    color: var(--text-dim);
    text-align: center;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .tag-rank.top3 { color: var(--accent); }

  .tag-name {
    flex: 1;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
  }

  .tag-posts {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .tag-trend {
    font-size: 0.78rem;
    font-weight: 750;
    width: 20px;
    text-align: center;
    color: var(--text-dim);
  }

  .tag-trend.trend-up { color: var(--success); }
  .tag-trend.trend-down { color: var(--error); }
</style>
