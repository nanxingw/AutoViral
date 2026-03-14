<script lang="ts">
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { onMount } from "svelte";

  let lang = $state(getLanguage());

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

  const ytVideos: TrendingVideo[] = [
    { title: "I Mass Produced Custom Keyboards for 100 People", thumb: "https://i.ytimg.com/vi/lHGgMOT1gGM/hq720.jpg", views: "18M", likes: "892K", comments: "34K" },
    { title: "World's Most Dangerous Bridges", thumb: "https://i.ytimg.com/vi/QfFOm4rMER0/hq720.jpg", views: "14M", likes: "651K", comments: "28K" },
    { title: "I Built a $1 vs $1,000,000 House!", thumb: "https://i.ytimg.com/vi/krsBRQlAFbY/hq720.jpg", views: "12M", likes: "540K", comments: "22K" },
    { title: "Surviving 24 Hours in the Wilderness", thumb: "https://i.ytimg.com/vi/JpLFn2_2V8M/hq720.jpg", views: "9.8M", likes: "478K", comments: "19K" },
    { title: "Testing Every Fast Food Breakfast", thumb: "https://i.ytimg.com/vi/OM3Z_Cc7wJY/hq720.jpg", views: "8.5M", likes: "412K", comments: "16K" },
    { title: "I Turned My House Into a Water Park", thumb: "https://i.ytimg.com/vi/N7S2eqQaGBk/hq720.jpg", views: "7.2M", likes: "389K", comments: "14K" },
    { title: "Making the Perfect Pizza from Scratch", thumb: "https://i.ytimg.com/vi/lzAk5wAImFQ/hq720.jpg", views: "6.1M", likes: "345K", comments: "12K" },
    { title: "I Lived Like a Billionaire for a Day", thumb: "https://i.ytimg.com/vi/k2h2DrPG-3c/hq720.jpg", views: "5.5M", likes: "298K", comments: "11K" },
    { title: "Every Country's Best Street Food", thumb: "https://i.ytimg.com/vi/3tmd-ClpJxA/hq720.jpg", views: "4.9M", likes: "267K", comments: "9.8K" },
    { title: "Building a Treehouse in 24 Hours", thumb: "https://i.ytimg.com/vi/p0NaQHJGA5M/hq720.jpg", views: "4.3M", likes: "234K", comments: "8.5K" },
  ];

  const ttVideos: TrendingVideo[] = [
    { title: "POV: Your cat is the chef now 🐱👨‍🍳", thumb: "https://i.ytimg.com/vi/SMVik2fUfLM/hq720.jpg", views: "45M", likes: "4.2M", comments: "89K" },
    { title: "This outfit hack changed everything", thumb: "https://i.ytimg.com/vi/BGV_0lWOPYQ/hq720.jpg", views: "32M", likes: "3.1M", comments: "67K" },
    { title: "Wait for it... 😱 #satisfying", thumb: "https://i.ytimg.com/vi/3qRGiME7ic4/hq720.jpg", views: "28M", likes: "2.8M", comments: "54K" },
    { title: "Day in my life as a coffee barista", thumb: "https://i.ytimg.com/vi/Q1JzIkp_DC0/hq720.jpg", views: "22M", likes: "2.3M", comments: "45K" },
    { title: "Things that just make sense ✨", thumb: "https://i.ytimg.com/vi/gVtLPCgIXv4/hq720.jpg", views: "19M", likes: "1.9M", comments: "38K" },
    { title: "Gym transformation in 90 days 💪", thumb: "https://i.ytimg.com/vi/WIkC4OJEx3c/hq720.jpg", views: "16M", likes: "1.6M", comments: "32K" },
    { title: "How to make cloud bread at home", thumb: "https://i.ytimg.com/vi/rDnKs1CXkk4/hq720.jpg", views: "14M", likes: "1.4M", comments: "28K" },
    { title: "My dog's reaction to magic tricks", thumb: "https://i.ytimg.com/vi/AkH4kP_LsbI/hq720.jpg", views: "12M", likes: "1.2M", comments: "24K" },
    { title: "Decluttering my entire apartment", thumb: "https://i.ytimg.com/vi/E9wGJF8AJEY/hq720.jpg", views: "9.5M", likes: "980K", comments: "19K" },
    { title: "POV: You're the main character 🎬", thumb: "https://i.ytimg.com/vi/4d8o4aVBREc/hq720.jpg", views: "8.2M", likes: "850K", comments: "17K" },
  ];

  const ytTags: HotTag[] = [
    { tag: "#shorts", posts: "1.2B", trend: "up" },
    { tag: "#challenge", posts: "890M", trend: "up" },
    { tag: "#vlog", posts: "670M", trend: "stable" },
    { tag: "#tutorial", posts: "540M", trend: "up" },
    { tag: "#gaming", posts: "480M", trend: "stable" },
    { tag: "#cooking", posts: "320M", trend: "up" },
    { tag: "#fitness", posts: "280M", trend: "up" },
    { tag: "#travel", posts: "250M", trend: "down" },
    { tag: "#diy", posts: "210M", trend: "stable" },
    { tag: "#music", posts: "190M", trend: "stable" },
  ];

  const ttTags: HotTag[] = [
    { tag: "#fyp", posts: "2.1T", trend: "stable" },
    { tag: "#foryou", posts: "1.8T", trend: "stable" },
    { tag: "#viral", posts: "980B", trend: "up" },
    { tag: "#ootd", posts: "450B", trend: "up" },
    { tag: "#grwm", posts: "380B", trend: "up" },
    { tag: "#aesthetic", posts: "320B", trend: "up" },
    { tag: "#storytime", posts: "280B", trend: "stable" },
    { tag: "#lifehack", posts: "240B", trend: "up" },
    { tag: "#foodtok", posts: "210B", trend: "up" },
    { tag: "#booktok", posts: "180B", trend: "stable" },
  ];

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return () => unsub();
  });
