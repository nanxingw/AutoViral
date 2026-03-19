<script lang="ts">
  import { onMount } from "svelte";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import { createTrendWs } from "../lib/ws";
  import ResearchProgress from "../components/ResearchProgress.svelte";
  import InterestTags from "../components/InterestTags.svelte";

  type Platform = "douyin" | "xiaohongshu";

  interface TrendDirection {
    title: string;
    heat: number;
    competition: string;
    opportunity?: string;
    description: string;
    tags?: string[];
    contentAngles?: string[];
    exampleHook?: string;
    category?: string;
  }

  let interests: string[] = $state([]);
  let activePlatform: Platform = $state("douyin");
  let loading = $state(false);
  let directions: TrendDirection[] = $state([]);
  let rawContent: string = $state("");
  let isStructured = $state(true);
  let researchActive = $state(false);
  let researchWs: { close: () => void } | null = null;
  let sessionKey = $state("");

  interface ProgressLine {
    type: "search" | "result" | "analyzing" | "done" | "error" | "text";
    text: string;
  }
  let progressLines: ProgressLine[] = $state([]);
  let researchPhase: "idle" | "searching" | "analyzing" | "done" | "error" = $state("idle");
  let streamText = $state("");
  let reportText = $state("");

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

  function parseTrends(data: any): void {
    if (data && typeof data === "object") {
      const arr = data.topics ?? data.directions ?? data.trends ?? data.items ?? data.videos;
      if (Array.isArray(arr) && arr.length > 0) {
        directions = arr.map((item: any) => ({
          title: item.title ?? item.name ?? item.direction ?? "未知方向",
          heat: Math.min(5, Math.max(1, Number(item.heat ?? item.hotness ?? item.score ?? 3))),
          competition: item.competition ?? item.competitionLevel ?? "中",
          opportunity: item.opportunity ?? "",
          description: item.description ?? item.desc ?? item.summary ?? "",
          tags: Array.isArray(item.tags) ? item.tags : [],
          contentAngles: Array.isArray(item.contentAngles) ? item.contentAngles : [],
          exampleHook: item.exampleHook ?? "",
          category: item.category ?? "",
        }));
        rawContent = "";
        isStructured = true;
        return;
      }
      const text = data.content ?? data.text ?? data.raw ?? data.markdown;
      if (typeof text === "string" && text.trim()) {
        rawContent = text;
        directions = [];
        isStructured = false;
        return;
      }
    }
    if (typeof data === "string" && data.trim()) {
      rawContent = data;
      directions = [];
      isStructured = false;
      return;
    }
    directions = [];
    rawContent = "";
    isStructured = true;
  }

  async function loadTrends() {
    loading = true;
    try {
      const res = await fetch(`/api/trends/${activePlatform}`);
      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          parseTrends(await res.json());
        } else {
          parseTrends(await res.text());
        }
      } else {
        directions = [];
        rawContent = "";
      }
    } catch {
      directions = [];
      rawContent = "";
    } finally {
      loading = false;
    }
  }

  async function handleRefresh() {
    if (researchActive) return;

    progressLines = [];
    streamText = "";
    reportText = "";
    researchPhase = "searching";
    researchActive = true;

    try {
      const res = await fetch("/api/trends/refresh-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: activePlatform }),
      });

      if (!res.ok) {
        researchPhase = "error";
        progressLines = [{ type: "error", text: "无法启动趋势调研" }];
        researchActive = false;
        return;
      }

      const { sessionKey: key } = await res.json();
      sessionKey = key;

      researchWs = createTrendWs(key, (event, data) => {
        switch (event) {
          case "search_query":
            progressLines = [...progressLines, {
              type: "search",
              text: `搜索 "${data.query}"`,
            }];
            break;
          case "search_result": {
            const updated = [...progressLines];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].type === "search") {
                updated[i] = { type: "result", text: updated[i].text + "  " + (data.summary || "完成") };
                break;
              }
            }
            progressLines = updated;
            break;
          }
          case "assistant_text":
            // Stream agent's real-time output
            streamText += (data.text ?? "");
            if (researchPhase === "searching") {
              researchPhase = "analyzing";
            }
            break;
          case "analyzing":
            researchPhase = "analyzing";
            if (!progressLines.some(l => l.type === "analyzing")) {
              progressLines = [...progressLines, {
                type: "analyzing",
                text: "AI 正在分析整理...",
              }];
            }
            break;
          case "research_report":
            // Agent wrote report.md, backend read and forwarded it
            if (data.report) {
              reportText = data.report;
            }
            break;
          case "turn_complete":
            break;
          case "research_done":
            researchPhase = "done";
            progressLines = [...progressLines, {
              type: "done",
              text: "调研完成",
            }];
            setTimeout(async () => {
              researchActive = false;
              researchPhase = "idle";
              progressLines = [];
              streamText = "";
              loadTrends();
              // Load report if not already received via WebSocket
              if (!reportText) {
                try {
                  const res = await fetch(`/api/trends/${activePlatform}/report`);
                  if (res.ok) {
                    const text = await res.text();
                    if (text.trim()) reportText = text;
                  }
                } catch {}
              }
            }, 1200);
            break;
          case "research_error":
            researchPhase = "error";
            progressLines = [...progressLines, {
              type: "error",
              text: data.message || "调研失败",
            }];
            researchActive = false;
            break;
          case "session_closed":
            researchWs = null;
            break;
        }
      });
    } catch {
      researchPhase = "error";
      progressLines = [{ type: "error", text: "网络错误，请重试" }];
      researchActive = false;
    }
  }

  async function handleCancel() {
    if (researchPhase === "error") {
      handleRefresh();
      return;
    }
    if (sessionKey) {
      await fetch(`/api/trends/cancel/${encodeURIComponent(sessionKey)}`, {
        method: "POST",
      }).catch(() => {});
    }
    researchWs?.close();
    researchWs = null;
    researchActive = false;
    researchPhase = "idle";
    progressLines = [];
    streamText = "";
  }

  function switchPlatform(p: Platform) {
    if (p === activePlatform) return;
    activePlatform = p;
    reportText = "";
    loadTrends();
    loadReport();
  }

  function heatDots(level: number): string {
    return Array.from({ length: 5 }, (_, i) => i < level ? "\u{1F525}" : "\u00B7").join("");
  }

  function dispatchCreate(dir: TrendDirection) {
    const hint = [
      dir.title,
      dir.description,
      dir.contentAngles?.length ? `切入角度: ${dir.contentAngles.join("; ")}` : "",
      dir.tags?.length ? `推荐标签: ${dir.tags.map(t => "#" + t).join(" ")}` : "",
    ].filter(Boolean).join("\n");

    const event = new CustomEvent("createWork", {
      bubbles: true,
      detail: { topicHint: hint, platform: activePlatform },
    });
    document.dispatchEvent(event);
  }

  function opportunityColor(opp: string): string {
    if (opp === "金矿") return "opp-gold";
    if (opp === "蓝海") return "opp-blue";
    if (opp === "红海") return "opp-red";
    return "";
  }

  let hasData = $derived(directions.length > 0 || rawContent.length > 0);
  let platformLabel = $derived(activePlatform === "douyin" ? "抖音" : "小红书");

  async function loadReport() {
    try {
      const res = await fetch(`/api/trends/${activePlatform}/report`);
      if (res.ok) {
        const text = await res.text();
        if (text.trim()) reportText = text;
      }
    } catch {}
  }

  onMount(() => {
    loadTrends();
    loadInterests();
    loadReport();
  });
