<script lang="ts">
  import { onMount, tick } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";

  let { scrollToInsights = false }: { scrollToInsights?: boolean } = $props();

  let lang = $state(getLanguage());
  let insightsEl: HTMLElement | undefined = $state(undefined);

  // Mock user profile
  const profile = {
    avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=CreatorPilot",
    username: "@alex_creates",
    ytFollowers: "128K",
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
          <span class="pf-badge yt">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="#fff" stroke="none"/></svg>
            {profile.ytFollowers}
          </span>
          <span class="pf-badge tt">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
            {profile.ttFollowers}
          </span>
        </div>
      </div>
      <div class="profile-stats">
        <div class="stat-item">
          <span class="stat-num">{profile.todayLikes}</span>
          <span class="stat-label">{t("todayLikes")}</span>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <span class="stat-num">{profile.todayComments}</span>
          <span class="stat-label">{t("todayComments")}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Style Keywords -->
  <div class="style-section">
    <h3 class="sec-title">{t("styleKeywords")}</h3>
    <div class="keyword-chips">
      {#each styleKeywords as kw}
        <span class="keyword-chip">{lang === "zh" ? kw.textZh : kw.text}</span>
      {/each}
    </div>
  </div>

  <!-- Fan Demographics -->
  <div class="demo-section">
    <h3 class="sec-title">{t("fanDemographics")}</h3>
    <div class="demo-grid">
      <!-- Age Distribution -->
      <div class="demo-card">
        <h4>{t("ageDistribution")}</h4>
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
        <h4>{t("genderSplit")}</h4>
        <div class="gender-visual">
          <div class="gender-bar">
            <div class="gender-male" style="width: {genderData.male}%"></div>
            <div class="gender-female" style="width: {genderData.female}%"></div>
          </div>
          <div class="gender-legend">
            <span class="gender-item male-item">
              <span class="gender-dot male-dot"></span>
              {t("male")} {genderData.male}%
            </span>
            <span class="gender-item female-item">
              <span class="gender-dot female-dot"></span>
              {t("female")} {genderData.female}%
            </span>
          </div>
        </div>
      </div>

      <!-- Top Regions -->
      <div class="demo-card">
        <h4>{t("topRegions")}</h4>
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
    <h3 class="sec-title">{t("researchStats")}</h3>
    <div class="stats-grid">
      <div class="rs-card">
        <span class="rs-num">1,247</span>
        <span class="rs-label">{t("totalResearched")}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">86</span>
        <span class="rs-label">{t("insightsGenerated")}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">23</span>
        <span class="rs-label">{t("worksCreated")}</span>
      </div>
      <div class="rs-card">
        <span class="rs-num">2h ago</span>
        <span class="rs-label">{t("lastResearchTime")}</span>
      </div>
    </div>
  </div>

  <!-- Latest Insights -->
  <div class="insights-section" bind:this={insightsEl}>
    <h3 class="sec-title">{t("latestInsights")}</h3>
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
    gap: 1.25rem;
  }

  .sec-title {
    font-size: 0.9rem;
    font-weight: 650;
    margin-bottom: 0.75rem;
    letter-spacing: -0.01em;
  }

  /* ── Profile Card ──────────────────────────────────────────────────── */
  .profile-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1.25rem;
    box-shadow: var(--shadow-sm);
  }

  .profile-top {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--bg-surface);
    flex-shrink: 0;
    border: 2px solid var(--border);
  }

  .profile-identity {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .username {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
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
    font-weight: 600;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    color: #fff;
  }

  .pf-badge.yt { background: #cc0000; }
  .pf-badge.tt { background: #25f4ee; color: #000; }
  .pf-badge.tt svg { stroke: #000; }

  .profile-stats {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-shrink: 0;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }

  .stat-num {
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    font-size: 0.68rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .stat-divider {
    width: 1px;
    height: 32px;
    background: var(--border);
  }

  /* ── Style Keywords ────────────────────────────────────────────────── */
  .style-section {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.125rem;
    box-shadow: var(--shadow-sm);
  }

  .keyword-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .keyword-chip {
    font-size: 0.82rem;
    font-weight: 550;
    padding: 0.4rem 0.9rem;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid transparent;
    transition: all 0.15s;
  }

  .keyword-chip:first-child {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 650;
  }

  /* ── Demographics ──────────────────────────────────────────────────── */
  .demo-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.75rem;
  }

  @media (max-width: 768px) {
    .demo-grid { grid-template-columns: 1fr; }
  }

  .demo-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem;
    box-shadow: var(--shadow-sm);
  }

  .demo-card h4 {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* Bar chart */
  .bar-chart {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
    height: 8px;
    background: var(--bg-surface);
    border-radius: 4px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    background: var(--info);
    border-radius: 4px;
    transition: width 0.5s ease;
  }

  .bar-fill.accent {
    background: var(--accent);
  }

  .bar-pct {
    width: 32px;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* Gender */
  .gender-visual {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .gender-bar {
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
  }

  .gender-male { background: #60a5fa; }
  .gender-female { background: #f472b6; }

  .gender-legend {
    display: flex;
    gap: 1rem;
  }

  .gender-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    font-weight: 550;
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
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.125rem;
    box-shadow: var(--shadow-sm);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
  }

  @media (max-width: 640px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
  }

  .rs-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 0.875rem 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    text-align: center;
  }

  .rs-num {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .rs-label {
    font-size: 0.7rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* ── Insights ──────────────────────────────────────────────────────── */
  .insights-section {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.125rem;
    box-shadow: var(--shadow-sm);
  }

  .insights-list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .insight-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.65rem 0.4rem;
    border-radius: 8px;
    transition: background 0.15s;
    cursor: pointer;
  }

  .insight-row:hover { background: var(--bg-hover); }

  .insight-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    margin-top: 0.35rem;
  }

  .insight-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .insight-title {
    font-size: 0.85rem;
    font-weight: 550;
    color: var(--text);
    line-height: 1.45;
  }

  .insight-date {
    font-size: 0.7rem;
    color: var(--text-dim);
  }
</style>
