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

  type ContentCategory = "anxiety" | "conflict" | "comedy" | "envy";
  let activeCategory: ContentCategory = $state("conflict");

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

  // Showcase: load all works with output content
  interface ShowcaseWork {
    id: string;
    title: string;
    coverImage: string;
    images: string[];
    body: string;
    tags: string[];
    category: ContentCategory;
    platforms: string[];
  }
  let showcaseWorks: ShowcaseWork[] = $state([]);
  let selectedWork: ShowcaseWork | null = $state(null);
  let showcasePlatform: "all" | "douyin" | "xiaohongshu" = $state("all");
  let modalImageIdx = $state(0);

  let filteredShowcase = $derived(
    showcaseWorks.filter(w =>
      w.category === activeCategory &&
      (showcasePlatform === "all" || w.platforms.includes(showcasePlatform))
    )
  );

  function parseCopytext(raw: string): { title: string; body: string; tags: string[] } {
    let title = "";
    let bodyLines: string[] = [];
    let tags: string[] = [];
    let section = "";
    for (const rawLine of raw.split("\n")) {
      const line = rawLine.trim();
      if (!line || line === "---" || line === "***") continue;
      const m = line.match(/^#{1,3}\s+(.+)/);
      if (m) {
        const name = m[1].trim().toLowerCase();
        if (/标题|title/.test(name)) section = "title";
        else if (/标签|tag|话题|topic/.test(name)) section = "tags";
        else if (/发布建议|publish.?tip|注意事项/.test(name)) section = "tips";
        else section = "body";
        continue;
      }
      const cleaned = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]\s+/, "");
      if (section === "title" && !title) title = cleaned;
      else if (section === "tags") {
        const found = cleaned.match(/#[\w\u4e00-\u9fff\u00c0-\u024f]+/g);
        if (found) tags.push(...found);
        else if (cleaned) tags.push(cleaned.startsWith("#") ? cleaned : "#" + cleaned);
      } else if (section !== "tips") bodyLines.push(cleaned);
    }
    if (!title && bodyLines.length && bodyLines[0].length < 60) {
      title = bodyLines.shift()!;
    }
    return { title, body: bodyLines.join("\n"), tags: [...new Set(tags)] };
  }

  // Hardcoded showcase entries — add works here to feature them
  interface ShowcaseEntry {
    id: string;
    category: ContentCategory;
    en?: { title: string; body: string; tags: string[]; imageDir?: string };
  }
  const SHOWCASE_ENTRIES: ShowcaseEntry[] = [
    { id: "w_20260325_1753_75d", category: "conflict" },
    { id: "w_20260329_1710_ecf", category: "envy" },
  ];

  function extractCopytextFromChat(blocks: { type: string; text: string }[]): { title: string; body: string; tags: string[] } | null {
    // Walk backwards to find the last agent message with copytext
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.type !== "text") continue;
      const text = b.text;
      // Strategy: look for "标题" + "正文" pattern
      const bodyMatch = text.match(/\*{0,2}正文\*{0,2}\s*[：:]\s*/);
      if (bodyMatch) {
        // Extract body: everything between 正文 and 标签/tags section
        const bodyStart = text.indexOf(bodyMatch[0]) + bodyMatch[0].length;
        let bodyEnd = text.length;
        const tagsIdx = text.search(/\*{0,2}(标签|话题标签)\*{0,2}\s*[：:]/);
        if (tagsIdx > bodyStart) bodyEnd = tagsIdx;
        let body = text.slice(bodyStart, bodyEnd).replace(/^>\s*/gm, "").replace(/^\n+|\n+$/g, "").trim();
        // Extract tags
        let tags: string[] = [];
        if (tagsIdx >= 0) {
          const tagsSection = text.slice(tagsIdx);
          const found = tagsSection.match(/#[\w\u4e00-\u9fff]+/g);
          if (found) tags = [...new Set(found)];
        }
        // Title = first short line of body (matches 成品tab behavior)
        let title = "";
        const bodyLines = body.split("\n").filter(l => l.trim());
        if (bodyLines.length > 1 && bodyLines[0].length < 60) {
          title = bodyLines.shift()!;
          body = bodyLines.join("\n");
        }
        if (body) return { title, body, tags };
      }
      // Fallback: look for quoted block after "发布文案"
      if (/发布文案/.test(text)) {
        const lines = text.split("\n");
        let inQuote = false;
        let bodyLines: string[] = [];
        let tags: string[] = [];
        for (const line of lines) {
          if (line.startsWith(">")) {
            inQuote = true;
            bodyLines.push(line.replace(/^>\s*/, ""));
          } else if (inQuote && !line.trim()) {
            bodyLines.push("");
          } else if (inQuote) {
            inQuote = false;
          }
          const found = line.match(/#[\w\u4e00-\u9fff]+/g);
          if (found && !line.startsWith(">")) tags.push(...found);
        }
        const cleanLines = bodyLines.filter(l => l.trim());
        let title = "";
        if (cleanLines.length > 1 && cleanLines[0].length < 60) {
          title = cleanLines.shift()!;
        }
        const body = cleanLines.join("\n").trim();
        if (body) return { title, body, tags: [...new Set(tags)] };
      }
    }
    return null;
  }

  async function loadShowcaseWork() {
    const results: ShowcaseWork[] = [];
    for (const entry of SHOWCASE_ENTRIES) {
      try {
        const res = await fetch(`/api/works/${entry.id}`);
        if (!res.ok) continue;
        const work = await res.json();

        let title = work.title ?? "";
        let body = "";
        let tags: string[] = [];
        let coverImage = "";
        let images: string[] = [];
        let assets: string[] = [];

        const assetsRes = await fetch(`/api/works/${entry.id}/assets`);
        if (assetsRes.ok) {
          const assetsData = await assetsRes.json();
          assets = assetsData.assets ?? assetsData;

          // Collect all output images (sorted by name for correct order)
          const outputImgs = assets
            .filter((f: string) => f.startsWith("output/") && /\.(png|jpe?g|webp)$/i.test(f))
            .sort();
          // Fallback to assets/images/ if no output images
          const imgPool = outputImgs.length > 0
            ? outputImgs
            : assets.filter((f: string) => f.startsWith("assets/images/") && /\.(png|jpe?g|webp)$/i.test(f)).sort();
          images = imgPool.map((f: string) => `/api/works/${entry.id}/assets/${f}`);

          // Cover: prefer output dir cover, then any cover, then first output image
          const cover = outputImgs.find((f: string) => /cover|p1/i.test(f))
            ?? assets.find((f: string) => /cover/i.test(f) && /\.(png|jpe?g|webp)$/i.test(f))
            ?? (outputImgs.length > 0 ? outputImgs[0] : null);
          if (cover) coverImage = `/api/works/${entry.id}/assets/${cover}`;

          const copytextFile = assets.find((f: string) =>
            f.startsWith("output/") && /copy|caption|文案/.test(f) && /\.(md|txt)$/i.test(f)
          ) ?? assets.find((f: string) => f.startsWith("output/") && /\.md$/i.test(f))
            ?? assets.find((f: string) => /copy|caption|文案/.test(f) && /\.(md|txt)$/i.test(f));
          if (copytextFile) {
            const copyRes = await fetch(`/api/works/${entry.id}/assets/${copytextFile}`);
            if (copyRes.ok) {
              const parsed = parseCopytext(await copyRes.text());
              if (parsed.title) title = parsed.title;
              body = parsed.body;
              tags = parsed.tags;
            }
          }
        }

        // Fallback: extract copytext from chat history if no file found
        if (!body) {
          try {
            const chatRes = await fetch(`/api/works/${entry.id}/chat`);
            if (chatRes.ok) {
              const chatData = await chatRes.json();
              const blocks = chatData.blocks ?? chatData;
              const extracted = extractCopytextFromChat(blocks);
              if (extracted) {
                if (extracted.title) title = extracted.title;
                body = extracted.body;
                if (extracted.tags.length) tags = extracted.tags;
              }
            }
          } catch {}
        }

        // Apply English overrides when language is English
        if (lang === "en" && entry.en) {
          title = entry.en.title;
          body = entry.en.body;
          tags = entry.en.tags;
          // Switch to English images if available
          if (entry.en.imageDir) {
            const enDir = entry.en.imageDir;
            const enImgs = assets
              .filter((f: string) => f.startsWith(enDir + "/") && /\.(png|jpe?g|webp)$/i.test(f))
              .sort();
            if (enImgs.length > 0) {
              images = enImgs.map((f: string) => `/api/works/${entry.id}/assets/${f}`);
              const enCover = enImgs.find((f: string) => /cover|p1/i.test(f)) ?? enImgs[0];
              coverImage = `/api/works/${entry.id}/assets/${enCover}`;
            }
          }
        }

        results.push({
          id: entry.id,
          title,
          coverImage,
          images,
          body,
          tags,
          category: entry.category,
          platforms: work.platforms ?? [],
        });
      } catch {}
    }
    showcaseWorks = results;
  }

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
          title: item.title ?? item.name ?? item.direction ?? tt("unknownDirection"),
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
        progressLines = [{ type: "error", text: tt("cannotStartResearch") }];
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
              text: `${tt("searchLabel")} "${data.query}"`,
            }];
            break;
          case "search_result": {
            const updated = [...progressLines];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].type === "search") {
                updated[i] = { type: "result", text: updated[i].text + "  " + (data.summary || tt("done")) };
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
                text: tt("aiAnalyzing"),
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
              text: data.message || tt("researchError"),
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
      progressLines = [{ type: "error", text: tt("networkError") }];
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
      dir.contentAngles?.length ? `${tt("angleLabel")} ${dir.contentAngles.join("; ")}` : "",
      dir.tags?.length ? `${tt("tagsLabel")} ${dir.tags.map(t => "#" + t).join(" ")}` : "",
    ].filter(Boolean).join("\n");

    const event = new CustomEvent("createWork", {
      bubbles: true,
      detail: { topicHint: hint, platform: activePlatform },
    });
    document.dispatchEvent(event);
  }

  function opportunityColor(opp: string): string {
    if (opp === "金矿" || opp === "Gold Mine") return "opp-gold";
    if (opp === "蓝海" || opp === "Blue Ocean") return "opp-blue";
    if (opp === "红海" || opp === "Red Ocean") return "opp-red";
    return "";
  }

  let hasData = $derived(directions.length > 0 || rawContent.length > 0);
  let platformLabel = $derived(activePlatform === "douyin" ? tt("platformDouyin") : tt("platformXiaohongshu"));

  async function loadReport() {
    try {
      const res = await fetch(`/api/trends/${activePlatform}/report`);
      if (res.ok) {
        const text = await res.text();
        if (text.trim()) reportText = text;
      }
    } catch {}
  }

  // Reload showcase when language changes
  $effect(() => {
    void lang;
    loadShowcaseWork();
  });

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
  <!-- Header: category tabs + platform filter -->
  <div class="explore-header">
    <div class="category-tabs">
      <button class="cat-tab" class:active={activeCategory === "anxiety"} onclick={() => activeCategory = "anxiety"}>
        <svg class="cat-tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <span class="cat-tab-name">{tt("categoryAnxiety")}</span>
        <span class="cat-tab-desc">{tt("categoryAnxietyDesc")}</span>
      </button>
      <button class="cat-tab" class:active={activeCategory === "conflict"} onclick={() => activeCategory = "conflict"}>
        <svg class="cat-tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <span class="cat-tab-name">{tt("categoryConflict")}</span>
        <span class="cat-tab-desc">{tt("categoryConflictDesc")}</span>
      </button>
      <button class="cat-tab" class:active={activeCategory === "comedy"} onclick={() => activeCategory = "comedy"}>
        <svg class="cat-tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-3 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-7.5 5a.5.5 0 0 1 .42-.23h8.16a.5.5 0 0 1 .42.77A5.5 5.5 0 0 1 12 17a5.5 5.5 0 0 1-4.5-2.46.5.5 0 0 1 0-.54z"/></svg>
        <span class="cat-tab-name">{tt("categoryComedy")}</span>
        <span class="cat-tab-desc">{tt("categoryComedyDesc")}</span>
      </button>
      <button class="cat-tab" class:active={activeCategory === "envy"} onclick={() => activeCategory = "envy"}>
        <svg class="cat-tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span class="cat-tab-name">{tt("categoryEnvy")}</span>
        <span class="cat-tab-desc">{tt("categoryEnvyDesc")}</span>
      </button>
    </div>
    <div class="platform-tabs">
      <button class="plat-tab" class:active={showcasePlatform === "all"} onclick={() => showcasePlatform = "all"}>
        {tt("filterAllPlatforms")}
      </button>
      <button class="plat-tab" class:active={showcasePlatform === "douyin"} onclick={() => showcasePlatform = "douyin"}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.53 1.02c1.15-.04 2.29.02 3.43.14.17 1.38.76 2.71 1.74 3.66 1 .98 2.37 1.52 3.76 1.65v3.53c-1.3-.04-2.6-.35-3.76-.92-.5-.24-.97-.53-1.4-.87-.01 2.84.01 5.68-.02 8.51-.08 1.34-.53 2.67-1.31 3.76a7.24 7.24 0 01-5.6 3.15c-1.6.13-3.24-.3-4.56-1.2A7.18 7.18 0 012 17.02c0-.3.03-.6.07-.9.24-1.7 1.15-3.27 2.48-4.33a6.82 6.82 0 014.83-1.56c.01 1.3-.01 2.6-.02 3.9-.92-.28-1.97-.13-2.77.42a3.2 3.2 0 00-1.4 2.17c-.07.58.03 1.2.34 1.72.52 1 1.64 1.7 2.83 1.73 1.15.06 2.3-.5 2.97-1.42.22-.32.4-.68.46-1.06.12-.87.1-1.75.1-2.63V1.02h2.64z"/></svg>
        {tt("douyin")}
      </button>
      <button class="plat-tab" class:active={showcasePlatform === "xiaohongshu"} onclick={() => showcasePlatform = "xiaohongshu"}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8.5v8.5H2V2zm11.5 0H22v8.5h-8.5V2zM2 13.5h8.5V22H2v-8.5zm11.5 0H22V22h-8.5v-8.5z"/></svg>
        {tt("xiaohongshu")}
      </button>
    </div>
  </div>

  <!-- Showcase: works grid -->
  <div class="showcase-grid">
    {#if filteredShowcase.length > 0}
      {#each filteredShowcase as work}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="work-card" onclick={() => { modalImageIdx = 0; selectedWork = work; }}>
          {#if work.coverImage || work.images.length > 0}
            <div class="work-cover">
              <img src={work.coverImage || work.images[0]} alt={work.title} />
              {#if work.images.length > 1}
                <span class="work-cover-count">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="2" width="15" height="15" rx="2"/><path d="M7 22h13a2 2 0 0 0 2-2V7"/></svg>
                  {work.images.length}
                </span>
              {/if}
              <div class="work-platform-tags">
                {#each work.platforms as p}
                  <span class="work-platform-tag" class:douyin={p === "douyin"} class:xhs={p === "xiaohongshu"}>
                    {p === "douyin" ? tt("platformDouyin") : tt("platformXiaohongshu")}
                  </span>
                {/each}
              </div>
            </div>
          {/if}
          <div class="work-card-body">
            <h3 class="work-card-title">{work.title}</h3>
            {#if work.body}
              <p class="work-card-text">{work.body.slice(0, 120)}{work.body.length > 120 ? "…" : ""}</p>
            {/if}
            {#if work.tags.length}
              <div class="work-card-tags">
                {#each work.tags.slice(0, 3) as tag}
                  <span class="work-card-tag">{tag}</span>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    {:else}
      <div class="showcase-empty">
        <p class="showcase-empty-text">{tt("noWorksYet")}</p>
        <p class="showcase-empty-sub">{tt("noWorksYetDesc")}</p>
      </div>
    {/if}
  </div>
</div>

<!-- Work detail modal — phone frame -->
{#if selectedWork}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="work-modal-overlay" onclick={(e) => { if ((e.target as HTMLElement).classList.contains('work-modal-overlay')) selectedWork = null; }}>
    <div class="phone-modal">
      <button class="phone-modal-close" onclick={() => selectedWork = null}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="phone-frame">
        <div class="phone-notch"></div>
        <div class="phone-screen">
          <div class="xhs-post">
            {#if selectedWork.images.length > 0}
              <div class="xhs-cover">
                <img src={selectedWork.images[modalImageIdx]} alt={selectedWork.title} />
                {#if selectedWork.images.length > 1}
                  <!-- Left/right tap zones -->
                  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                  <div class="cover-tap-left" onclick={(e) => { e.stopPropagation(); if (modalImageIdx > 0) modalImageIdx--; }}></div>
                  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                  <div class="cover-tap-right" onclick={(e) => { e.stopPropagation(); if (modalImageIdx < selectedWork!.images.length - 1) modalImageIdx++; }}></div>
                  <!-- Dot indicators -->
                  <div class="cover-dots">
                    {#each selectedWork.images as _, i}
                      <span class="cover-dot" class:active={i === modalImageIdx}></span>
                    {/each}
                  </div>
                  <!-- Counter badge -->
                  <span class="cover-counter">{modalImageIdx + 1}/{selectedWork.images.length}</span>
                {/if}
              </div>
            {:else if selectedWork.coverImage}
              <div class="xhs-cover">
                <img src={selectedWork.coverImage} alt={selectedWork.title} />
              </div>
            {/if}
            <div class="xhs-body">
              <h3 class="xhs-title">{selectedWork.title}</h3>
              <div class="xhs-author">
                <div class="xhs-avatar"></div>
                <span class="xhs-name">{tt("autoviralCreation")}</span>
                <div class="xhs-platform-badges">
                  {#each selectedWork.platforms as p}
                    <span class="work-platform-tag" class:douyin={p === "douyin"} class:xhs={p === "xiaohongshu"}>
                      {p === "douyin" ? tt("platformDouyin") : tt("platformXiaohongshu")}
                    </span>
                  {/each}
                </div>
              </div>
              {#if selectedWork.body}
                <p class="xhs-fulltext">{selectedWork.body}</p>
              {/if}
              {#if selectedWork.tags.length}
                <div class="xhs-tags">
                  {#each selectedWork.tags as tag}
                    <span class="xhs-tag">{tag}</span>
                  {/each}
                </div>
              {/if}
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
    </div>
  </div>
{/if}

{#if showConfigModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="config-overlay" onclick={(e) => { if ((e.target as HTMLElement).classList.contains('config-overlay')) closeConfigModal(); }}>
    <div class="config-modal">
      <h3 class="config-title">{tt("autoResearchLabel")}</h3>
      <p class="config-desc">
        {autoResearchOn ? tt("autoResearchOnDesc") : tt("autoResearchOffDesc")}
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
          {autoResearchOn ? tt("turnOff") : tt("turnOn")}
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

  /* Header layout */
  .explore-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
    flex-wrap: wrap;
  }

  /* Category tabs */
  .category-tabs {
    display: flex;
    gap: 0.4rem;
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

  .cat-tab-icon {
    color: var(--text-dim);
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .cat-tab.active .cat-tab-icon {
    color: var(--spark-red, #FE2C55);
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

  /* Platform tabs */
  .platform-tabs {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-inset, rgba(0,0,0,0.03));
    border-radius: 8px;
    padding: 0.2rem;
    flex-shrink: 0;
  }

  .plat-tab {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    border: none;
    background: none;
    color: var(--text-dim);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .plat-tab:hover { color: var(--text); }
  .plat-tab.active {
    background: var(--bg-elevated, #fff);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }

  /* Showcase grid */
  .showcase-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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

  /* Work cards */
  .work-card {
    background: var(--card-bg, #fff);
    border: 1px solid var(--card-border, #e5e7eb);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
    animation: fadeUp 0.3s ease both;
  }

  .work-card:hover {
    border-color: rgba(0,0,0,0.25);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.12);
  }

  .work-cover {
    width: 100%;
    aspect-ratio: 4/3;
    overflow: hidden;
    background: #f5e6e0;
    position: relative;
  }

  .work-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .work-cover-count {
    position: absolute;
    top: 8px;
    left: 8px;
    background: rgba(0,0,0,0.5);
    color: #fff;
    font-size: 0.6rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .work-platform-tags {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
  }

  .work-platform-tag {
    font-size: 0.65rem;
    font-weight: 650;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    backdrop-filter: blur(8px);
  }

  .work-platform-tag.douyin {
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
  }

  .work-platform-tag.xhs {
    background: rgba(254, 44, 85, 0.85);
    color: #fff;
  }

  .work-card-body {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .work-card-title {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--text);
    margin: 0;
    line-height: 1.35;
    letter-spacing: -0.01em;
  }

  .work-card-text {
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.6;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .work-card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.15rem;
  }

  .work-card-tag {
    font-size: 0.68rem;
    color: var(--spark-red, #FE2C55);
    font-weight: 500;
  }

  /* Work detail modal — phone frame */
  .work-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    animation: fadeIn 0.15s ease;
  }

  .phone-modal {
    position: relative;
    animation: scaleIn 0.2s ease;
  }

  .phone-modal-close {
    position: absolute;
    top: -40px;
    right: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.15);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 2;
    transition: background 0.15s;
  }

  .phone-modal-close:hover {
    background: rgba(255,255,255,0.3);
  }

  .phone-modal .phone-frame {
    width: 320px;
    background: #000;
    border-radius: 36px;
    padding: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
  }

  .phone-modal .phone-screen {
    max-height: 600px;
  }

  /* XHS post inside phone */
  .xhs-post {
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    color: #333;
  }

  .xhs-cover {
    width: 100%;
    aspect-ratio: 3/4;
    overflow: hidden;
    background: #f5e6e0;
    position: relative;
  }

  .xhs-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Tap zones for prev/next — invisible, cover left/right halves */
  .cover-tap-left, .cover-tap-right {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 40%;
    cursor: pointer;
    z-index: 2;
  }
  .cover-tap-left { left: 0; }
  .cover-tap-right { right: 0; }

  /* Dot indicators — centered at bottom like XHS/Instagram */
  .cover-dots {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 5px;
    z-index: 3;
  }
  .cover-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255,255,255,0.45);
    transition: all 0.2s;
  }
  .cover-dot.active {
    background: #fff;
    transform: scale(1.2);
  }

  /* Counter badge — top right like XHS */
  .cover-counter {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(0,0,0,0.45);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    z-index: 3;
    letter-spacing: 0.5px;
  }

  .xhs-body {
    padding: 10px 14px 14px;
  }

  .xhs-title {
    font-size: 15px;
    font-weight: 700;
    color: #222;
    margin: 0 0 8px;
    line-height: 1.4;
  }

  .xhs-author {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }

  .xhs-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: linear-gradient(135deg, #FE2C55, #FF6B6B);
    flex-shrink: 0;
  }

  .xhs-name {
    font-size: 12px;
    color: #999;
    font-weight: 500;
    flex: 1;
  }

  .xhs-platform-badges {
    display: flex;
    gap: 4px;
  }

  .xhs-fulltext {
    font-size: 13.5px;
    color: #333;
    line-height: 1.75;
    margin: 0 0 12px;
    white-space: pre-wrap;
  }

  .xhs-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }

  .xhs-tag {
    font-size: 12px;
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
    font-size: 12px;
    color: #999;
    font-weight: 500;
  }

  .xhs-action svg {
    width: 14px;
    height: 14px;
    stroke: #999;
  }

  /* Phone frame shared */
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
    overflow-y: auto;
    margin-top: -12px;
    max-height: 520px;
  }

  .phone-screen::-webkit-scrollbar { display: none; }

  .phone-home-bar {
    width: 100px;
    height: 4px;
    background: rgba(255,255,255,0.3);
    border-radius: 2px;
    margin: 6px auto 2px;
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
