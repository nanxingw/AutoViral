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

  // ── English data: YouTube + TikTok ──
  const ytVideosEn: TrendingVideo[] = [
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

  const ttVideosEn: TrendingVideo[] = [
    { title: "POV: Your cat is the chef now", thumb: "https://i.ytimg.com/vi/SMVik2fUfLM/hq720.jpg", views: "45M", likes: "4.2M", comments: "89K" },
    { title: "This outfit hack changed everything", thumb: "https://i.ytimg.com/vi/BGV_0lWOPYQ/hq720.jpg", views: "32M", likes: "3.1M", comments: "67K" },
    { title: "Wait for it... #satisfying", thumb: "https://i.ytimg.com/vi/3qRGiME7ic4/hq720.jpg", views: "28M", likes: "2.8M", comments: "54K" },
    { title: "Day in my life as a coffee barista", thumb: "https://i.ytimg.com/vi/Q1JzIkp_DC0/hq720.jpg", views: "22M", likes: "2.3M", comments: "45K" },
    { title: "Things that just make sense", thumb: "https://i.ytimg.com/vi/gVtLPCgIXv4/hq720.jpg", views: "19M", likes: "1.9M", comments: "38K" },
    { title: "Gym transformation in 90 days", thumb: "https://i.ytimg.com/vi/WIkC4OJEx3c/hq720.jpg", views: "16M", likes: "1.6M", comments: "32K" },
    { title: "How to make cloud bread at home", thumb: "https://i.ytimg.com/vi/rDnKs1CXkk4/hq720.jpg", views: "14M", likes: "1.4M", comments: "28K" },
    { title: "My dog's reaction to magic tricks", thumb: "https://i.ytimg.com/vi/AkH4kP_LsbI/hq720.jpg", views: "12M", likes: "1.2M", comments: "24K" },
    { title: "Decluttering my entire apartment", thumb: "https://i.ytimg.com/vi/E9wGJF8AJEY/hq720.jpg", views: "9.5M", likes: "980K", comments: "19K" },
    { title: "POV: You're the main character", thumb: "https://i.ytimg.com/vi/4d8o4aVBREc/hq720.jpg", views: "8.2M", likes: "850K", comments: "17K" },
  ];

  const ytTagsEn: HotTag[] = [
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

  const ttTagsEn: HotTag[] = [
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

  // ── Chinese data: 抖音 + 小红书 ──
  const douyinVideos: TrendingVideo[] = [
    { title: "挑战100天健身变形记，结局太震撼了", thumb: "https://i.ytimg.com/vi/WIkC4OJEx3c/hq720.jpg", views: "3200万", likes: "186万", comments: "8.2万" },
    { title: "一个人穷游西藏30天，花了多少钱？", thumb: "https://i.ytimg.com/vi/JpLFn2_2V8M/hq720.jpg", views: "2800万", likes: "152万", comments: "6.7万" },
    { title: "全网最解压的工厂流水线合集", thumb: "https://i.ytimg.com/vi/3qRGiME7ic4/hq720.jpg", views: "2400万", likes: "134万", comments: "5.1万" },
    { title: "月薪3千和月薪3万的早餐区别", thumb: "https://i.ytimg.com/vi/OM3Z_Cc7wJY/hq720.jpg", views: "1900万", likes: "98万", comments: "4.3万" },
    { title: "当代大学生的宿舍改造有多离谱", thumb: "https://i.ytimg.com/vi/lHGgMOT1gGM/hq720.jpg", views: "1600万", likes: "87万", comments: "3.8万" },
    { title: "教你三招拍出电影感vlog", thumb: "https://i.ytimg.com/vi/k2h2DrPG-3c/hq720.jpg", views: "1200万", likes: "72万", comments: "2.9万" },
    { title: "在家做出比餐厅还好吃的牛排", thumb: "https://i.ytimg.com/vi/lzAk5wAImFQ/hq720.jpg", views: "980万", likes: "65万", comments: "2.4万" },
    { title: "24小时挑战只花10块钱生活", thumb: "https://i.ytimg.com/vi/krsBRQlAFbY/hq720.jpg", views: "860万", likes: "54万", comments: "1.8万" },
    { title: "街头随机采访路人的存款金额", thumb: "https://i.ytimg.com/vi/3tmd-ClpJxA/hq720.jpg", views: "750万", likes: "48万", comments: "1.5万" },
    { title: "用100块改造出租屋，房东看了都沉默", thumb: "https://i.ytimg.com/vi/N7S2eqQaGBk/hq720.jpg", views: "620万", likes: "41万", comments: "1.2万" },
  ];

  const xhsVideos: TrendingVideo[] = [
    { title: "绝绝子！这个穿搭也太显瘦了吧", thumb: "https://i.ytimg.com/vi/BGV_0lWOPYQ/hq720.jpg", views: "520万", likes: "38万", comments: "2.1万" },
    { title: "上海探店｜藏在弄堂里的宝藏咖啡馆", thumb: "https://i.ytimg.com/vi/Q1JzIkp_DC0/hq720.jpg", views: "480万", likes: "35万", comments: "1.8万" },
    { title: "跟着我的护肤步骤做，一周见效", thumb: "https://i.ytimg.com/vi/gVtLPCgIXv4/hq720.jpg", views: "420万", likes: "31万", comments: "1.6万" },
    { title: "租房改造｜3000块打造ins风小窝", thumb: "https://i.ytimg.com/vi/N7S2eqQaGBk/hq720.jpg", views: "380万", likes: "28万", comments: "1.4万" },
    { title: "减脂餐不用难吃！7天食谱分享", thumb: "https://i.ytimg.com/vi/lzAk5wAImFQ/hq720.jpg", views: "350万", likes: "26万", comments: "1.2万" },
    { title: "通勤妆5分钟搞定，手残党必看", thumb: "https://i.ytimg.com/vi/SMVik2fUfLM/hq720.jpg", views: "310万", likes: "23万", comments: "9800" },
    { title: "日本药妆店必买清单2026版", thumb: "https://i.ytimg.com/vi/E9wGJF8AJEY/hq720.jpg", views: "280万", likes: "21万", comments: "8500" },
    { title: "宝藏平价好物分享｜全部百元以下", thumb: "https://i.ytimg.com/vi/AkH4kP_LsbI/hq720.jpg", views: "240万", likes: "18万", comments: "7200" },
    { title: "这条徒步路线美哭了，强烈推荐", thumb: "https://i.ytimg.com/vi/JpLFn2_2V8M/hq720.jpg", views: "210万", likes: "16万", comments: "6100" },
    { title: "高颜值便当｜带饭上班的快乐", thumb: "https://i.ytimg.com/vi/rDnKs1CXkk4/hq720.jpg", views: "180万", likes: "14万", comments: "5200" },
  ];

  const douyinTags: HotTag[] = [
    { tag: "#抖音热门", posts: "680亿", trend: "stable" },
    { tag: "#记录生活", posts: "420亿", trend: "up" },
    { tag: "#变装", posts: "310亿", trend: "up" },
    { tag: "#美食教程", posts: "280亿", trend: "up" },
    { tag: "#健身打卡", posts: "190亿", trend: "up" },
    { tag: "#旅行vlog", posts: "150亿", trend: "stable" },
    { tag: "#穿搭分享", posts: "130亿", trend: "up" },
    { tag: "#搞笑日常", posts: "110亿", trend: "stable" },
    { tag: "#知识分享", posts: "89亿", trend: "up" },
    { tag: "#手工制作", posts: "72亿", trend: "down" },
  ];

  const xhsTags: HotTag[] = [
    { tag: "#今日穿搭", posts: "52亿", trend: "up" },
    { tag: "#好物分享", posts: "48亿", trend: "up" },
    { tag: "#护肤心得", posts: "35亿", trend: "stable" },
    { tag: "#探店打卡", posts: "31亿", trend: "up" },
    { tag: "#减脂餐", posts: "24亿", trend: "up" },
    { tag: "#家居改造", posts: "19亿", trend: "up" },
    { tag: "#旅行攻略", posts: "16亿", trend: "stable" },
    { tag: "#妆容教程", posts: "14亿", trend: "up" },
    { tag: "#职场干货", posts: "11亿", trend: "up" },
    { tag: "#摄影技巧", posts: "8.5亿", trend: "stable" },
  ];

  // ── Reactive data selection ──
  let section1Videos = $derived(lang === "zh" ? douyinVideos : ytVideosEn);
  let section2Videos = $derived(lang === "zh" ? xhsVideos : ttVideosEn);
  let section1Tags = $derived(lang === "zh" ? douyinTags : ytTagsEn);
  let section2Tags = $derived(lang === "zh" ? xhsTags : ttTagsEn);

  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    return () => unsub();
  });
</script>

<div class="explore" data-lang={lang}>
  <div class="explore-grid">
    <!-- Section 1: YouTube Trending / 抖音热门视频 -->
    <div class="explore-section">
      <h3 class="section-title">
        {#if lang === "zh"}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fe2c55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff0000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="#ff0000" stroke="none"/></svg>
        {/if}
        {tt("ytTrending")}
      </h3>
      <div class="video-list">
        {#each section1Videos as video, i}
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

    <!-- Section 2: TikTok Trending / 小红书热门视频 -->
    <div class="explore-section">
      <h3 class="section-title">
        {#if lang === "zh"}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fe2c55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/></svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" stroke="#69c9d0"/></svg>
        {/if}
        {tt("ttTrending")}
      </h3>
      <div class="video-list">
        {#each section2Videos as video, i}
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

    <!-- Section 3: YouTube Hot Tags / 抖音热门话题 -->
    <div class="explore-section">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={lang === "zh" ? "#fe2c55" : "#ff0000"} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
        {tt("ytTags")}
      </h3>
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
    </div>

    <!-- Section 4: TikTok Hot Tags / 小红书热门话题 -->
    <div class="explore-section">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={lang === "zh" ? "#fe2c55" : "#69c9d0"} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
        {tt("ttTags")}
      </h3>
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
    </div>
  </div>
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
