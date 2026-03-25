<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import { createTrendWs } from "../lib/ws";
  import ResearchProgress from "../components/ResearchProgress.svelte";
  import InterestTags from "../components/InterestTags.svelte";

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

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

  type ContentCategory = "info" | "beauty" | "comedy";
  let activeCategory: ContentCategory = $state("info");

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
  let autoResearchOn = $state(false);
  let showConfigModal = $state(false);
  let configInterval = $state("1h");
  let configModel = $state("sonnet");

  async function loadAutoResearch() {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        autoResearchOn = data.autoRun ?? false;
        configInterval = data.interval ?? "1h";
        configModel = data.model ?? "sonnet";
      }
    } catch {}
  }

  function openConfigModal() {
    showConfigModal = true;
  }

  function closeConfigModal() {
    showConfigModal = false;
  }

  async function saveConfig() {
    autoResearchOn = !autoResearchOn;
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRun: autoResearchOn, interval: configInterval, model: configModel }),
      });
    } catch {
      autoResearchOn = !autoResearchOn;
    }
    showConfigModal = false;
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
              text: tt("researchDone"),
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
    const unsub = subscribe(() => { lang = getLanguage(); });
    loadTrends();
    loadInterests();
    loadReport();
    loadAutoResearch();
    return unsub;
  });
</script>

<div class="explore">
  <!-- Category tabs -->
  <div class="category-tabs">
    <button class="cat-tab" class:active={activeCategory === "info"} onclick={() => activeCategory = "info"}>
      <span class="cat-tab-name">{tt("categoryInfo")}</span>
      <span class="cat-tab-desc">{tt("categoryInfoDesc")}</span>
    </button>
    <button class="cat-tab" class:active={activeCategory === "beauty"} onclick={() => activeCategory = "beauty"}>
      <span class="cat-tab-name">{tt("categoryBeauty")}</span>
      <span class="cat-tab-desc">{tt("categoryBeautyDesc")}</span>
    </button>
    <button class="cat-tab" class:active={activeCategory === "comedy"} onclick={() => activeCategory = "comedy"}>
      <span class="cat-tab-name">{tt("categoryComedy")}</span>
      <span class="cat-tab-desc">{tt("categoryComedyDesc")}</span>
    </button>
  </div>

  <!-- Showcase examples -->
  <div class="showcase-grid">
    <div class="showcase-empty">
      <p class="showcase-empty-text">{lang === "zh" ? "优秀案例即将上线" : "Showcase examples coming soon"}</p>
      <p class="showcase-empty-sub">{lang === "zh" ? "这里将展示由 AutoViral 生成的优秀作品" : "Featured works created with AutoViral will appear here"}</p>
    </div>
  </div>
</div>