</script>

<div class="explore">
  <!-- Header bar -->
  <div class="header-bar">
    <div class="header-left">
      <div class="pill-tabs">
        <button
          class="pill-tab"
          class:active={activePlatform === "douyin"}
          onclick={() => switchPlatform("douyin")}
          disabled={researchActive}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
          抖音
        </button>
        <button
          class="pill-tab"
          class:active={activePlatform === "xiaohongshu"}
          onclick={() => switchPlatform("xiaohongshu")}
          disabled={researchActive}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/></svg>
          小红书
        </button>
      </div>
    </div>

    <!-- Primary action button - VERY visible -->
    <button
      class="refresh-btn-primary"
      class:active={researchActive}
      onclick={researchActive ? handleCancel : handleRefresh}
      disabled={loading}
    >
      {#if researchActive}
        <svg class="spinning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
        取消调研
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        开始调研 {platformLabel}
      {/if}
    </button>
  </div>

  <InterestTags {interests} onUpdate={saveInterests} />

  <ResearchProgress
    active={researchActive}
    lines={progressLines}
    phase={researchPhase}
    {streamText}
    {reportText}
    onCancel={handleCancel}
  />

  <!-- Content -->
  {#if loading}
    <div class="loading-state">
      <div class="loader"></div>
      <p>正在加载趋势数据...</p>
    </div>
  {:else if !hasData && !researchActive}
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <p class="empty-title">发现 {platformLabel} 热门趋势</p>
      <p class="empty-desc">点击上方「开始调研」，AI 将自动获取实时热搜并分析内容机会</p>
      <button class="start-btn" onclick={handleRefresh}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        开始调研
      </button>
    </div>
  {:else if isStructured && directions.length > 0}
    <div class="trend-grid">
      {#each directions as dir, i}
        <div
          class="trend-card"
          class:featured={i < 2 && dir.heat >= 4}
          style="animation-delay: {i * 0.05}s"
        >
          <!-- Card top: category + badges -->
          <div class="card-top">
            {#if dir.category}
              <span class="category-label">{dir.category}</span>
            {/if}
            <div class="card-badges">
              {#if dir.opportunity}
                <span class="badge {opportunityColor(dir.opportunity)}">{dir.opportunity}</span>
              {/if}
              <span class="badge comp" class:comp-low={dir.competition === "低"} class:comp-mid={dir.competition === "中"} class:comp-high={dir.competition === "高"}>
                竞争{dir.competition}
              </span>
            </div>
          </div>

          <h3 class="card-title">{dir.title}</h3>

          <div class="heat-row">
            <span class="heat-dots">{heatDots(dir.heat)}</span>
          </div>

          {#if dir.description}
            <p class="card-desc">{dir.description}</p>
          {/if}

          {#if dir.contentAngles && dir.contentAngles.length > 0}
            <div class="card-section">
              <span class="card-section-label">切入角度</span>
              {#each dir.contentAngles as angle}
                <div class="angle-item">
                  <span class="angle-bullet">&#x2023;</span>
                  {angle}
                </div>
              {/each}
            </div>
          {/if}

          {#if dir.exampleHook}
            <div class="card-section">
              <span class="card-section-label">爆款钩子</span>
              <p class="hook-quote">&ldquo;{dir.exampleHook}&rdquo;</p>
            </div>
          {/if}

          {#if dir.tags && dir.tags.length > 0}
            <div class="card-tags">
              {#each dir.tags.slice(0, 5) as tag}
                <span class="tag">#{tag}</span>
              {/each}
            </div>
          {/if}

          <button class="create-btn" onclick={() => dispatchCreate(dir)}>
            以此创建作品
          </button>
        </div>
      {/each}
    </div>
  {:else if rawContent}
    <div class="raw-block">
      <MarkdownBlock text={rawContent} />
    </div>
  {/if}
</div>

<style>
  .explore {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* ── Header ────────────────────────────────────────────── */
  .header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .pill-tabs {
    display: flex;
    gap: 0.2rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 0.2rem;
  }

  .pill-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 1rem;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--text-dim);
    font-size: 0.82rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .pill-tab:hover { color: var(--text-secondary); background: rgba(255, 255, 255, 0.04); }
  .pill-tab.active { background: var(--accent-gradient); color: var(--accent-text); box-shadow: 0 2px 8px rgba(134, 120, 191, 0.25); }
  .pill-tab.active svg { opacity: 1; }
  .pill-tab svg { opacity: 0.7; }
  .pill-tab:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }

  /* ── Primary refresh button ────────────────────────────── */
  .refresh-btn-primary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1.3rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.84rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 12px rgba(134, 120, 191, 0.3);
  }

  .refresh-btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 18px rgba(134, 120, 191, 0.4);
  }

  .refresh-btn-primary.active {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    box-shadow: none;
  }

  .refresh-btn-primary.active:hover:not(:disabled) {
    border-color: var(--error, #fb7185);
    color: var(--error, #fb7185);
    transform: none;
  }

  .refresh-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Loading ───────────────────────────────────────────── */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 4rem 2rem;
    color: var(--text-dim);
    font-size: 0.85rem;
    font-weight: 500;
  }

  .loader {
    width: 24px;
    height: 24px;
    border: 2.5px solid rgba(134, 120, 191, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ── Empty state ───────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 5rem 2rem;
    text-align: center;
  }

  .empty-icon {
    color: var(--text-dim);
    opacity: 0.3;
    margin-bottom: 0.5rem;
  }

  .empty-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
    margin: 0;
  }

  .empty-desc {
    font-size: 0.84rem;
    color: var(--text-dim);
    font-weight: 500;
    max-width: 340px;
    line-height: 1.55;
    margin: 0;
  }

  .start-btn {
    margin-top: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.5rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.84rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 12px rgba(134, 120, 191, 0.3);
  }

  .start-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 18px rgba(134, 120, 191, 0.4);
  }

  /* ── Trend grid ────────────────────────────────────────── */
  .trend-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 0.85rem;
  }

  @media (max-width: 640px) {
    .trend-grid { grid-template-columns: 1fr; }
  }

  .trend-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    animation: fadeUp 0.3s ease both;
  }

  .trend-card:hover {
    border-color: rgba(134, 120, 191, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  }

  .trend-card.featured {
    border-color: rgba(134, 120, 191, 0.25);
    background: linear-gradient(135deg, var(--card-bg) 0%, rgba(134, 120, 191, 0.04) 100%);
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Card internals ────────────────────────────────────── */
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .category-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.02em;
  }

  .card-badges {
    display: flex;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .badge {
    font-size: 0.66rem;
    font-weight: 650;
    padding: 0.18rem 0.55rem;
    border-radius: 5px;
    white-space: nowrap;
  }

  .opp-gold { background: rgba(52, 211, 153, 0.12); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.2); }
  .opp-blue { background: rgba(96, 165, 250, 0.12); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.2); }
  .opp-red { background: rgba(251, 113, 133, 0.12); color: #fb7185; border: 1px solid rgba(251, 113, 133, 0.2); }

  .comp { border: 1px solid transparent; }
  .comp-low { background: rgba(52, 211, 153, 0.1); color: #34d399; border-color: rgba(52, 211, 153, 0.15); }
  .comp-mid { background: rgba(251, 191, 36, 0.1); color: #fbbf24; border-color: rgba(251, 191, 36, 0.15); }
  .comp-high { background: rgba(251, 113, 133, 0.1); color: #fb7185; border-color: rgba(251, 113, 133, 0.15); }

  .card-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.015em;
    line-height: 1.35;
    margin: 0;
  }

  .heat-row {
    display: flex;
    align-items: center;
  }

  .heat-dots {
    font-size: 0.8rem;
    letter-spacing: 0.04em;
  }

  .card-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.55;
    font-weight: 450;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-section {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .card-section-label {
    font-size: 0.68rem;
    font-weight: 650;
    color: var(--text-dim);
    letter-spacing: 0.03em;
  }

  .angle-item {
    display: flex;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.45;
    padding-left: 0.15rem;
  }

  .angle-bullet {
    color: var(--accent);
    opacity: 0.6;
    flex-shrink: 0;
  }

  .hook-quote {
    font-size: 0.78rem;
    color: var(--accent);
    font-style: italic;
    line-height: 1.5;
    margin: 0;
    opacity: 0.8;
  }

  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .tag {
    font-size: 0.66rem;
    font-weight: 550;
    padding: 0.12rem 0.45rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .create-btn {
    margin-top: auto;
    padding: 0.5rem 0.85rem;
    border-radius: 8px;
    border: 1px solid rgba(134, 120, 191, 0.2);
    background: rgba(134, 120, 191, 0.06);
    color: var(--accent);
    font-size: 0.78rem;
    font-weight: 620;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
  }

  .create-btn:hover {
    background: var(--accent-gradient);
    color: var(--accent-text);
    border-color: transparent;
    box-shadow: 0 2px 8px rgba(134, 120, 191, 0.2);
  }

  /* ── Raw content ───────────────────────────────────────── */
  .raw-block {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 1.5rem;
  }
</style>
