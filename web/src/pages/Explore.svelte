<script lang="ts">
  import { onMount } from "svelte";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import { createTrendWs } from "../lib/ws";
  import ResearchProgress from "../components/ResearchProgress.svelte";

  type Platform = "douyin" | "xiaohongshu";

  interface TrendDirection {
    title: string;
    heat: number;          // 1-5
    competition: string;   // 低/中/高
    description: string;
  }

  let activePlatform: Platform = $state("douyin");
  let loading = $state(false);
  let directions: TrendDirection[] = $state([]);
  let rawContent: string = $state("");
  let isStructured = $state(true);
  let researchActive = $state(false);
  let researchWs: { close: () => void } | null = null;
  let sessionKey = $state("");

  interface ProgressLine {
    type: "search" | "result" | "analyzing" | "done" | "error";
    text: string;
  }
  let progressLines: ProgressLine[] = $state([]);
  let researchPhase: "idle" | "searching" | "analyzing" | "done" | "error" = $state("idle");

  function parseTrends(data: any): void {
    // Structured data with topics/directions array
    if (data && typeof data === "object") {
      const arr = data.topics ?? data.directions ?? data.trends ?? data.items ?? data.videos;
      if (Array.isArray(arr) && arr.length > 0) {
        directions = arr.map((item: any) => ({
          title: item.title ?? item.name ?? item.direction ?? "未知方向",
          heat: Math.min(5, Math.max(1, Number(item.heat ?? item.hotness ?? item.score ?? 3))),
          competition: item.competition ?? item.competitionLevel ?? "中",
          description: item.description ?? item.desc ?? item.summary ?? "",
        }));
        rawContent = "";
        isStructured = true;
        return;
      }
      // If object has a content/text/raw field
      const text = data.content ?? data.text ?? data.raw ?? data.markdown;
      if (typeof text === "string" && text.trim()) {
        rawContent = text;
        directions = [];
        isStructured = false;
        return;
      }
    }
    // Plain string/text response
    if (typeof data === "string" && data.trim()) {
      rawContent = data;
      directions = [];
      isStructured = false;
      return;
    }
    // Empty
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
          const data = await res.json();
          parseTrends(data);
        } else {
          const text = await res.text();
          parseTrends(text);
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
          case "analyzing":
            researchPhase = "analyzing";
            progressLines = [...progressLines, {
              type: "analyzing",
              text: "正在分析整理...",
            }];
            break;
          case "research_done":
            researchPhase = "done";
            progressLines = [...progressLines, {
              type: "done",
              text: "调研完成",
            }];
            setTimeout(() => {
              researchActive = false;
              researchPhase = "idle";
              progressLines = [];
              loadTrends();
            }, 800);
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
  }

  function switchPlatform(p: Platform) {
    if (p === activePlatform) return;
    activePlatform = p;
    loadTrends();
  }

  function heatDots(level: number): string {
    return Array.from({ length: 5 }, (_, i) => i < level ? "\u{1F525}" : "\u00B7").join("");
  }

  function dispatchCreate(dir: TrendDirection) {
    const event = new CustomEvent("createWork", {
      bubbles: true,
      detail: { topicHint: dir.title + " - " + dir.description, platform: activePlatform },
    });
    document.dispatchEvent(event);
  }

  let hasData = $derived(directions.length > 0 || rawContent.length > 0);

  onMount(() => {
    loadTrends();
  });
</script>