</script>

<div class="explore" data-lang={lang}>
  <!-- YouTube Trending + TikTok Trending -->
  <div class="explore-grid">
    <!-- YouTube Trending Videos -->
    <div class="explore-section">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="#ff0000" stroke="none"/></svg>
        {t("ytTrending")}
      </h3>
      <div class="video-list">
        {#each ytVideos as video, i}
          <div class="video-card">
            <div class="video-rank">{i + 1}</div>
            <div class="video-thumb">
              <img src={video.thumb} alt={video.title} loading="lazy" />
            </div>
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
    </div>

    <!-- TikTok Trending Videos -->
    <div class="explore-section">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" stroke="#69c9d0"/></svg>
        {t("ttTrending")}
      </h3>
      <div class="video-list">
        {#each ttVideos as video, i}
          <div class="video-card">
            <div class="video-rank">{i + 1}</div>
            <div class="video-thumb">
              <img src={video.thumb} alt={video.title} loading="lazy" />
            </div>
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
    </div>

    <!-- YouTube Hot Tags -->
    <div class="explore-section">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
        {t("ytTags")}
      </h3>
      <div class="tag-list">
        {#each ytTags as tag, i}
          <div class="tag-row">
            <span class="tag-rank" class:top3={i < 3}>{i + 1}</span>
            <span class="tag-name">{tag.tag}</span>
            <span class="tag-posts">{tag.posts} {t("posts")}</span>
            <span class="tag-trend" class:trend-up={tag.trend === "up"} class:trend-down={tag.trend === "down"}>
              {#if tag.trend === "up"}↑{:else if tag.trend === "down"}↓{:else}—{/if}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- TikTok Hot Tags -->
    <div class="explore-section">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#69c9d0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
        {t("ttTags")}
      </h3>
      <div class="tag-list">
        {#each ttTags as tag, i}
          <div class="tag-row">
            <span class="tag-rank" class:top3={i < 3}>{i + 1}</span>
            <span class="tag-name">{tag.tag}</span>
            <span class="tag-posts">{tag.posts} {t("posts")}</span>
            <span class="tag-trend" class:trend-up={tag.trend === "up"} class:trend-down={tag.trend === "down"}>
              {#if tag.trend === "up"}↑{:else if tag.trend === "down"}↓{:else}—{/if}
            </span>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .explore {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .explore-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  @media (max-width: 768px) {
    .explore-grid { grid-template-columns: 1fr; }
  }

  .explore-section {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem;
    box-shadow: var(--shadow-sm);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 650;
    margin-bottom: 0.75rem;
    letter-spacing: -0.01em;
  }

  /* ── Video List ────────────────────────────────────────────────────── */
  .video-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 480px;
    overflow-y: auto;
  }

  .video-card {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.4rem;
    border-radius: 8px;
    transition: background 0.15s;
    cursor: pointer;
  }

  .video-card:hover { background: var(--bg-hover); }

  .video-rank {
    width: 22px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-dim);
    text-align: center;
    flex-shrink: 0;
  }

  .video-card:nth-child(1) .video-rank,
  .video-card:nth-child(2) .video-rank,
  .video-card:nth-child(3) .video-rank {
    color: var(--accent);
  }

  .video-thumb {
    width: 72px;
    height: 44px;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-surface);
  }

  .video-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .video-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .video-title {
    font-size: 0.78rem;
    font-weight: 550;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .video-stats {
    display: flex;
    gap: 0.6rem;
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  /* ── Tag List ──────────────────────────────────────────────────────── */
  .tag-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tag-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.4rem;
    border-radius: 6px;
    transition: background 0.15s;
    cursor: pointer;
  }

  .tag-row:hover { background: var(--bg-hover); }

  .tag-rank {
    width: 22px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-dim);
    text-align: center;
    flex-shrink: 0;
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
  }

  .tag-trend {
    font-size: 0.78rem;
    font-weight: 700;
    width: 18px;
    text-align: center;
    color: var(--text-dim);
  }

  .tag-trend.trend-up { color: var(--success); }
  .tag-trend.trend-down { color: var(--error); }
</style>