{#if showConfigModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="config-overlay" onclick={(e) => { if ((e.target as HTMLElement).classList.contains('config-overlay')) closeConfigModal(); }}>
    <div class="config-modal">
      <h3 class="config-title">{tt("autoResearchLabel")}</h3>
      <p class="config-desc">
        {autoResearchOn ? (lang === "zh" ? "自动调研已开启，关闭后将停止自动调研。" : "Auto research is on. Turn off to stop.") : (lang === "zh" ? "开启后，AI 会按设定频率自动调研热门趋势。" : "AI will automatically research trends at the set interval.")}
      </p>

      <div class="config-field">
        <span class="config-label">{tt("researchInterval")}</span>
        <select bind:value={configInterval}>
          <option value="15m">{tt("minutes15")}</option>
          <option value="30m">{tt("minutes30")}</option>
          <option value="1h">{tt("hour1")}</option>
          <option value="2h">{tt("hours2")}</option>
          <option value="4h">{tt("hours4")}</option>
          <option value="8h">{tt("hours8")}</option>
        </select>
      </div>

      <div class="config-field">
        <span class="config-label">{tt("aiModel")}</span>
        <select bind:value={configModel}>
          <option value="haiku">{tt("claudeHaikuFast")}</option>
          <option value="sonnet">{tt("claudeSonnetBalanced")}</option>
          <option value="opus">{tt("claudeOpusCapable")}</option>
        </select>
      </div>

      <div class="config-actions">
        <button class="config-cancel" onclick={closeConfigModal}>{tt("cancel")}</button>
        <button class="config-confirm" onclick={saveConfig}>
          {autoResearchOn ? (lang === "zh" ? "关闭" : "Turn Off") : (lang === "zh" ? "开启" : "Turn On")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .explore {
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }

  .explore-title {
    font-family: var(--font-display);
    font-size: var(--size-2xl);
    font-weight: 700;
    letter-spacing: -0.04em;
    color: var(--text);
    margin-bottom: 1.5rem;
  }

  /* Category tabs */
  .category-tabs {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
    margin-bottom: 1.25rem;
  }

  .cat-tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.5rem 1rem;
    border: 1.5px solid var(--border);
    border-radius: 6px;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-body);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cat-tab:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }

  .cat-tab.active {
    border-color: var(--spark-red, #FE2C55);
    background: rgba(254, 44, 85, 0.06);
    color: var(--text);
  }

  .cat-tab-name {
    font-size: 0.85rem;
    font-weight: 650;
  }

  .cat-tab-desc {
    font-size: 0.65rem;
    color: var(--text-dim);
    line-height: 1.2;
  }

  .cat-tab.active .cat-tab-desc {
    color: var(--text-muted);
  }

  /* Showcase */
  .showcase-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }

  .showcase-empty {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 4rem 1rem;
    border: 1px dashed var(--border);
    border-radius: 6px;
  }

  .showcase-empty-text {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
    margin: 0;
  }

  .showcase-empty-sub {
    font-size: 0.75rem;
    color: var(--text-dim);
    margin: 0;
  }

  .ranking-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  @media (max-width: 700px) {
    .ranking-grid { grid-template-columns: 1fr; }
  }

  .ranking-list {
    border: 1px solid var(--border);
    border-radius: var(--card-radius, 6px);
    overflow: hidden;
  }

  .ranking-head {
    font-family: var(--font-display);
    font-size: var(--size-sm);
    font-weight: 600;
    color: var(--text);
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--border);
    letter-spacing: -0.01em;
  }

  .ranking-ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .ranking-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid var(--border);
    transition: background 0.1s;
  }

  .ranking-item:last-child { border-bottom: none; }
  .ranking-item:hover { background: var(--accent-soft); }

  .ranking-rank {
    font-family: var(--font-display);
    font-size: var(--size-sm);
    font-weight: 700;
    color: var(--text-dim);
    width: 1.5rem;
    text-align: center;
    flex-shrink: 0;
  }

  .ranking-rank.top3 {
    color: var(--spark-red);
  }

  .ranking-name {
    flex: 1;
    font-size: var(--size-sm);
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ranking-heat {
    font-size: 0.65rem;
    flex-shrink: 0;
  }

  .ranking-tag {
    font-size: var(--size-xs);
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .ranking-empty {
    padding: 1.5rem 0.85rem;
    text-align: center;
    color: var(--text-dim);
    font-size: var(--size-sm);
  }

  /* Keep old styles below for config modal etc */
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

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .auto-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .auto-btn:hover {
    border-color: var(--text-dim);
    color: var(--text);
  }

  .auto-btn.on {
    border-color: var(--success);
    color: var(--success);
  }

  .auto-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-dim);
    flex-shrink: 0;
  }

  .auto-dot.on {
    background: var(--success);
    box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
  }

  /* Config modal */
  .config-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    animation: fadeIn 0.15s ease;
  }

  .config-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 1.5rem;
    width: 100%;
    max-width: 380px;
    box-shadow: var(--shadow-lg);
    backdrop-filter: var(--card-blur);
    animation: scaleIn 0.2s ease;
  }

  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }

  .config-title {
    font-size: 1.05rem;
    font-weight: 700;
    margin-bottom: 0.35rem;
    letter-spacing: -0.02em;
  }

  .config-desc {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 1.25rem;
    line-height: 1.5;
  }

  .config-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.85rem;
  }

  .config-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .config-field select {
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.45rem 2rem 0.45rem 0.7rem;
    font-size: 0.82rem;
    font-family: inherit;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7194' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.7rem center;
    cursor: pointer;
  }

  .config-field select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .config-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .config-cancel {
    padding: 0.45rem 1rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
    color: var(--text);
    font-size: 0.82rem;
    font-weight: 550;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .config-cancel:hover {
    background: var(--bg-hover);
  }

  .config-confirm {
    padding: 0.45rem 1.25rem;
    border: none;
    border-radius: 8px;
    background: var(--accent-gradient);
    color: var(--accent-text);
    font-size: 0.82rem;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .config-confirm:hover {
    filter: brightness(1.1);
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
  .pill-tab.active { background: var(--accent-gradient); color: var(--accent-text); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); }
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
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }

  .refresh-btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
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
    border: 2.5px solid rgba(0, 0, 0, 0.15);
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
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }

  .start-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
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
    border-color: rgba(0, 0, 0, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  }

  .trend-card.featured {
    border-color: rgba(0, 0, 0, 0.25);
    background: linear-gradient(135deg, var(--card-bg) 0%, rgba(0, 0, 0, 0.04) 100%);
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
    border: 1px solid rgba(0, 0, 0, 0.2);
    background: rgba(0, 0, 0, 0.06);
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
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  /* ── Raw content ───────────────────────────────────────── */
  .raw-block {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 1.5rem;
  }
</style>
