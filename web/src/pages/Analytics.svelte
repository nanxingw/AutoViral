<script lang="ts">
  import { onMount } from "svelte";

  // ── Types ──────────────────────────────────────────────────────────────────
  interface AccountInfo {
    nickname: string;
    follower_count: number;
    following_count: number;
    total_favorited: number;
    aweme_count: number;
  }

  interface WorkItem {
    desc: string;
    create_time: number | string;
    play_count: number;
    digg_count: number;
    comment_count: number;
    share_count: number;
    collect_count: number;
  }

  interface Summary {
    total_works_collected: number;
    avg_play: number;
    avg_digg: number;
    avg_comment: number;
    avg_share: number;
    avg_collect: number;
    engagement_rate: number;
  }

  interface CreatorData {
    platform: string;
    collected_at: string;
    account: AccountInfo;
    works: WorkItem[];
    summary: Summary;
  }

  interface Delta {
    followers?: number;
    favorited?: number;
  }

  interface ApiResponse {
    configured: boolean;
    data?: CreatorData;
    delta?: Delta;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let loading = $state(true);
  let configured = $state(false);
  let creatorData = $state<CreatorData | null>(null);
  let delta = $state<Delta>({});
  let douyinUrlInput = $state("");
  let savingUrl = $state(false);
  let saveMsg = $state("");
  let sortCol = $state<keyof WorkItem>("play_count");
  let sortAsc = $state(false);
  let showUrlEdit = $state(false);
  let editUrlValue = $state("");

  // ── Derived ────────────────────────────────────────────────────────────────
  let sortedWorks = $derived(
    creatorData
      ? [...creatorData.works].sort((a, b) => {
          const va = a[sortCol] as number;
          const vb = b[sortCol] as number;
          return sortAsc ? va - vb : vb - va;
        })
      : []
  );

  let maxPlay = $derived(
    sortedWorks.length > 0 ? Math.max(...sortedWorks.map(w => w.play_count)) : 1
  );

  // ── Utilities ──────────────────────────────────────────────────────────────
  function fmtNum(n: number): string {
    if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "亿";
    if (n >= 10_000) return (n / 10_000).toFixed(1) + "万";
    return n.toLocaleString();
  }

  function fmtPct(n: number): string {
    return (n * 100).toFixed(1) + "%";
  }

  function fmtDate(ts: number | string): string {
    if (!ts) return "-";
    // Handle both unix timestamp (number) and date string ("2026-02-27 16:21:44")
    const d = typeof ts === "string" ? new Date(ts.replace(" ", "T")) : new Date(ts * 1000);
    if (isNaN(d.getTime())) return "-";
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} 小时前`;
    return `${Math.floor(hrs / 24)} 天前`;
  }

  function engagementColor(rate: number): string {
    if (rate >= 0.05) return "var(--success)";
    if (rate >= 0.02) return "#f59e0b";
    return "var(--error)";
  }

  function deltaClass(v: number | undefined): string {
    if (!v) return "neutral";
    return v > 0 ? "up" : "down";
  }

  function deltaLabel(v: number | undefined): string {
    if (v === undefined || v === null) return "";
    const abs = Math.abs(v);
    return (v > 0 ? "↑" : "↓") + fmtNum(abs);
  }

  function toggleSort(col: keyof WorkItem) {
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = false;
    }
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadAnalytics() {
    loading = true;
    try {
      const res = await fetch("/api/analytics/creator");
      if (!res.ok) throw new Error("fetch failed");
      const body: ApiResponse = await res.json();
      configured = body.configured;
      creatorData = body.data ?? null;
      delta = body.delta ?? {};
    } catch {
      configured = false;
      creatorData = null;
    } finally {
      loading = false;
    }
  }

  async function saveDouyinUrl() {
    if (!douyinUrlInput.trim()) return;
    savingUrl = true;
    saveMsg = "";
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ douyinUrl: douyinUrlInput.trim() }),
      });
      if (!res.ok) throw new Error();
      saveMsg = "已保存，正在采集数据…";
      await loadAnalytics();
    } catch {
      saveMsg = "保存失败，请重试";
    } finally {
      savingUrl = false;
    }
  }

  onMount(() => {
    loadAnalytics();
  });
</script>

<!-- ─────────────────────────────────────────────────────────────────────── -->

{#if loading}
  <div class="center-state">
    <div class="spinner"></div>
    <span class="hint-text">加载中…</span>
  </div>

{:else if !configured || !creatorData}
  <!-- ── Empty / Not-configured state ───────────────────────────────────── -->
  <div class="empty-state">
    <div class="empty-illo">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="40" r="38" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.3"/>
        <circle cx="40" cy="40" r="26" fill="var(--accent-soft)"/>
        <path d="M28 46 C28 36 52 36 52 46" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
        <circle cx="33" cy="35" r="3" fill="var(--accent)" opacity="0.5"/>
        <circle cx="47" cy="35" r="3" fill="var(--accent)" opacity="0.5"/>
        <path d="M40 20 L40 14 M40 60 L40 66 M20 40 L14 40 M60 40 L66 40" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" opacity="0.25"/>
      </svg>
    </div>
    <h2 class="empty-title">连接你的抖音账号</h2>
    <p class="empty-sub">输入账号主页链接，开始采集创作者数据，解锁完整数据看板</p>
    <div class="url-form">
      <input
        class="url-input"
        type="text"
        placeholder="https://www.douyin.com/user/..."
        bind:value={douyinUrlInput}
        onkeydown={(e) => { if (e.key === "Enter") saveDouyinUrl(); }}
      />
      <button class="start-btn" onclick={saveDouyinUrl} disabled={savingUrl || !douyinUrlInput.trim()}>
        {#if savingUrl}
          <span class="btn-spinner"></span>
        {/if}
        开始采集
      </button>
    </div>
    {#if saveMsg}
      <p class="save-msg" class:err={saveMsg.includes("失败")}>{saveMsg}</p>
    {/if}
  </div>

{:else}
  <!-- ── Dashboard ──────────────────────────────────────────────────────── -->
  <div class="dashboard">

    <!-- 0. Platform tabs -->
    <div class="platform-tabs">
      <button class="ptab active">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
        抖音
      </button>
      <button class="ptab disabled" disabled title="即将支持">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/></svg>
        小红书
        <span class="coming-soon">即将支持</span>
      </button>
    </div>

    <!-- 1. Account Header Bar -->
    <div class="acct-bar">
      <div class="acct-left">
        <div class="acct-avatar">
          {creatorData.account.nickname.slice(0, 1)}
        </div>
        <div class="acct-info">
          <span class="acct-name">{creatorData.account.nickname}</span>
          <span class="platform-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>
            抖音
          </span>
        </div>
      </div>
      <div class="acct-right">
        <span class="acct-collected">上次采集: {timeAgo(creatorData.collected_at)}</span>
        <button class="refresh-btn" onclick={loadAnalytics} title="刷新数据">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </button>
        <button class="change-acct-btn" onclick={() => { showUrlEdit = !showUrlEdit; editUrlValue = ""; }} title="更换账号">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>

    {#if showUrlEdit}
      <div class="url-edit-bar">
        <input
          class="url-edit-input"
          type="text"
          placeholder="输入新的抖音主页链接..."
          bind:value={editUrlValue}
          onkeydown={(e) => { if (e.key === "Enter" && editUrlValue.trim()) { douyinUrlInput = editUrlValue; saveDouyinUrl(); showUrlEdit = false; } if (e.key === "Escape") showUrlEdit = false; }}
        />
        <button class="url-edit-save" disabled={!editUrlValue.trim()} onclick={() => { douyinUrlInput = editUrlValue; saveDouyinUrl(); showUrlEdit = false; }}>
          保存
        </button>
        <button class="url-edit-cancel" onclick={() => showUrlEdit = false}>
          取消
        </button>
      </div>
    {/if}

    <!-- 2. Key Metrics Row -->
    <div class="metrics-row">

      <!-- Followers -->
      <div class="metric-card">
        <div class="metric-icon followers-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="metric-body">
          <span class="metric-val">{fmtNum(creatorData.account.follower_count)}</span>
          <span class="metric-label">粉丝</span>
        </div>
        {#if delta.followers !== undefined}
          <span class="delta {deltaClass(delta.followers)}">{deltaLabel(delta.followers)}</span>
        {/if}
      </div>

      <!-- Total Favorited -->
      <div class="metric-card">
        <div class="metric-icon likes-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </div>
        <div class="metric-body">
          <span class="metric-val">{fmtNum(creatorData.account.total_favorited)}</span>
          <span class="metric-label">获赞</span>
        </div>
        {#if delta.favorited !== undefined}
          <span class="delta {deltaClass(delta.favorited)}">{deltaLabel(delta.favorited)}</span>
        {/if}
      </div>

      <!-- Avg Play -->
      <div class="metric-card">
        <div class="metric-icon play-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        <div class="metric-body">
          <span class="metric-val">{fmtNum(creatorData.summary.avg_play)}</span>
          <span class="metric-label">平均播放</span>
        </div>
      </div>

      <!-- Engagement Rate -->
      <div class="metric-card">
        <div class="metric-icon engage-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div class="metric-body">
          <span class="metric-val" style="color: {engagementColor(creatorData.summary.engagement_rate)}">
            {fmtPct(creatorData.summary.engagement_rate)}
          </span>
          <span class="metric-label">互动率</span>
        </div>
        <span
          class="engage-badge"
          style="background: {engagementColor(creatorData.summary.engagement_rate)}20; color: {engagementColor(creatorData.summary.engagement_rate)}"
        >
          {#if creatorData.summary.engagement_rate >= 0.05}优秀{:else if creatorData.summary.engagement_rate >= 0.02}正常{:else}偏低{/if}
        </span>
      </div>

    </div>

    <!-- Secondary stats strip -->
    <div class="strip-row">
      <div class="strip-item">
        <span class="strip-val">{creatorData.account.aweme_count}</span>
        <span class="strip-lbl">发布作品</span>
      </div>
      <div class="strip-sep"></div>
      <div class="strip-item">
        <span class="strip-val">{creatorData.summary.total_works_collected}</span>
        <span class="strip-lbl">已采集</span>
      </div>
      <div class="strip-sep"></div>
      <div class="strip-item">
        <span class="strip-val">{fmtNum(creatorData.summary.avg_digg)}</span>
        <span class="strip-lbl">均点赞</span>
      </div>
      <div class="strip-sep"></div>
      <div class="strip-item">
        <span class="strip-val">{fmtNum(creatorData.summary.avg_comment)}</span>
        <span class="strip-lbl">均评论</span>
      </div>
      <div class="strip-sep"></div>
      <div class="strip-item">
        <span class="strip-val">{fmtNum(creatorData.summary.avg_share)}</span>
        <span class="strip-lbl">均分享</span>
      </div>
      <div class="strip-sep"></div>
      <div class="strip-item">
        <span class="strip-val">{fmtNum(creatorData.summary.avg_collect)}</span>
        <span class="strip-lbl">均收藏</span>
      </div>
    </div>

    <!-- 3. Works Performance Table -->
    <div class="table-card">
      <div class="table-header">
        <h3 class="table-title">作品表现</h3>
        <span class="table-sub">Top 3 已标注爆款</span>
      </div>

      {#if sortedWorks.length === 0}
        <p class="empty-msg">暂无作品数据</p>
      {:else}
        <div class="table-wrap">
          <table class="works-table">
            <thead>
              <tr>
                <th class="col-title">标题</th>
                <th class="col-date sortable" onclick={() => toggleSort("create_time")}>
                  日期 {sortCol === "create_time" ? (sortAsc ? "↑" : "↓") : ""}
                </th>
                <th class="col-num sortable" onclick={() => toggleSort("play_count")}>
                  播放 {sortCol === "play_count" ? (sortAsc ? "↑" : "↓") : ""}
                </th>
                <th class="col-num sortable" onclick={() => toggleSort("digg_count")}>
                  点赞 {sortCol === "digg_count" ? (sortAsc ? "↑" : "↓") : ""}
                </th>
                <th class="col-num sortable" onclick={() => toggleSort("comment_count")}>
                  评论 {sortCol === "comment_count" ? (sortAsc ? "↑" : "↓") : ""}
                </th>
                <th class="col-num sortable" onclick={() => toggleSort("share_count")}>
                  分享 {sortCol === "share_count" ? (sortAsc ? "↑" : "↓") : ""}
                </th>
                <th class="col-bar">热度</th>
              </tr>
            </thead>
            <tbody>
              {#each sortedWorks as work, i}
                <tr class="work-row" class:top3={i < 3}>
                  <td class="col-title">
                    {#if i < 3}
                      <span class="hot-badge">爆</span>
                    {/if}
                    <span class="work-desc" title={work.desc}>{work.desc || "（无标题）"}</span>
                  </td>
                  <td class="col-date muted">{fmtDate(work.create_time)}</td>
                  <td class="col-num">{fmtNum(work.play_count)}</td>
                  <td class="col-num">{fmtNum(work.digg_count)}</td>
                  <td class="col-num">{fmtNum(work.comment_count)}</td>
                  <td class="col-num">{fmtNum(work.share_count)}</td>
                  <td class="col-bar">
                    <div class="bar-track">
                      <div
                        class="bar-fill"
                        class:bar-top={i < 3}
                        style="width: {Math.round((work.play_count / maxPlay) * 100)}%"
                      ></div>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

  </div>
{/if}

<style>
  /* ── Layout ─────────────────────────────────────────────────────────────── */
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* ── Loading / Empty ────────────────────────────────────────────────────── */
  .center-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    min-height: 320px;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid rgba(134, 120, 191, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  .hint-text {
    font-size: 0.82rem;
    color: var(--text-dim);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Not-configured / Empty state ───────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1rem;
    padding: 3.5rem 1.5rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius, 20px);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .empty-illo {
    opacity: 0.85;
  }

  .empty-title {
    font-size: 1.4rem;
    font-weight: 750;
    letter-spacing: -0.03em;
    color: var(--text);
    margin: 0;
  }

  .empty-sub {
    font-size: 0.88rem;
    color: var(--text-muted);
    max-width: 360px;
    line-height: 1.65;
    margin: 0;
  }

  .url-form {
    display: flex;
    gap: 0.5rem;
    width: 100%;
    max-width: 480px;
  }

  .url-input {
    flex: 1;
    padding: 0.7rem 1rem;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-inset);
    color: var(--text);
    font-size: 0.85rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .url-input:focus {
    border-color: var(--accent);
  }

  .url-input::placeholder {
    color: var(--text-dim);
  }

  .start-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.7rem 1.3rem;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 12px;
    font-size: 0.88rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.2s ease, opacity 0.2s ease;
    white-space: nowrap;
  }

  .start-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .start-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-spinner {
    width: 13px;
    height: 13px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
    display: inline-block;
  }

  .save-msg {
    font-size: 0.82rem;
    color: var(--success);
    margin: 0;
  }

  .save-msg.err {
    color: var(--error);
  }

  /* ── Account Header Bar ─────────────────────────────────────────────────── */
  /* Change account button & URL edit bar */
  .change-acct-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .change-acct-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .url-edit-bar {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: rgba(134, 120, 191, 0.06);
    border: 1px solid rgba(134, 120, 191, 0.15);
    border-radius: 10px;
    margin-bottom: 0.5rem;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .url-edit-input {
    flex: 1;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text);
    font-size: 0.82rem;
    font-family: inherit;
    outline: none;
  }

  .url-edit-input:focus {
    border-color: var(--accent);
  }

  .url-edit-save {
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    border: none;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .url-edit-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .url-edit-cancel {
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-dim);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .url-edit-cancel:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }

  /* Platform tabs */
  .platform-tabs {
    display: flex;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
  }

  .ptab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 1rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-dim);
    font-size: 0.82rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .ptab.active {
    background: var(--accent-gradient);
    color: var(--accent-text);
    border-color: transparent;
  }

  .ptab.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .coming-soon {
    font-size: 0.6rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-dim);
  }

  .acct-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius, 20px);
    padding: 0.9rem 1.25rem;
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .acct-left {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .acct-avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: var(--accent-gradient);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 750;
    color: #fff;
    flex-shrink: 0;
    letter-spacing: -0.02em;
  }

  .acct-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .acct-name {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .platform-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    font-size: 0.7rem;
    font-weight: 650;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  .acct-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .acct-collected {
    font-size: 0.78rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease;
    padding: 0;
  }

  .refresh-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ── Key Metrics Row ────────────────────────────────────────────────────── */
  .metrics-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
  }

  @media (max-width: 860px) {
    .metrics-row {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .metrics-row {
      grid-template-columns: 1fr 1fr;
    }
  }

  .metric-card {
    position: relative;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius, 20px);
    padding: 1.15rem 1.2rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
    overflow: hidden;
    transition: border-color 0.2s ease, transform 0.2s ease;
  }

  .metric-card:hover {
    border-color: rgba(134, 120, 191, 0.22);
    transform: translateY(-2px);
  }

  .metric-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .followers-icon {
    background: rgba(96, 165, 250, 0.1);
    color: #60a5fa;
  }

  .likes-icon {
    background: rgba(251, 113, 133, 0.1);
    color: #fb7185;
  }

  .play-icon {
    background: rgba(134, 120, 191, 0.12);
    color: var(--accent);
  }

  .engage-icon {
    background: rgba(52, 211, 153, 0.1);
    color: var(--success);
  }

  .metric-body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .metric-val {
    font-size: 1.75rem;
    font-weight: 780;
    color: var(--text);
    letter-spacing: -0.04em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .metric-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-weight: 550;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .delta {
    position: absolute;
    top: 1rem;
    right: 1rem;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.18rem 0.5rem;
    border-radius: 99px;
    letter-spacing: 0.01em;
  }

  .delta.up {
    background: rgba(52, 211, 153, 0.12);
    color: var(--success);
  }

  .delta.down {
    background: rgba(251, 113, 133, 0.12);
    color: var(--error);
  }

  .delta.neutral {
    background: var(--border);
    color: var(--text-muted);
  }

  .engage-badge {
    align-self: flex-start;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.18rem 0.55rem;
    border-radius: 99px;
    letter-spacing: 0.02em;
  }

  /* ── Secondary Stats Strip ──────────────────────────────────────────────── */
  .strip-row {
    display: flex;
    align-items: center;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 0.85rem 1.25rem;
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
    gap: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .strip-row::-webkit-scrollbar {
    display: none;
  }

  .strip-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    flex: 1;
    min-width: 80px;
  }

  .strip-val {
    font-size: 1.05rem;
    font-weight: 720;
    color: var(--text);
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
  }

  .strip-lbl {
    font-size: 0.67rem;
    color: var(--text-dim);
    font-weight: 500;
    letter-spacing: 0.02em;
  }

  .strip-sep {
    width: 1px;
    height: 28px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* ── Works Table ────────────────────────────────────────────────────────── */
  .table-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius, 20px);
    padding: 1.25rem 1.375rem;
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }

  .table-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .table-title {
    font-size: 0.92rem;
    font-weight: 720;
    color: var(--text);
    letter-spacing: -0.02em;
    margin: 0;
  }

  .table-sub {
    font-size: 0.72rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .table-wrap {
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar) transparent;
  }

  .works-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  .works-table thead th {
    font-size: 0.68rem;
    font-weight: 650;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0 0.75rem 0.65rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  .works-table thead th.sortable {
    cursor: pointer;
    user-select: none;
    transition: color 0.15s ease;
  }

  .works-table thead th.sortable:hover {
    color: var(--text-muted);
  }

  .works-table tbody .work-row {
    border-bottom: 1px solid var(--border-subtle, var(--border));
    transition: background 0.15s ease;
  }

  .works-table tbody .work-row:hover {
    background: var(--bg-hover);
  }

  .works-table tbody .work-row:last-child {
    border-bottom: none;
  }

  .works-table tbody .work-row.top3 {
    border-left: 2px solid var(--accent);
  }

  .works-table td {
    padding: 0.7rem 0.75rem;
    vertical-align: middle;
  }

  .col-title {
    max-width: 260px;
  }

  .works-table thead th.col-title {
    padding-left: 0.75rem;
  }

  .hot-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: linear-gradient(135deg, #f59e0b, #ef4444);
    color: #fff;
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    flex-shrink: 0;
  }

  .work-desc {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
    color: var(--text);
    font-weight: 500;
  }

  .col-date {
    white-space: nowrap;
    min-width: 60px;
  }

  .col-num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
    white-space: nowrap;
    min-width: 64px;
  }

  .muted {
    color: var(--text-dim);
  }

  .col-bar {
    min-width: 100px;
    width: 120px;
  }

  .bar-track {
    height: 6px;
    background: var(--bg-inset);
    border-radius: 99px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 99px;
    background: rgba(134, 120, 191, 0.35);
    transition: width 0.4s ease;
  }

  .bar-fill.bar-top {
    background: linear-gradient(90deg, var(--accent), #9d8fd4);
  }

  .empty-msg {
    font-size: 0.82rem;
    color: var(--text-dim);
    padding: 1rem 0;
    margin: 0;
  }
</style>
