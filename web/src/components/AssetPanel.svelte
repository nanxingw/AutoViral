<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import { updateWorkApi } from "../lib/api";
  import MarkdownBlock from "./MarkdownBlock.svelte";

  let {
    workId,
    visible = false,
    refreshTrigger = 0,
    showOutput = false,
    topicHint = "",
    chatBlocks = [],
    onTitleFound,
  }: {
    workId: string;
    visible: boolean;
    refreshTrigger: number;
    showOutput?: boolean;
    topicHint?: string;
    chatBlocks?: Array<{ type: string; text: string }>;
    onTitleFound?: (title: string) => void;
  } = $props();

  // When showOutput changes to true, switch to output tab
  $effect(() => {
    if (showOutput) activeSection = "output";
  });

  let lang = $state(getLanguage());
  function tt(key: string): string { void lang; return t(key); }

  interface AssetFile {
    name: string;
    path: string;
    ext: string;
    url: string;
    group: "frames" | "clips" | "images" | "output" | "other";
  }

  let files: AssetFile[] = $state([]);
  let loading = $state(false);
  let usePortrait = $state(false);
  let showPortraitTooltip = $state(false);

  async function togglePortrait() {
    usePortrait = !usePortrait;
    await updateWorkApi(workId, { usePortrait } as any).catch(() => {});
  }
  let lightboxSrc = $state("");
  let mdPreview: { name: string; content: string } | null = $state(null);
  let activeSection: "assets" | "output" = $state("output");
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let outputCopytext = $state("");
  let dyPaused = $state(true);

  interface PlatformCopy {
    platform: string; // "douyin" | "xiaohongshu"
    title: string;
    body: string;
    tags: string[];
    topics: string[];
    publishTips: string[];
  }

  let copyPlatform: "douyin" | "xiaohongshu" = $state("douyin");

  function parseCopytextMulti(raw: string): PlatformCopy[] {
    const results: PlatformCopy[] = [];
    // Split by top-level headings that mention platform names
    const platformBlocks = raw.split(/^#\s+.*/m).filter(Boolean);
    const platformHeaders = raw.match(/^#\s+.*/gm) ?? [];

    // If no platform headers found, treat entire text as single block
    if (platformHeaders.length === 0) {
      results.push(parseSingleBlock(raw, "douyin"));
      return results;
    }

    for (let i = 0; i < platformHeaders.length; i++) {
      const header = platformHeaders[i].toLowerCase();
      let platform: "douyin" | "xiaohongshu" = "douyin";
      if (/小红书|xiaohongshu|xhs/i.test(header)) platform = "xiaohongshu";
      else if (/抖音|douyin|tiktok/i.test(header)) platform = "douyin";
      const block = platformBlocks[i] ?? "";
      results.push(parseSingleBlock(block, platform));
    }
    return results;
  }

  function parseSingleBlock(block: string, platform: "douyin" | "xiaohongshu"): PlatformCopy {
    const lines = block.split("\n");
    let currentSection = "";
    let title = "";
    let bodyLines: string[] = [];
    let tags: string[] = [];
    let topics: string[] = [];
    let publishTips: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Detect section headers (## 标题, ## 文案, ## 正文, ## 标签, ## 话题, ## 发布建议)
      const sectionMatch = line.match(/^#{2,3}\s+(.+)/);
      if (sectionMatch) {
        const name = sectionMatch[1].trim().toLowerCase();
        if (/标题|title/.test(name)) currentSection = "title";
        else if (/文案|正文|body|caption|copy/.test(name)) currentSection = "body";
        else if (/标签|tag|hashtag/.test(name)) currentSection = "tags";
        else if (/话题|topic/.test(name)) currentSection = "topics";
        else if (/发布建议|publish.?tip|注意事项/.test(name)) currentSection = "tips";
        else currentSection = "body"; // unknown sections go to body
        continue;
      }
      // Skip markdown artifacts
      if (line === "---" || line === "***") continue;

      const cleaned = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]\s+/, "");

      switch (currentSection) {
        case "title":
          if (!title) title = cleaned;
          break;
        case "tags": {
          const found = cleaned.match(/#[\w\u4e00-\u9fff\u00c0-\u024f]+/g);
          if (found) tags.push(...found);
          else if (cleaned) tags.push(cleaned.startsWith("#") ? cleaned : "#" + cleaned);
          break;
        }
        case "topics": {
          const found = cleaned.match(/#[\w\u4e00-\u9fff\u00c0-\u024f]+/g);
          if (found) topics.push(...found);
          else if (cleaned) topics.push(cleaned.startsWith("#") ? cleaned : "#" + cleaned);
          break;
        }
        case "tips":
          publishTips.push(cleaned);
          break;
        default:
          bodyLines.push(cleaned);
      }
    }

    // Fallback: if no title found, use first short line of body
    if (!title && bodyLines.length) {
      const first = bodyLines[0];
      if (first.length < 60) { title = first; bodyLines.shift(); }
    }

    return {
      platform,
      title,
      body: bodyLines.join("\n"),
      tags: [...new Set(tags)],
      topics: [...new Set(topics)],
      publishTips,
    };
  }

  function isImage(name: string) { return /\.(png|jpe?g|webp|gif|svg)$/i.test(name); }
  function isVideo(name: string) { return /\.(mp4|mov|webm|avi)$/i.test(name); }
  function isMarkdown(name: string) { return /\.md$/i.test(name); }
  function isText(name: string) { return /\.(txt|json|yaml|yml)$/i.test(name); }

  function isFinalVideo(name: string): boolean {
    const filename = (name.split("/").pop() ?? "").toLowerCase();
    return /\.(mp4|mov|webm)$/i.test(filename) && /final/.test(filename);
  }

  function classifyFile(name: string): AssetFile["group"] {
    if (name.startsWith("output/") || name.startsWith("output\\")) return "output";
    // Any video with "final" in the filename is a finished output, regardless of directory
    if (isFinalVideo(name)) return "output";
    if (name.startsWith("assets/frames/") || name.includes("/frames/")) return "frames";
    if (name.startsWith("assets/clips/") || name.includes("/clips/")) return "clips";
    if (name.startsWith("assets/images/") || name.includes("/images/")) return "images";
    return "other";
  }

  // Output tab: final video OR images (output/ dir first, then assets/images/ for image-text content)
  let finalVideo = $derived(files.find(f => isFinalVideo(f.path)));
  let outputDirImages = $derived(files.filter(f => f.group === "output" && isImage(f.name)));
  let galleryImages = $derived(files.filter(f => f.group === "images" && isImage(f.name)));
  // Use output/ images if available, otherwise fall back to assets/images/ for image-text works
  let outputImages = $derived(outputDirImages.length > 0 ? outputDirImages : (finalVideo ? [] : galleryImages));
  // Look for copytext: first in output/ dir, then any .md/.txt with "copy"/"caption"/"文案" in name, then any .md in output group
  let outputCopytextFile = $derived(
    files.find(f => f.group === "output" && (isMarkdown(f.name) || isText(f.name))) ??
    files.find(f => (isMarkdown(f.name) || isText(f.name)) && /copy|caption|文案|publish/i.test(f.name)) ??
    files.find(f => isMarkdown(f.name) && f.group === "other")
  );
  let hasOutput = $derived(!!finalVideo || outputImages.length > 0);
  let outputImageSet = $derived(new Set(outputImages));
  let assetFiles = $derived(files.filter(f => f !== finalVideo && f !== outputCopytextFile && !outputImageSet.has(f)));
  let outputFiles = $derived(finalVideo ? [finalVideo] : outputImages);
  let carouselIdx = $state(0);
  // Reset carousel only when the image count actually changes
  let prevImageCount = 0;
  $effect(() => {
    const len = outputImages.length;
    if (len !== prevImageCount) {
      prevImageCount = len;
      if (carouselIdx >= len) carouselIdx = Math.max(0, len - 1);
    }
  });

  let framesFiles = $derived(assetFiles.filter(f => f.group === "frames"));
  let clipsFiles = $derived(assetFiles.filter(f => f.group === "clips"));
  let imagesFiles = $derived(assetFiles.filter(f => f.group === "images"));
  let otherFiles = $derived(assetFiles.filter(f => f.group === "other"));

  async function loadAssets() {
    if (!workId) return;
    loading = true;
    try {
      const res = await fetch(`/api/works/${encodeURIComponent(workId)}/assets`);
      if (!res.ok) { files = []; return; }
      const data = await res.json();
      files = (data.assets ?? data.files ?? []).map((name: string) => ({
        name: name.split("/").pop() ?? name,
        path: name,
        ext: name.split(".").pop()?.toLowerCase() ?? "",
        url: `/api/works/${encodeURIComponent(workId)}/assets/${name.split("/").map(encodeURIComponent).join("/")}`,
        group: classifyFile(name),
      }));
    } catch {
      files = [];
    } finally {
      loading = false;
    }
  }

  async function openMdPreview(file: AssetFile) {
    try {
      const res = await fetch(file.url);
      const text = await res.text();
      mdPreview = { name: file.name, content: text };
    } catch {
      mdPreview = { name: file.name, content: "(Failed to load)" };
    }
  }

  async function loadChatFallback() {
    try {
      const res = await fetch(`/api/works/${workId}/chat`);
      if (!res.ok) return;
      const data = await res.json();
      const blocks = (data?.blocks ?? []) as Array<{ type: string; text: string }>;
      const extracted = extractCopytextFromChat(blocks);
      if (extracted) {
        outputCopytext = extracted;
        if (onTitleFound) {
          const platforms = parseCopytextMulti(extracted);
          const title = platforms[0]?.title;
          if (title) onTitleFound(title);
        }
      }
    } catch {}
  }

  async function loadCopytext() {
    if (!outputCopytextFile) { outputCopytext = ""; return; }
    try {
      const res = await fetch(outputCopytextFile.url);
      outputCopytext = await res.text();
      // Extract title from copytext and notify parent to update work title
      if (outputCopytext && onTitleFound) {
        const platforms = parseCopytextMulti(outputCopytext);
        const title = platforms[0]?.title;
        if (title) onTitleFound(title);
      }
    } catch { outputCopytext = ""; }
  }

  // Load copytext whenever the file appears; fall back to chat extraction
  $effect(() => {
    if (outputCopytextFile) {
      loadCopytext();
    } else {
      // Fallback: extract copytext from chat blocks (agent may have written it inline)
      let extracted = extractCopytextFromChat(chatBlocks);
      // If current session blocks don't have it, try loading persisted chat history
      if (!extracted) {
        loadChatFallback();
      } else {
        outputCopytext = extracted;
        if (onTitleFound) {
          const platforms = parseCopytextMulti(extracted);
          const title = platforms[0]?.title;
          if (title) onTitleFound(title);
        }
      }
    }
  });

  function extractCopytextFromChat(blocks: Array<{ type: string; text: string }>): string {
    if (!blocks.length) return "";
    const allText = blocks.filter(b => b.type === "text" && b.text.length > 80).map(b => b.text);

    // Strategy 1: Find "发布文案" or "配套发布文案" section with quoted (>) or plain text
    for (const text of [...allText].reverse()) {
      const match = text.match(/(?:配套)?发布文案[：:\s]*\n([\s\S]+?)(?:\n\n(?:标签|最佳|互动|预期|---)|$)/);
      if (match) {
        const body = match[1].replace(/^>\s?/gm, "").trim();
        if (body.length > 50) return buildCopytext(text, body);
      }
    }

    // Strategy 2: Find "完整文案" section (research step output)
    for (const text of [...allText].reverse()) {
      const match = text.match(/完整文案[：:\s]*\n([\s\S]+?)(?:\n\n\*{0,2}标签|$)/);
      if (match) {
        const body = match[1].replace(/^>\s?/gm, "").trim();
        if (body.length > 80) return buildCopytext(text, body);
      }
    }

    // Strategy 3: Find substantial quoted text blocks (> lines) = inline copytext
    for (const text of [...allText].reverse()) {
      const quotedLines = text.split("\n").filter(l => /^>\s/.test(l));
      if (quotedLines.length >= 5) {
        const body = quotedLines.map(l => l.replace(/^>\s?/, "")).join("\n").trim();
        if (body.length > 100) return buildCopytext(text, body);
      }
    }

    return "";
  }

  function buildCopytext(fullBlock: string, body: string): string {
    // Extract tags: multiple formats
    let tags = "";
    // Format: **标签**：`#tag1` `#tag2` or 标签：#tag1 #tag2
    const inlineTagMatch = fullBlock.match(/\*{0,2}标签\*{0,2}[：:]\s*(.+)/g);
    if (inlineTagMatch) {
      tags = inlineTagMatch
        .map(l => l.replace(/\*{0,2}标签\*{0,2}[：:]\s*/, "").replace(/`/g, ""))
        .join("\n");
    }
    // Format: ### 标签 (section header) followed by tag lines
    if (!tags) {
      const sectionMatch = fullBlock.match(/#{1,3}\s*标签\s*\n([\s\S]+?)(?:\n\n|$)/);
      if (sectionMatch) {
        tags = sectionMatch[1].trim();
      }
    }
    // Format: 话题标签 section
    if (!tags) {
      const topicMatch = fullBlock.match(/#{1,3}\s*话题标签?\s*\n([\s\S]+?)(?:\n\n|$)/);
      if (topicMatch) {
        tags = topicMatch[1].trim();
      }
    }
    // Last resort: collect all lines that are mostly hashtags
    if (!tags) {
      const tagLines = fullBlock.split("\n").filter(l => {
        const ht = l.match(/#[\w\u4e00-\u9fff]+/g);
        return ht && ht.length >= 2 && l.trim().length < 120;
      });
      if (tagLines.length) tags = tagLines.join("\n");
    }

    // Extract title
    const titleMatch = fullBlock.match(/\*{0,2}标题\*{0,2}[：:]\s*(.+)/);
    let title = titleMatch ? titleMatch[1].replace(/\*+|`/g, "").trim() : "";
    const lines = body.split("\n").filter(l => l.trim());
    if (!title && lines[0] && lines[0].length < 50) title = lines.shift()!;

    const parts = [];
    if (title) parts.push(`## 标题\n${title}`);
    parts.push(`## 正文\n${lines.join("\n")}`);
    if (tags) parts.push(`## 标签\n${tags.replace(/`/g, "")}`);
    return parts.join("\n\n");
  }


  onMount(() => {
    const unsub = subscribe(() => { lang = getLanguage(); });
    loadAssets();

    // Auto-refresh every 5 seconds
    pollTimer = setInterval(() => {
      if (visible) loadAssets();
    }, 5000);

    return () => {
      unsub();
      if (pollTimer) clearInterval(pollTimer);
    };
  });

  $effect(() => {
    void refreshTrigger;
    if (visible) loadAssets();
  });
</script>

{#if visible}
  <div class="asset-panel">
    <div class="panel-header">
      <div class="tab-row">
        <button class="panel-tab" class:active={activeSection === "assets"} onclick={() => activeSection = "assets"}>
          {tt("assets")}
          <span class="tab-count">{assetFiles.length}</span>
        </button>
        <button class="panel-tab" class:active={activeSection === "output"} onclick={() => activeSection = "output"}>
          {tt("output")}
          <span class="tab-count">{outputFiles.length}</span>
        </button>
      </div>
    </div>

    <div class="panel-body">
      {#if loading && files.length === 0}
        <div class="loading-state">
          <div class="mini-loader"></div>
          {tt("loading")}
        </div>
      {:else if activeSection === "assets"}
        <div class="portrait-switch-row">
          <span class="portrait-label">{tt("usePortraitLabel")}</span>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="portrait-info"
            onmouseenter={() => showPortraitTooltip = true}
            onmouseleave={() => showPortraitTooltip = false}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            {#if showPortraitTooltip}
              <span class="portrait-tooltip">{tt("usePortraitTooltip")}</span>
            {/if}
          </span>
          <button class="switch" class:on={usePortrait} onclick={togglePortrait}>
            <span class="switch-thumb"></span>
          </button>
        </div>
        {#if assetFiles.length === 0}
          <div class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span>{tt("noAssetsYet")}</span>
          </div>
        {:else}
          <!-- Frames -->
          {#if framesFiles.length > 0}
            <div class="section-label">Frames</div>
            <div class="image-grid">
              {#each framesFiles as file}
                {#if isImage(file.name)}
                  <button class="thumb" onclick={() => { lightboxSrc = file.url; }}>
                    <img src={file.url} alt={file.name} loading="lazy" />
                    <span class="thumb-name">{file.name}</span>
                  </button>
                {:else}
                  <a class="file-item-sm" href={file.url} download={file.name}>
                    <span>{file.name}</span>
                  </a>
                {/if}
              {/each}
            </div>
          {/if}

          <!-- Clips -->
          {#if clipsFiles.length > 0}
            <div class="section-label">Clips</div>
            {#each clipsFiles as file}
              {#if isVideo(file.name)}
                <div class="video-item">
                  <div class="video-wrapper">
                    <video controls preload="metadata" src={file.url}></video>
                  </div>
                  <span class="file-name">{file.name}</span>
                </div>
              {:else}
                <a class="file-item-sm" href={file.url} download={file.name}>
                  <span>{file.name}</span>
                </a>
              {/if}
            {/each}
          {/if}

          <!-- Images -->
          {#if imagesFiles.length > 0}
            <div class="section-label">Images</div>
            <div class="image-grid">
              {#each imagesFiles as file}
                {#if isImage(file.name)}
                  <button class="thumb" onclick={() => { lightboxSrc = file.url; }}>
                    <img src={file.url} alt={file.name} loading="lazy" />
                    <span class="thumb-name">{file.name}</span>
                  </button>
                {:else}
                  <a class="file-item-sm" href={file.url} download={file.name}>
                    <span>{file.name}</span>
                  </a>
                {/if}
              {/each}
            </div>
          {/if}

          <!-- Other files -->
          {#if otherFiles.length > 0}
            <div class="section-label">Files</div>
            {#each otherFiles as file}
              {#if isImage(file.name)}
                <button class="thumb-single" onclick={() => { lightboxSrc = file.url; }}>
                  <img src={file.url} alt={file.name} loading="lazy" />
                  <span class="thumb-name">{file.name}</span>
                </button>
              {:else if isVideo(file.name)}
                <div class="video-item">
                  <div class="video-wrapper">
                    <video controls preload="metadata" src={file.url}></video>
                  </div>
                  <span class="file-name">{file.name}</span>
                </div>
              {:else if isMarkdown(file.name) || isText(file.name)}
                <button class="md-item" onclick={() => openMdPreview(file)}>
                  <span class="md-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  </span>
                  <span class="file-name">{file.name}</span>
                </button>
              {:else}
                <a class="file-item" href={file.url} download={file.name}>
                  <span class="file-name">{file.name}</span>
                  <span class="dl-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </span>
                </a>
              {/if}
            {/each}
          {/if}
        {/if}

      {:else}
        <!-- Output section: phone-frame preview -->
        {#if !hasOutput}
          <div class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <span>{tt("noAssetsYet")}</span>
          </div>
        {:else}
          <div class="output-showcase">
            <div class="preview-phone">
              <div class="preview-notch"></div>
              {#if finalVideo}
                <!-- Douyin-style video preview -->
                <div class="preview-screen preview-screen-dark">
                  <div class="dy-container">
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video
                      class="dy-video"
                      src={finalVideo.url}
                      loop
                      playsinline
                      preload="auto"
                      onclick={(e) => {
                        const v = e.currentTarget as HTMLVideoElement;
                        if (v.paused) v.play(); else v.pause();
                        dyPaused = v.paused;
                      }}
                      onplay={() => dyPaused = false}
                      onpause={() => dyPaused = true}
                    ></video>
                    {#if dyPaused}
                      <div class="dy-play-btn">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)"><polygon points="6,3 20,12 6,21"/></svg>
                      </div>
                    {/if}
                    <div class="dy-side">
                      <div class="dy-act">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                        <span class="dy-act-n">2.4w</span>
                      </div>
                      <div class="dy-act">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        <span class="dy-act-n">3.6k</span>
                      </div>
                      <div class="dy-act">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                        <span class="dy-act-n">8.1k</span>
                      </div>
                    </div>
                    {#if outputCopytext}
                      {@const allPlatforms = parseCopytextMulti(outputCopytext)}
                      {@const currentCopy = allPlatforms.find(p => p.platform === copyPlatform) ?? allPlatforms[0]}
                      {#if currentCopy}
                        <div class="dy-info">
                          <span class="dy-author">@AutoViral</span>
                          <p class="dy-desc">{currentCopy.title || currentCopy.body.slice(0, 60)}</p>
                          {#if currentCopy.tags.length}
                            <div class="dy-tags">
                              {#each currentCopy.tags.slice(0, 4) as tag}
                                <span class="dy-tag">{tag}</span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    {/if}
                  </div>
                </div>
              {:else}
                <!-- XHS-style image-text preview -->
                <div class="preview-screen">
                  <div class="xhs-post">
                    {#if outputImages.length > 0}
                      <div class="xhs-cover">
                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                        <img src={outputImages[carouselIdx].url} alt={outputImages[carouselIdx].name} onclick={() => { lightboxSrc = outputImages[carouselIdx].url; }} />
                        {#if outputImages.length > 1}
                          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                          <div class="xhs-tap-left" onclick={(e) => { e.stopPropagation(); if (carouselIdx > 0) carouselIdx--; }}></div>
                          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                          <div class="xhs-tap-right" onclick={(e) => { e.stopPropagation(); if (carouselIdx < outputImages.length - 1) carouselIdx++; }}></div>
                          <div class="xhs-dots">
                            {#each outputImages as _, i}
                              <span class="xhs-dot" class:active={i === carouselIdx}></span>
                            {/each}
                          </div>
                          <span class="xhs-counter">{carouselIdx + 1}/{outputImages.length}</span>
                        {/if}
                      </div>
                    {/if}
                    <div class="xhs-body">
                      {#if outputCopytext}
                        {@const allPlatforms = parseCopytextMulti(outputCopytext)}
                        {@const currentCopy = allPlatforms.find(p => p.platform === copyPlatform) ?? allPlatforms[0]}
                        {#if currentCopy}
                          {#if currentCopy.title}
                            <h3 class="xhs-title">{currentCopy.title}</h3>
                          {/if}
                          <div class="xhs-author-row">
                            <div class="xhs-avatar"></div>
                            <span class="xhs-name">AutoViral</span>
                          </div>
                          {#if currentCopy.body}
                            <p class="xhs-text">{currentCopy.body}</p>
                          {/if}
                          {#if currentCopy.tags.length || currentCopy.topics.length}
                            <div class="xhs-tags">
                              {#each currentCopy.topics as topic}
                                <span class="xhs-tag">{topic}</span>
                              {/each}
                              {#each currentCopy.tags as tag}
                                <span class="xhs-tag">{tag}</span>
                              {/each}
                            </div>
                          {/if}
                        {/if}
                      {/if}
                      <div class="xhs-actions">
                        <span class="xhs-act"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> 2.4w</span>
                        <span class="xhs-act"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 4H5a2 2 0 0 0-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V6a2 2 0 0 0-2-2z"/></svg> 8.1k</span>
                        <span class="xhs-act"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> 3.6k</span>
                      </div>
                    </div>
                  </div>
                </div>
              {/if}
              <div class="preview-home-bar"></div>
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer: upload + download -->
    {#if activeSection === "assets"}
      <div class="panel-footer">
        <label class="footer-btn secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          {tt("uploadAsset")}
          <input type="file" class="sr-only" onchange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const formData = new FormData();
            formData.append("file", file);
            formData.append("path", "clips/" + file.name);
            fetch(`/api/works/${encodeURIComponent(workId)}/assets/upload`, { method: "POST", body: formData }).then(() => loadAssets()).catch(() => {});
          }} />
        </label>
        <button class="footer-btn secondary" onclick={() => window.open(`/api/works/${encodeURIComponent(workId)}/assets/download`, "_blank")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {tt("downloadAll")}
        </button>
      </div>
    {/if}
  </div>

  <!-- Lightbox -->
  {#if lightboxSrc}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="lightbox" onclick={() => { lightboxSrc = ""; }}>
      <img src={lightboxSrc} alt="Preview" />
      <button class="lightbox-close" onclick={() => { lightboxSrc = ""; }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  {/if}

  <!-- Markdown preview modal -->
  {#if mdPreview}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="lightbox" onclick={() => { mdPreview = null; }}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="md-modal" onclick={(e) => e.stopPropagation()} role="document">
        <div class="md-modal-header">
          <span>{mdPreview.name}</span>
          <button class="close-btn" onclick={() => { mdPreview = null; }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="md-modal-body">
          <MarkdownBlock text={mdPreview.content} />
        </div>
      </div>
    </div>
  {/if}

{/if}

<style>
  /* Portrait switch */
  .portrait-switch-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .portrait-label {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .portrait-info {
    position: relative;
    display: flex;
    align-items: center;
    color: var(--text-dim);
    cursor: help;
    margin-right: auto;
  }
  .portrait-tooltip {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-inset);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.45rem 0.65rem;
    font-size: 0.68rem;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.45;
    white-space: normal;
    width: 200px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    pointer-events: none;
  }
  .switch {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--text-dim);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s ease;
    flex-shrink: 0;
    padding: 0;
  }
  .switch.on { background: var(--spark-red, #FE2C55); }
  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.2);
  }
  .switch.on .switch-thumb { transform: translateX(16px); }

  .asset-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-left: 1px solid var(--border);
    background: var(--bg-elevated);
  }

  /* Header tabs */
  .panel-header {
    border-bottom: 1px solid var(--border);
    padding: 0;
  }

  .tab-row {
    display: flex;
  }

  .panel-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    padding: 0.65rem 0.5rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .panel-tab:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .panel-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-count {
    font-size: 0.62rem;
    font-weight: 700;
    background: var(--bg-surface);
    color: var(--text-dim);
    padding: 0.05rem 0.4rem;
    border-radius: 9999px;
    min-width: 1.2rem;
    text-align: center;
  }

  .panel-tab.active .tab-count {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0.75rem;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem 0;
    color: var(--text-dim);
    font-size: 0.78rem;
  }

  .mini-loader {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 2.5rem 0;
  }

  .section-label {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0.75rem 0 0.35rem;
    padding: 0 0.1rem;
  }

  /* Image grid */
  .image-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .thumb, .thumb-single {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    transition: all 0.15s ease;
    display: flex;
    flex-direction: column;
  }

  .thumb:hover, .thumb-single:hover {
    border-color: var(--accent);
    transform: scale(1.02);
  }

  .thumb img, .thumb-single img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
  }

  .thumb-single {
    margin-bottom: 0.4rem;
  }

  .thumb-single img {
    aspect-ratio: 16/10;
  }

  .thumb-name {
    font-size: 0.62rem;
    color: var(--text-dim);
    padding: 0.2rem 0.35rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Video */
  .video-item {
    margin-bottom: 0.5rem;
  }

  .video-wrapper {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .video-item video,
  .output-showcase video {
    width: 100%;
    display: block;
  }

  .file-name {
    font-size: 0.72rem;
    color: var(--text-secondary);
    display: block;
    margin-top: 0.15rem;
  }

  /* Small file item */
  .file-item-sm {
    display: block;
    font-size: 0.72rem;
    color: var(--text-muted);
    padding: 0.3rem 0.4rem;
    text-decoration: none;
    border-radius: 6px;
    transition: background 0.1s;
  }

  .file-item-sm:hover { background: var(--bg-hover); color: var(--text); }

  /* Markdown item */
  .md-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.65rem;
    width: 100%;
    cursor: pointer;
    font-family: inherit;
    color: var(--text);
    transition: border-color 0.15s;
    margin-bottom: 0.3rem;
    text-align: left;
  }
  .md-item:hover { border-color: var(--accent); }
  .md-icon { color: var(--text-dim); display: flex; }

  /* File download item */
  .file-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    text-decoration: none;
    color: var(--text);
    margin-bottom: 0.3rem;
    transition: border-color 0.15s;
    font-size: 0.78rem;
  }
  .file-item:hover { border-color: var(--accent); }
  .dl-icon { color: var(--accent); display: flex; }

  /* Footer */
  .panel-footer {
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex-shrink: 0;
  }


  /* Unified footer buttons */
  .footer-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 4px;
    padding: 0.45rem 0.75rem;
    font-family: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .footer-btn.secondary {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .footer-btn.secondary:hover { border-color: var(--text-dim); color: var(--text); }

  .footer-btn.primary {
    background: var(--text);
    color: var(--bg);
    border: none;
  }
  .footer-btn.primary:hover { opacity: 0.85; }

  /* Link modal */
  .link-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    width: min(90vw, 380px);
    cursor: default;
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.3));
  }

  .link-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.15rem;
    border-bottom: 1px solid var(--border);
  }

  .link-modal-head h3 {
    font-family: var(--font-display, inherit);
    font-size: 0.92rem;
    font-weight: 650;
  }

  .link-modal-body {
    padding: 1rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .link-desc {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.5;
  }

  .link-input {
    width: 100%;
    padding: 0.5rem 0.7rem;
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.8rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }
  .link-input:focus { border-color: var(--text-muted); }
  .link-input::placeholder { color: var(--text-dim); }

  .link-confirm {
    width: 100%;
    padding: 0.5rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .link-confirm:hover { opacity: 0.85; }
  .link-confirm:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Output showcase — phone frame preview */
  .output-showcase {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem 0;
  }

  .preview-phone {
    width: 280px;
    background: #000;
    border-radius: 32px;
    padding: 8px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06);
    position: relative;
  }
  .preview-notch {
    width: 72px;
    height: 20px;
    background: #000;
    border-radius: 0 0 12px 12px;
    margin: 0 auto -10px;
    position: relative;
    z-index: 2;
  }
  .preview-screen {
    background: #fff;
    border-radius: 24px;
    overflow: hidden;
    overflow-y: auto;
    max-height: 500px;
  }
  .preview-screen::-webkit-scrollbar { display: none; }
  .preview-screen-dark {
    background: #000;
  }
  .preview-home-bar {
    width: 90px;
    height: 4px;
    background: rgba(255,255,255,0.3);
    border-radius: 2px;
    margin: 6px auto 2px;
  }

  /* Douyin video preview inside phone */
  .dy-container {
    position: relative;
    width: 100%;
    height: 500px;
    background: #000;
    cursor: pointer;
    border-radius: 24px;
    overflow: hidden;
  }
  .dy-video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
  .dy-play-btn {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    opacity: 0.9;
  }
  .dy-side {
    position: absolute;
    right: 6px;
    bottom: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    z-index: 3;
  }
  .dy-act {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .dy-act svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); }
  .dy-act-n {
    font-size: 9px;
    color: #fff;
    font-weight: 600;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }
  .dy-info {
    position: absolute;
    bottom: 10px;
    left: 8px;
    right: 44px;
    z-index: 3;
  }
  .dy-author {
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0,0,0,0.7);
    margin-bottom: 4px;
  }
  .dy-desc {
    font-size: 10px;
    color: #fff;
    line-height: 1.4;
    margin: 0 0 4px;
    text-shadow: 0 1px 3px rgba(0,0,0,0.7);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .dy-tags { display: flex; flex-wrap: wrap; gap: 3px; }
  .dy-tag {
    font-size: 9px;
    color: #fff;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }

  /* XHS image-text preview inside phone */
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
    cursor: pointer;
  }
  .xhs-tap-left, .xhs-tap-right {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 40%;
    cursor: pointer;
    z-index: 2;
  }
  .xhs-tap-left { left: 0; }
  .xhs-tap-right { right: 0; }
  .xhs-dots {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    z-index: 3;
  }
  .xhs-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(255,255,255,0.45);
    transition: all 0.2s;
  }
  .xhs-dot.active { background: #fff; transform: scale(1.2); }
  .xhs-counter {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0,0,0,0.45);
    color: #fff;
    font-size: 0.6rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 8px;
    z-index: 3;
  }
  .xhs-body { padding: 8px 12px 12px; }
  .xhs-title {
    font-size: 13px;
    font-weight: 700;
    color: #222;
    margin: 0 0 6px;
    line-height: 1.4;
  }
  .xhs-author-row {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 8px;
  }
  .xhs-avatar {
    width: 20px;
    height: 20px;
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
    font-size: 12px;
    color: #333;
    line-height: 1.7;
    margin: 0 0 8px;
    white-space: pre-wrap;
  }
  .xhs-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-bottom: 8px;
  }
  .xhs-tag {
    font-size: 11px;
    color: #FE2C55;
    font-weight: 500;
  }
  .xhs-actions {
    display: flex;
    justify-content: space-around;
    padding-top: 6px;
    border-top: 1px solid #f0f0f0;
  }
  .xhs-act {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: #999;
    font-weight: 500;
  }
  .xhs-act svg { width: 12px; height: 12px; stroke: #999; }

  /* Publish button & dropdown */
  .publish-wrap {
    position: relative;
  }

  .publish-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: 4px;
    padding: 0.55rem 0.75rem;
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .publish-btn:hover { opacity: 0.85; }

  .publish-dropdown {
    position: absolute;
    bottom: calc(100% + 0.35rem);
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.3));
    z-index: 10;
    animation: dropIn 0.1s ease;
  }

  @keyframes dropIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .publish-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.6rem 0.85rem;
    background: none;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s;
    text-align: left;
  }

  .publish-option:hover {
    background: var(--bg-hover, rgba(255,255,255,0.04));
  }

  .publish-option + .publish-option {
    border-top: 1px solid var(--border);
  }

  /* Lightbox */
  .lightbox {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    cursor: pointer;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .lightbox img {
    max-width: 90vw;
    max-height: 90vh;
    border-radius: 12px;
    cursor: default;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .lightbox-close {
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    cursor: pointer;
    transition: background 0.15s;
  }

  .lightbox-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* Markdown modal */
  .md-modal {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    width: min(90vw, 700px);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    cursor: default;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .md-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    font-size: 0.85rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    display: flex;
    padding: 0.2rem;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .close-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .md-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }


  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
