<script lang="ts">
  import { onMount, tick } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let { scrollToInsights = false }: { scrollToInsights?: boolean } = $props();

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }
  let insightsEl: HTMLElement | undefined = $state(undefined);

  // Mock user profile
  const profile = {
    avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=AutoViral",
    username: "@alex_creates",
    ttFollowers: "342K",
    todayLikes: "2,847",
    todayComments: "436",
  };

  // Style keywords
  const styleKeywords = [
    { text: "High-aesthetic sports blogger", textZh: "高颜值路线的运动博主" },
    { text: "Data-driven storytelling", textZh: "数据驱动型叙事" },
    { text: "Fast-paced editing", textZh: "快节奏剪辑风格" },
    { text: "Warm color grading", textZh: "暖色调调色" },
    { text: "Conversational tone", textZh: "对话式表达" },
  ];

  // Fan demographics
  const ageData = [
    { range: "13-17", pct: 8 },
    { range: "18-24", pct: 35 },
    { range: "25-34", pct: 32 },
    { range: "35-44", pct: 15 },
    { range: "45+", pct: 10 },
  ];

  const genderData = { male: 62, female: 38 };

  const topRegions = [
    { name: "United States", pct: 28 },
    { name: "China", pct: 18 },
    { name: "Japan", pct: 12 },
    { name: "Brazil", pct: 9 },
    { name: "Germany", pct: 7 },
    { name: "UK", pct: 6 },
  ];

  // Mock insights
  const insights = [
    { title: "Competitor gap: Tutorial content underserved in niche", date: "Mar 14", titleZh: "竞品空白: 教程类内容在垂直领域供不应求" },
    { title: "Your audience peak shifted to 8PM on weekdays", date: "Mar 13", titleZh: "你的受众活跃高峰已转移到工作日晚 8 点" },
    { title: "Shorts under 30s outperform longer ones by 2.3x", date: "Mar 12", titleZh: "30 秒以下短视频表现优于长视频 2.3 倍" },
    { title: "Warm color grading correlates with +18% retention", date: "Mar 11", titleZh: "暖色调调色与 +18% 完播率正相关" },
    { title: "Posting frequency sweet spot: 4-5 times per week", date: "Mar 10", titleZh: "发布频率最佳点: 每周 4-5 次" },
    { title: "Trending audio usage boosts reach by 40%", date: "Mar 9", titleZh: "使用热门音频可提升 40% 曝光量" },
    { title: "Hook within first 1.5s critical for TikTok retention", date: "Mar 8", titleZh: "TikTok 前 1.5 秒的钩子对完播率至关重要" },
  ];

  onMount(async () => {
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
  <!-- Profile Header -->
  <div class="profile-card">
    <div class="profile-top">
      <img class="avatar" src={profile.avatar} alt="avatar" />
      <div class="profile-identity">
        <span class="username">{profile.username}</span>
        <div class="platform-followers">
          <span class="pf-badge tt">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
            {profile.ttFollowers}
          </span>
        </div>
      </div>
      <div class="profile-stats">
        <div class="stat-item">
          <span class="stat-num">{profile.todayLikes}</span>
          <span class="stat-label">{tt("todayLikes")}</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <span class="stat-num">{profile.todayComments}</span>
          <span class="stat-label">{tt("todayComments")}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Style Keywords -->
  <div class="style-section">
    <h3 class="sec-title">{tt("styleKeywords")}</h3>
    <div class="keyword-chips">
      {#each styleKeywords as kw}
        <span class="keyword-chip">{lang === "zh" ? kw.textZh : kw.text}</span>
      {/each}
    </div>
  </div>

  <!-- Fan Demographics -->
  <div class="demo-section">
    <h3 class="sec-title">{tt("fanDemographics")}</h3>
    <div class="demo-grid">
      <!-- Age Distribution -->
      <div class="demo-card">
        <h4>{tt("ageDistribution")}</h4>
        <div class="bar-chart">
          {#each ageData as age}
            <div class="bar-row">
              <span class="bar-label">{age.range}</span>
              <div class="bar-track">
                <div class="bar-fill" style="width: {age.pct}%"></div>
              </div>
              <span class="bar-pct">{age.pct}%</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Gender Split -->
      <div class="demo-card">
        <h4>{tt("genderSplit")}</h4>
        <div class="gender-visual">
          <div class="gender-bar">
            <div class="gender-male" style="width: {genderData.male}%"></div>
            <div class="gender-female" style="width: {genderData.female}%"></div>
          </div>
          <div class="gender-legend">
            <span class="gender-item male-item">
              <span class="gender-dot male-dot"></span>
              {tt("male")} {genderData.male}%
            </span>
            <span class="gender-item female-item">
              <span class="gender-dot female-dot"></span>
              {tt("female")} {genderData.female}%
            </span>
          </div>
        </div>
      </div>

      <!-- Top Regions -->
      <div class="demo-card">
        <h4>{tt("topRegions")}</h4>
        <div class="bar-chart">
          {#each topRegions as region}
            <div class="bar-row">
              <span class="bar-label region-label">{region.name}</span>
              <div class="bar-track">
                <div class="bar-fill accent" style="width: {region.pct * 3}%"></div>
              </div>
              <span class="bar-pct">{region.pct}%</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <!-- Research Stats -->
  <div class="research-stats-section">
    <h3 class="sec-title">{tt("researchStats")}</h3>
    <div class="stats-grid">
      <div class="rs-card">
        <span class="rs-num">1,247</span>
        <span class="rs-label">{tt("totalResearched")}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">86</span>
        <span class="rs-label">{tt("insightsGenerated")}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">23</span>
        <span class="rs-label">{tt("worksCreated")}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">{lang === "zh" ? "2小时前" : "2h ago"}</span>
        <span class="rs-label">{tt("lastResearchTime")}</span>
      </div>
    </div>
  </div>

  <!-- Latest Insights -->
  <div class="insights-section" bind:this={insightsEl}>
    <h3 class="sec-title">{tt("latestInsights")}</h3>
    <div class="insights-list">
      {#each insights as insight}
        <div class="insight-row">
          <div class="insight-dot"></div>
          <div class="insight-body">
            <span class="insight-title">{lang === "zh" ? insight.titleZh : insight.title}</span>
            <span class="insight-date">{insight.date}</span>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .analytics {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .sec-title {
    font-size: 0.92rem;
    font-weight: 700;
    margin-bottom: 0.875rem;
    letter-spacing: -0.015em;
    color: var(--text);
  }

  /* ── Profile Card ──────────────────────────────────────────────────── */
  .profile-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.5rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .profile-top {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }

  .avatar {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: var(--bg-surface);
    flex-shrink: 0;
    border: 2.5px solid var(--border);
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }

  .profile-identity {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .username {
    font-size: 1.2rem;
    font-weight: 750;
    letter-spacing: -0.025em;
  }

  .platform-followers {
    display: flex;
    gap: 0.5rem;
  }

  .pf-badge {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    font-weight: 650;
    padding: 0.25rem 0.7rem;
    border-radius: 9999px;
    color: #fff;
    transition: transform var(--transition-fast);
  }

  .pf-badge:hover {
    transform: scale(1.03);
  }

  .pf-badge.tt { background: linear-gradient(135deg, #25f4ee, #fe2c55); color: #fff; }
  .pf-badge.tt svg { stroke: #fff; }

  .profile-stats {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    flex-shrink: 0;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }

  .stat-num {
    font-size: 1.25rem;
    font-weight: 750;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    font-size: 0.65rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 550;
  }

  .stat-divider {
    width: 1px;
    height: 36px;
    background: var(--border);
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

  /* ── Demographics ──────────────────────────────────────────────────── */
  .demo-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.875rem;
  }

  @media (max-width: 768px) {
    .demo-grid { grid-template-columns: 1fr; }
  }

  .demo-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
    padding: 1.125rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .demo-card h4 {
    font-size: 0.72rem;
    font-weight: 650;
    color: var(--text-dim);
    margin-bottom: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* Bar chart */
  .bar-chart {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .bar-label {
    width: 36px;
    font-size: 0.72rem;
    color: var(--text-muted);
    font-weight: 550;
    flex-shrink: 0;
  }

  .region-label {
    width: 72px;
    font-size: 0.72rem;
  }

  .bar-track {
    flex: 1;
    height: 7px;
    background: var(--bg-surface);
    border-radius: 4px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: var(--info);
    border-radius: 4px;
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .bar-fill.accent {
    background: var(--accent);
  }

  .bar-pct {
    width: 32px;
    font-size: 0.72rem;
    font-weight: 650;
    color: var(--text-secondary);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* Gender */
  .gender-visual {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .gender-bar {
    display: flex;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
    gap: 2px;
  }

  .gender-male { background: #60a5fa; border-radius: 5px 0 0 5px; }
  .gender-female { background: #f472b6; border-radius: 0 5px 5px 0; }

  .gender-legend {
    display: flex;
    gap: 1.25rem;
  }

  .gender-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .gender-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .male-dot { background: #60a5fa; }
  .female-dot { background: #f472b6; }

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

  .insight-date {
    font-size: 0.7rem;
    color: var(--text-dim);
    font-weight: 500;
  }
</style>
