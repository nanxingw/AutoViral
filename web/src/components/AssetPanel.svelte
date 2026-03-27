<script lang="ts">
  import { onMount } from "svelte";
  import { t, getLanguage, subscribe } from "../lib/i18n";
  import MarkdownBlock from "./MarkdownBlock.svelte";

  let {
    workId,
    visible = false,
    refreshTrigger = 0,
    showOutput = false,
    onEditAsset,
    topicHint = "",
  }: {
    workId: string;
    visible: boolean;
    refreshTrigger: number;
    showOutput?: boolean;
    onEditAsset?: (assetName: string, assetUrl: string) => void;
    topicHint?: string;
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
  let lightboxSrc = $state("");
  let mdPreview: { name: string; content: string } | null = $state(null);
  let activeSection: "assets" | "output" = $state("output");
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let outputCopytext = $state("");

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
        else if (/发布|建议|publish|tip/.test(name)) currentSection = "tips";
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

  function handleEditAsset(file: AssetFile) {
    onEditAsset?.(file.name, file.url);
  }

  function handleDownloadAll() {
    // Open the download endpoint
    window.open(`/api/works/${encodeURIComponent(workId)}/assets/download`, "_blank");
  }

  async function loadCopytext() {
    if (!outputCopytextFile) { outputCopytext = ""; return; }
    try {
      const res = await fetch(outputCopytextFile.url);
      outputCopytext = await res.text();
    } catch { outputCopytext = ""; }
  }

  // Load copytext whenever the file appears
  $effect(() => {
    if (outputCopytextFile) loadCopytext();
    else outputCopytext = "";
  });


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
                  <div class="asset-card">
                    <button class="thumb" onclick={() => { lightboxSrc = file.url; }}>
                      <img src={file.url} alt={file.name} loading="lazy" />
                      <span class="thumb-name">{file.name}</span>
                    </button>
                    {#if onEditAsset}<button class="edit-btn" onclick={() => handleEditAsset(file)} title="编辑此素材">✏️ 编辑</button>{/if}
                  </div>
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
                  <div class="asset-row">
                    <span class="file-name">{file.name}</span>
                    {#if onEditAsset}<button class="edit-btn" onclick={() => handleEditAsset(file)} title="编辑此素材">✏️ 编辑</button>{/if}
                  </div>
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
                  <div class="asset-card">
                    <button class="thumb" onclick={() => { lightboxSrc = file.url; }}>
                      <img src={file.url} alt={file.name} loading="lazy" />
                      <span class="thumb-name">{file.name}</span>
                    </button>
                    {#if onEditAsset}<button class="edit-btn" onclick={() => handleEditAsset(file)} title="编辑此素材">✏️ 编辑</button>{/if}
                  </div>
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
        <!-- Output section: final video or images + copytext -->
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
            {#if finalVideo}
              <div class="video-wrapper">
                <video controls preload="metadata" src={finalVideo.url}></video>
              </div>
            {/if}
            {#if outputImages.length > 0}
              <div class="carousel">
                <div class="carousel-viewport">
                  <button class="carousel-img" onclick={() => { lightboxSrc = outputImages[carouselIdx].url; }}>
                    <img src={outputImages[carouselIdx].url} alt={outputImages[carouselIdx].name} />
                  </button>
                </div>
                {#if outputImages.length > 1}
                  <div class="carousel-controls">
                    <button class="carousel-arrow" disabled={carouselIdx <= 0} onclick={() => carouselIdx--}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span class="carousel-counter">{carouselIdx + 1} / {outputImages.length}</span>
                    <button class="carousel-arrow" disabled={carouselIdx >= outputImages.length - 1} onclick={() => carouselIdx++}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
            {#if outputCopytext}
              {@const allPlatforms = parseCopytextMulti(outputCopytext)}
              {@const currentCopy = allPlatforms.find(p => p.platform === copyPlatform) ?? allPlatforms[0]}
              {#if allPlatforms.length > 1}
                <div class="platform-filter">
                  <button class="pf-btn" class:active={copyPlatform === "douyin"} onclick={() => copyPlatform = "douyin"}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.53 1.02c1.15-.04 2.29.02 3.43.14.17 1.38.76 2.71 1.74 3.66 1 .98 2.37 1.52 3.76 1.65v3.53c-1.3-.04-2.6-.35-3.76-.92-.5-.24-.97-.53-1.4-.87-.01 2.84.01 5.68-.02 8.51-.08 1.34-.53 2.67-1.31 3.76a7.24 7.24 0 01-5.6 3.15c-1.6.13-3.24-.3-4.56-1.2A7.18 7.18 0 012 17.02c0-.3.03-.6.07-.9.24-1.7 1.15-3.27 2.48-4.33a6.82 6.82 0 014.83-1.56c.01 1.3-.01 2.6-.02 3.9-.92-.28-1.97-.13-2.77.42a3.2 3.2 0 00-1.4 2.17c-.07.58.03 1.2.34 1.72.52 1 1.64 1.7 2.83 1.73 1.15.06 2.3-.5 2.97-1.42.22-.32.4-.68.46-1.06.12-.87.1-1.75.1-2.63V1.02h2.64z"/></svg>
                    {tt("douyin")}
                  </button>
                  <button class="pf-btn" class:active={copyPlatform === "xiaohongshu"} onclick={() => copyPlatform = "xiaohongshu"}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h8.5v8.5H2V2zm11.5 0H22v8.5h-8.5V2zM2 13.5h8.5V22H2v-8.5zm11.5 0H22V22h-8.5v-8.5z"/></svg>
                    {tt("xiaohongshu")}
                  </button>
                </div>
              {/if}
              {#if currentCopy}
                <div class="copytext-card">
                  {#if currentCopy.title}
                    <h3 class="ct-title">{currentCopy.title}</h3>
                  {/if}
                  {#if currentCopy.body}
                    <p class="ct-body">{currentCopy.body}</p>
                  {/if}
                  {#if currentCopy.tags.length || currentCopy.topics.length}
                    <div class="ct-tags">
                      {#each currentCopy.topics as topic}
                        <span class="ct-tag ct-topic">{topic}</span>
                      {/each}
                      {#each currentCopy.tags as tag}
                        <span class="ct-tag">{tag}</span>
                      {/each}
                    </div>
                  {/if}
                  {#if currentCopy.publishTips.length}
                    <div class="ct-tips">
                      {#each currentCopy.publishTips as tip}
                        <p class="ct-tip">{tip}</p>
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="copytext-card"><p class="ct-body">{outputCopytext}</p></div>
              {/if}
            {:else if topicHint}
              <div class="copytext-card">
                <p class="ct-body">{topicHint}</p>
              </div>
            {/if}
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
        <button class="footer-btn secondary" onclick={handleDownloadAll}>
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

  /* Asset card with edit button */
  .asset-card {
    display: flex;
    flex-direction: column;
  }

  .asset-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem;
  }

  .edit-btn {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.15rem 0.35rem;
    font-size: 0.6rem;
    font-family: inherit;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.12s;
    white-space: nowrap;
    margin-top: 0.15rem;
    align-self: stretch;
  }

  .edit-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }

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

  /* Output showcase */
  .output-showcase {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .carousel {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .carousel-viewport {
    /* Fixed iPhone 14 ratio, full width matching copytext card below */
    width: 100%;
    height: 480px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .carousel-img {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
  .carousel-img img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
  }
  .carousel-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
  }
  .carousel-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    width: 28px;
    height: 28px;
    cursor: pointer;
    transition: all 0.12s;
    padding: 0;
  }
  .carousel-arrow:hover:not(:disabled) { color: var(--text); border-color: var(--text-muted); }
  .carousel-arrow:disabled { opacity: 0.25; cursor: not-allowed; }
  .carousel-counter {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
    min-width: 3em;
    text-align: center;
  }

  /* Platform filter */
  .platform-filter {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .pf-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.35rem 0.7rem;
    border: 1.5px solid var(--border);
    border-radius: 9999px;
    background: none;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }
  .pf-btn:hover { border-color: var(--text-dim); color: var(--text); }
  .pf-btn.active {
    border-color: var(--text);
    background: var(--text);
    color: var(--bg);
  }

  /* Copytext card — native app feel */
  .copytext-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .ct-title {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.45;
    margin: 0;
  }

  .ct-body {
    font-size: 0.8rem;
    color: var(--text);
    line-height: 1.75;
    white-space: pre-line;
    margin: 0;
  }

  .ct-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.15rem;
    margin-top: 0.1rem;
  }

  .ct-tag {
    font-size: 0.72rem;
    font-weight: 500;
    color: #4b9bff;
    background: none;
    padding: 0;
  }
  :global([data-theme="light"]) .ct-tag { color: #2563eb; }

  .ct-topic {
    font-weight: 600;
  }

  .ct-tips {
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
    margin-top: 0.15rem;
  }

  .ct-tip {
    font-size: 0.68rem;
    color: var(--text-muted);
    line-height: 1.55;
    margin: 0.1rem 0;
  }

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
