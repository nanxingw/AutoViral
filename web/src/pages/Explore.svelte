<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import MarkdownBlock from "../components/MarkdownBlock.svelte";
  import { createTrendWs } from "../lib/ws";
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

  type ContentCategory = "anxiety" | "conflict" | "comedy" | "envy";
  let activeCategory: ContentCategory = $state("anxiety");

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
    <button class="cat-tab" class:active={activeCategory === "anxiety"} onclick={() => activeCategory = "anxiety"}>
      <span class="cat-tab-name">{tt("categoryAnxiety")}</span>
      <span class="cat-tab-desc">{tt("categoryAnxietyDesc")}</span>
    </button>
    <button class="cat-tab" class:active={activeCategory === "conflict"} onclick={() => activeCategory = "conflict"}>
      <span class="cat-tab-name">{tt("categoryConflict")}</span>
      <span class="cat-tab-desc">{tt("categoryConflictDesc")}</span>
    </button>
    <button class="cat-tab" class:active={activeCategory === "comedy"} onclick={() => activeCategory = "comedy"}>
      <span class="cat-tab-name">{tt("categoryComedy")}</span>
      <span class="cat-tab-desc">{tt("categoryComedyDesc")}</span>
    </button>
    <button class="cat-tab" class:active={activeCategory === "envy"} onclick={() => activeCategory = "envy"}>
      <span class="cat-tab-name">{tt("categoryEnvy")}</span>
      <span class="cat-tab-desc">{tt("categoryEnvyDesc")}</span>
    </button>
  </div>

  <!-- Showcase examples -->
  <div class="showcase-grid">
    {#if activeCategory === "conflict"}
      <div class="phone-showcase">
        <div class="phone-frame">
          <div class="phone-notch"></div>
          <div class="phone-screen">
            <!-- XHS post mockup -->
            <div class="xhs-post">
              <div class="xhs-cover">
                <img src="/api/works/w_20260325_1753_75d/assets/images/cover_v2.png" alt="封面" />
              </div>
              <div class="xhs-body">
                <h3 class="xhs-title">一个能引发所有人讨论的价值观冲突很严重的话题</h3>
                <div class="xhs-author">
                  <div class="xhs-avatar"></div>
                  <span class="xhs-name">AutoViral 创作</span>
                </div>
                <p class="xhs-text">我今年28，单身，没房，没车。不是我不努力，是这个社会疯了。凭什么结婚就必须买房？凭什么我爸妈辛苦了大半辈子，老了还要掏空自己来成全我的"面子"？</p>
                <div class="xhs-tags">
                  <span class="xhs-tag">#结婚必须买房吗</span>
                  <span class="xhs-tag">#买房焦虑</span>
                  <span class="xhs-tag">#年轻人不买房</span>
                  <span class="xhs-tag">#婚姻观</span>
                </div>
                <div class="xhs-actions">
                  <span class="xhs-action">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    2.4w
                  </span>
                  <span class="xhs-action">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 4H5a2 2 0 0 0-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V6a2 2 0 0 0-2-2z"/></svg>
                    8.1k
                  </span>
                  <span class="xhs-action">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    3.6k
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="phone-home-bar"></div>
        </div>
        <div class="showcase-caption">
          <span class="caption-tag">{tt("categoryConflict")}</span>
          <span class="caption-route">{lang === "zh" ? "路线1 · 观点输出型" : "Route 1 · Opinion"}</span>
        </div>
      </div>
    {:else}
      <div class="showcase-empty">
        <p class="showcase-empty-text">{lang === "zh" ? "优秀案例即将上线" : "Showcase examples coming soon"}</p>
        <p class="showcase-empty-sub">{lang === "zh" ? "这里将展示由 AutoViral 生成的优秀作品" : "Featured works created with AutoViral will appear here"}</p>
      </div>
    {/if}
  </div>
</div>

{#if showConfigModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="config-overlay" role="dialog" aria-modal="true" aria-label="Auto research config" tabindex="-1" onclick={(e) => { if ((e.target as HTMLElement).classList.contains('config-overlay')) closeConfigModal(); }}>
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

  /* Phone showcase */
  .phone-showcase {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 0;
  }

  .phone-frame {
    width: 280px;
    background: #000;
    border-radius: 32px;
    padding: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05);
    position: relative;
  }

  .phone-notch {
    width: 80px;
    height: 22px;
    background: #000;
    border-radius: 0 0 14px 14px;
    margin: 0 auto;
    position: relative;
    z-index: 2;
    margin-top: -1px;
  }

  .phone-screen {
    background: #fff;
    border-radius: 24px;
    overflow: hidden;
    margin-top: -12px;
    max-height: 520px;
    overflow-y: auto;
  }

  .phone-screen::-webkit-scrollbar { display: none; }

  .phone-home-bar {
    width: 100px;
    height: 4px;
    background: rgba(255,255,255,0.3);
    border-radius: 2px;
    margin: 6px auto 2px;
  }

  /* XHS post mockup */
  .xhs-post {
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    color: #333;
  }

  .xhs-cover {
    width: 100%;
    aspect-ratio: 3/4;
    overflow: hidden;
    background: #f5e6e0;
  }

  .xhs-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .xhs-body {
    padding: 10px 12px 14px;
  }

  .xhs-title {
    font-size: 14px;
    font-weight: 700;
    color: #222;
    margin: 0 0 8px;
    line-height: 1.35;
  }

  .xhs-author {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .xhs-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: linear-gradient(135deg, #FE2C55, #FF6B6B);
    flex-shrink: 0;
  }

  .xhs-name {
    font-size: 11px;
    color: #999;
    font-weight: 500;
  }

  .xhs-text {
    font-size: 12.5px;
    color: #444;
    line-height: 1.65;
    margin: 0 0 8px;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .xhs-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }

  .xhs-tag {
    font-size: 11px;
    color: #FE2C55;
    font-weight: 500;
  }

  .xhs-actions {
    display: flex;
    justify-content: space-around;
    padding-top: 8px;
    border-top: 1px solid #f0f0f0;
  }

  .xhs-action {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #999;
    font-weight: 500;
  }

  .xhs-action svg {
    width: 14px;
    height: 14px;
    stroke: #999;
  }

  .showcase-caption {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .caption-tag {
    font-size: 0.72rem;
    font-weight: 650;
    color: var(--spark-red, #FE2C55);
    padding: 0.15rem 0.5rem;
    border: 1px solid rgba(254, 44, 85, 0.2);
    border-radius: 4px;
    background: rgba(254, 44, 85, 0.04);
  }

  .caption-route {
    font-size: 0.72rem;
    color: var(--text-dim);
    font-weight: 500;
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

</style>