<div class="explore">
  <!-- Platform pill tabs -->
  <div class="tab-bar">
    <div class="pill-tabs">
      <button
        class="pill-tab"
        class:active={activePlatform === "douyin"}
        onclick={() => switchPlatform("douyin")}
        disabled={researchActive}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
        抖音
      </button>
      <button
        class="pill-tab"
        class:active={activePlatform === "xiaohongshu"}
        onclick={() => switchPlatform("xiaohongshu")}
        disabled={researchActive}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/></svg>
        小红书
      </button>
    </div>
    <button class="refresh-btn" onclick={researchActive ? handleCancel : handleRefresh} disabled={loading}>
      <svg class="refresh-icon" class:spinning={researchActive} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      {researchActive ? "取消" : "刷新趋势"}
    </button>
  </div>

  <ResearchProgress
    active={researchActive}
    lines={progressLines}
    phase={researchPhase}
    onCancel={handleCancel}
  />

  <!-- Content -->
  {#if loading}
    <div class="loading-state">
      <div class="loader"></div>
      <p>正在加载趋势数据...</p>
    </div>
  {:else if !hasData}
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p class="empty-title">暂无趋势数据</p>
      <p class="empty-desc">点击刷新获取最新趋势</p>
      <button class="action-btn" onclick={handleRefresh} disabled={researchActive}>
        {researchActive ? "获取中..." : "刷新趋势"}
      </button>
    </div>
  {:else if isStructured}
    <div class="trend-grid">
      {#each directions as dir, i}
        <div class="trend-card" style="animation-delay: {i * 0.05}s">
          <div class="card-header">
            <h3 class="card-title">{dir.title}</h3>
            <span class="competition-badge" class:comp-low={dir.competition === "低"} class:comp-mid={dir.competition === "中"} class:comp-high={dir.competition === "高"}>
              竞争{dir.competition}
            </span>
          </div>
          <div class="heat-row">
            <span class="heat-label">热度</span>
            <span class="heat-dots">{heatDots(dir.heat)}</span>
          </div>
          {#if dir.description}
            <p class="card-desc">{dir.description}</p>
          {/if}
          <button class="create-btn" onclick={() => dispatchCreate(dir)}>
            以此创建作品
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="raw-content glass-card">
      <MarkdownBlock text={rawContent} />
    </div>
  {/if}
</div>

<style>
  .explore {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  /* ── Tab bar ─────────────────────────────────────────────────── */
  .tab-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .pill-tabs {
    display: flex;
    gap: 0.25rem;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 0.2rem;
  }

  .pill-tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1.1rem;
    border-radius: 10px;
    border: none;
    background: none;
    color: var(--text-dim);
    font-size: 0.84rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .pill-tab:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
  }

  .pill-tab.active {
    background: var(--accent-gradient);
    color: var(--accent-text);
    box-shadow: 0 2px 10px rgba(134, 120, 191, 0.3);
  }

  .pill-tab svg {
    opacity: 0.75;
  }

  .pill-tab.active svg {
    opacity: 1;
  }

  .pill-tab:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-secondary);
    font-size: 0.82rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    backdrop-filter: blur(8px);
  }

  .refresh-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(134, 120, 191, 0.08);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-icon {
    transition: transform 0.3s ease;
  }

  .refresh-icon.spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── Loading ──────────────────────────────────────────────────── */
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
    width: 28px;
    height: 28px;
    border: 2.5px solid rgba(134, 120, 191, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ── Empty state ─────────────────────────────────────────────── */
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
    opacity: 0.35;
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
    max-width: 320px;
    line-height: 1.5;
  }

  .action-btn {
    margin-top: 0.5rem;
    padding: 0.6rem 1.4rem;
    border-radius: 10px;
    border: none;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.84rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .action-btn:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(134, 120, 191, 0.3);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Trend grid ──────────────────────────────────────────────── */
  .trend-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  @media (max-width: 640px) {
    .trend-grid {
      grid-template-columns: 1fr;
    }
  }

  .trend-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius, 14px);
    padding: 1.25rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    transition: border-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
    animation: fadeInUp 0.35s ease both;
  }

  .trend-card:hover {
    border-color: rgba(134, 120, 191, 0.35);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .card-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.015em;
    line-height: 1.4;
    flex: 1;
    margin: 0;
  }

  .competition-badge {
    font-size: 0.68rem;
    font-weight: 650;
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .comp-low {
    background: rgba(52, 211, 153, 0.12);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.2);
  }

  .comp-mid {
    background: rgba(251, 191, 36, 0.12);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.2);
  }

  .comp-high {
    background: rgba(251, 113, 133, 0.12);
    color: #fb7185;
    border: 1px solid rgba(251, 113, 133, 0.2);
  }

  .heat-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .heat-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .heat-dots {
    font-size: 0.82rem;
    letter-spacing: 0.05em;
  }

  .card-desc {
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.55;
    font-weight: 450;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
  }

  .create-btn {
    margin-top: auto;
    padding: 0.5rem 0.85rem;
    border-radius: 8px;
    border: 1px solid rgba(134, 120, 191, 0.25);
    background: rgba(134, 120, 191, 0.08);
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
    box-shadow: 0 2px 10px rgba(134, 120, 191, 0.25);
  }

  /* ── Raw content ─────────────────────────────────────────────── */
  .raw-content {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius, 14px);
    padding: 1.5rem;
    box-shadow: var(--shadow-sm);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
  }
</style>
