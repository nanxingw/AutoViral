<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../lib/i18n";
  import MarkdownBlock from "./MarkdownBlock.svelte";

  function tt(key: string): string { return t(key); }

  let {
    workId,
    visible = true,
    refreshTrigger = 0,
    onSendMessage,
  }: {
    workId: string;
    visible: boolean;
    refreshTrigger: number;
    onSendMessage?: (text: string) => void;
  } = $props();

  interface AssetFile {
    name: string;
    path: string;
    ext: string;
    url: string;
    group: "frames" | "clips" | "images" | "output" | "other";
  }

  type CategoryTab = "all" | "frames" | "clips" | "images" | "output";
  type GridSize = "large" | "medium" | "small";
  type ViewMode = "grid" | "list";

  let files: AssetFile[] = $state([]);
  let loading = $state(false);
  let selectedFile: AssetFile | null = $state(null);
  let lightboxFile: AssetFile | null = $state(null);
  let mdPreview: { name: string; content: string } | null = $state(null);
  let activeCategory: CategoryTab = $state("all");
  let gridSize: GridSize = $state("medium");
  let viewMode: ViewMode = $state("grid");
  let showSharedPanel = $state(false);
  let aiInstruction = $state("");
  let uploading = $state(false);
  let uploadProgress = $state(0);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Shared assets state
  type SharedCategory = "characters" | "music" | "templates";
  let sharedCategory: SharedCategory = $state("characters");
  let sharedFiles: { name: string; url: string; size?: number }[] = $state([]);
  let sharedLoading = $state(false);

  function isImage(name: string) { return /\.(png|jpe?g|webp|gif|svg)$/i.test(name); }
  function isVideo(name: string) { return /\.(mp4|mov|webm|avi)$/i.test(name); }
  function isMarkdown(name: string) { return /\.md$/i.test(name); }
  function isAudio(name: string) { return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name); }

  function classifyFile(name: string): AssetFile["group"] {
    if (name.startsWith("output/") || name.startsWith("output\\")) return "output";
    if (name.includes("/frames/")) return "frames";
    if (name.includes("/clips/")) return "clips";
    if (name.includes("/images/")) return "images";
    return "other";
  }

  let assetFiles = $derived(files.filter(f => f.group !== "output"));
  let outputFiles = $derived(files.filter(f => f.group === "output"));
  let framesFiles = $derived(files.filter(f => f.group === "frames"));
  let clipsFiles = $derived(files.filter(f => f.group === "clips"));
  let imagesFiles = $derived(files.filter(f => f.group === "images"));

  let filteredFiles = $derived(() => {
    switch (activeCategory) {
      case "frames": return framesFiles;
      case "clips": return clipsFiles;
      case "images": return imagesFiles;
      case "output": return outputFiles;
      default: return [...assetFiles, ...outputFiles];
    }
  });

  let gridCols = $derived(() => {
    switch (gridSize) {
      case "large": return "repeat(auto-fill, minmax(180px, 1fr))";
      case "small": return "repeat(auto-fill, minmax(100px, 1fr))";
      default: return "repeat(auto-fill, minmax(140px, 1fr))";
    }
  });

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

  async function loadSharedAssets() {
    sharedLoading = true;
    try {
      const res = await fetch(`/api/shared-assets?category=${sharedCategory}`);
      if (res.ok) {
        const data = await res.json();
        sharedFiles = data.files ?? data.assets ?? data.items ?? [];
      } else {
        sharedFiles = [];
      }
    } catch {
      sharedFiles = [];
    } finally {
      sharedLoading = false;
    }
  }

  async function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    uploading = true;
    uploadProgress = 0;

    try {
      const formData = new FormData();
      formData.append("file", file);

      // Determine subdir based on file type
      let subdir = "images";
      if (isVideo(file.name)) subdir = "clips";

      formData.append("subdir", subdir);

      const res = await fetch(`/api/works/${encodeURIComponent(workId)}/assets/upload`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        uploadProgress = 100;
        await loadAssets();
      }
    } catch {
      // silently fail
    } finally {
      uploading = false;
      uploadProgress = 0;
      input.value = "";
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

  function handleSelect(file: AssetFile) {
    if (selectedFile?.url === file.url) {
      selectedFile = null;
    } else {
      selectedFile = file;
      aiInstruction = "";
    }
  }

  function handleSendAiInstruction() {
    if (!selectedFile || !aiInstruction.trim()) return;
    const msg = `${tt("modifyFilePrefix")} ${selectedFile.name}: ${aiInstruction.trim()}`;
    onSendMessage?.(msg);
    aiInstruction = "";
  }

  function handleDownloadAll() {
    window.open(`/api/works/${encodeURIComponent(workId)}/assets/download`, "_blank");
  }

  function handleDownloadFile(file: AssetFile) {
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name;
    a.click();
  }

  onMount(() => {
    loadAssets();
    pollTimer = setInterval(() => {
      if (visible) loadAssets();
    }, 5000);

    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  });

  $effect(() => {
    void refreshTrigger;
    if (visible) loadAssets();
  });

  $effect(() => {
    if (showSharedPanel) {
      loadSharedAssets();
    }
  });

  $effect(() => {
    void sharedCategory;
    if (showSharedPanel) {
      loadSharedAssets();
    }
  });
</script>

{#if visible}
  <div class="canvas-workspace">
    <!-- ── Toolbar ──────────────────────────────────────────────────────── -->
    <div class="toolbar">
      <div class="toolbar-left">
        <!-- Category tabs -->
        <div class="cat-tabs">
          {#each (["all", "frames", "clips", "images", "output"] as const) as cat}
            <button
              class="cat-tab"
              class:active={activeCategory === cat}
              onclick={() => { activeCategory = cat; selectedFile = null; }}
            >
              {cat === "all" ? tt("catAll") : cat === "frames" ? tt("catFrames") : cat === "clips" ? tt("catClips") : cat === "images" ? tt("catImages") : tt("catOutput")}
              <span class="cat-count">
                {cat === "all" ? files.length : cat === "frames" ? framesFiles.length : cat === "clips" ? clipsFiles.length : cat === "images" ? imagesFiles.length : outputFiles.length}
              </span>
            </button>
          {/each}
        </div>

        <!-- Shared assets button -->
        <button class="toolbar-btn" class:active={showSharedPanel} onclick={() => { showSharedPanel = !showSharedPanel; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          {tt("sharedAssetLib")}
        </button>

        <!-- Upload -->
        <label class="toolbar-btn upload-label" class:uploading>
          {#if uploading}
            <div class="mini-spinner"></div>
            {tt("uploading")}
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {tt("uploadAssets")}
          {/if}
          <input type="file" class="file-input" onchange={handleUpload} disabled={uploading} />
        </label>
      </div>

    </div>

    <!-- ── Main Area ────────────────────────────────────────────────────── -->
    <div class="workspace-body">
      <!-- Shared assets side panel -->
      {#if showSharedPanel}
        <div class="shared-panel">
          <div class="shared-panel-header">
            <span class="shared-panel-title">{tt("sharedAssetLib")}</span>
            <button class="icon-btn" onclick={() => { showSharedPanel = false; }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="shared-cat-tabs">
            {#each (["characters", "music", "templates"] as const) as cat}
              <button
                class="shared-cat-tab"
                class:active={sharedCategory === cat}
                onclick={() => { sharedCategory = cat; }}
              >
                {cat === "characters" ? tt("sharedCatCharacters") : cat === "music" ? tt("sharedCatMusic") : tt("sharedCatTemplates")}
              </button>
            {/each}
          </div>

          <div class="shared-panel-body">
            {#if sharedLoading}
              <div class="loading-center"><div class="mini-spinner"></div></div>
            {:else if sharedFiles.length === 0}
              <div class="empty-small">{tt("noSharedAssets")}</div>
            {:else}
              <div class="shared-grid">
                {#each sharedFiles as sf}
                  <div class="shared-item">
                    {#if isImage(sf.name)}
                      <div class="shared-thumb">
                        <img src={sf.url} alt={sf.name} loading="lazy" />
                      </div>
                    {:else if isAudio(sf.name)}
                      <div class="shared-audio-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                      </div>
                    {:else}
                      <div class="shared-file-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                    {/if}
                    <span class="shared-name" title={sf.name}>{sf.name}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Asset canvas -->
      <div class="asset-canvas">
        {#if loading && files.length === 0}
          <div class="canvas-empty">
            <div class="mini-spinner large"></div>
            <span>{tt("loadingAssets")}</span>
          </div>
        {:else if filteredFiles().length === 0}
          <div class="canvas-empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span class="empty-title">{tt("assetsAppearHere")}</span>
            <span class="empty-sub">{tt("assetsAppearHereSub")}</span>
            <label class="empty-upload-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {tt("manualUpload")}
              <input type="file" class="file-input" onchange={handleUpload} disabled={uploading} />
            </label>
          </div>
        {:else}
          <div class="asset-grid" style:grid-template-columns={gridCols()}>
            {#each filteredFiles() as file}
              <button
                class="asset-card"
                class:selected={selectedFile?.url === file.url}
                class:output-card={file.group === "output"}
                onclick={() => handleSelect(file)}
                ondblclick={() => {
                  if (isImage(file.name)) lightboxFile = file;
                  else if (isMarkdown(file.name)) openMdPreview(file);
                }}
              >
                <div class="card-thumb">
                  {#if isImage(file.name)}
                    <img src={file.url} alt={file.name} loading="lazy" />
                  {:else if isVideo(file.name)}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video src={file.url} preload="metadata" muted></video>
                    <div class="play-overlay">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                  {:else if isMarkdown(file.name)}
                    <div class="file-type-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    </div>
                  {:else if isAudio(file.name)}
                    <div class="file-type-icon audio">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    </div>
                  {:else}
                    <div class="file-type-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                  {/if}
                </div>

                <div class="card-label">
                  <span class="card-name" title={file.name}>{file.name}</span>
                  {#if file.group === "output"}
                    <span class="output-badge">{tt("outputBadge")}</span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}

        <!-- Selected file action panel -->
        {#if selectedFile}
          <div class="selection-panel">
            <div class="selection-preview">
              {#if isImage(selectedFile.name)}
                <img
                  src={selectedFile.url}
                  alt={selectedFile.name}
                  class="selection-img"
                  onclick={() => { lightboxFile = selectedFile; }}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => { if (e.key === "Enter") lightboxFile = selectedFile; }}
                />
              {:else if isVideo(selectedFile.name)}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={selectedFile.url} controls class="selection-video" preload="metadata"></video>
              {:else}
                <div class="selection-file-icon">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
              {/if}
            </div>

            <div class="selection-info">
              <div class="selection-name">{selectedFile.name}</div>

              <div class="selection-actions">
                <button class="action-btn primary" onclick={() => {
                  if (isImage(selectedFile!.name)) lightboxFile = selectedFile;
                  else if (isMarkdown(selectedFile!.name)) openMdPreview(selectedFile!);
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  {tt("viewLarge")}
                </button>
                <button class="action-btn" onclick={() => handleDownloadFile(selectedFile!)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {tt("downloadFile")}
                </button>
                <button class="action-btn danger" onclick={() => { selectedFile = null; }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  {tt("deselect")}
                </button>
              </div>

              <div class="ai-instruction-row">
                <textarea
                  class="ai-input"
                  placeholder={tt("aiModifyPlaceholder")}
                  rows={2}
                  bind:value={aiInstruction}
                  onkeydown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSendAiInstruction();
                  }}
                ></textarea>
                <button
                  class="ai-send-btn"
                  disabled={!aiInstruction.trim()}
                  onclick={handleSendAiInstruction}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  {tt("sendToAi")}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- ── Output Footer ─────────────────────────────────────────────────── -->
    {#if outputFiles.length > 0}
      <div class="output-footer">
        <span class="output-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          {tt("outputFiles")}
        </span>
        <div class="output-file-list">
          {#each outputFiles as file}
            <button
              class="output-chip"
              class:selected={selectedFile?.url === file.url}
              onclick={() => handleSelect(file)}
            >
              {#if isVideo(file.name)}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              {:else if isMarkdown(file.name)}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              {/if}
              {file.name}
            </button>
          {/each}
        </div>
        <button class="output-dl-btn" onclick={handleDownloadAll}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {tt("downloadAllBtn")}
        </button>
      </div>
    {/if}
  </div>

  <!-- ── Lightbox ─────────────────────────────────────────────────────────── -->
  {#if lightboxFile}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="lightbox" onclick={() => { lightboxFile = null; }}>
      {#if lightboxFile && isImage(lightboxFile.name)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <img src={lightboxFile.url} alt={lightboxFile.name} onclick={(e) => e.stopPropagation()} />
      {/if}
      <button class="lightbox-close" onclick={() => { lightboxFile = null; }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      {#if lightboxFile}
        <div class="lightbox-name">{lightboxFile.name}</div>
      {/if}
    </div>
  {/if}

  <!-- ── Markdown Modal ──────────────────────────────────────────────────── -->
  {#if mdPreview}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="lightbox" onclick={() => { mdPreview = null; }}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="md-modal" onclick={(e) => e.stopPropagation()} role="document">
        <div class="md-modal-header">
          <span>{mdPreview.name}</span>
          <button class="icon-btn" onclick={() => { mdPreview = null; }}>
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
  .canvas-workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-elevated, #111);
    overflow: hidden;
  }

  /* ── Toolbar ─────────────────────────────────────────────────────────── */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 1rem;
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
    background: var(--bg-surface, #161616);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .toolbar-left, .toolbar-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  /* Category tabs */
  .cat-tabs {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    border-radius: 10px;
    padding: 0.2rem;
    gap: 0.1rem;
  }

  .cat-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.7rem;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--text-dim, rgba(255,255,255,0.4));
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cat-tab:hover {
    color: var(--text, rgba(255,255,255,0.9));
    background: rgba(255,255,255,0.06);
  }

  .cat-tab.active {
    background: var(--accent, #e8e8e8);
    color: #fff;
    box-shadow: 0 2px 8px rgba(134,120,191,0.3);
  }

  .cat-count {
    font-size: 0.62rem;
    font-weight: 700;
    background: rgba(255,255,255,0.12);
    padding: 0.05rem 0.35rem;
    border-radius: 9999px;
    min-width: 1.1rem;
    text-align: center;
  }

  .cat-tab.active .cat-count {
    background: rgba(255,255,255,0.2);
  }

  /* Toolbar buttons */
  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.8rem;
    border-radius: 9px;
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    background: none;
    color: var(--text-dim, rgba(255,255,255,0.5));
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toolbar-btn:hover {
    color: var(--text, rgba(255,255,255,0.9));
    border-color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.08);
  }

  .toolbar-btn.active {
    color: var(--accent, #e8e8e8);
    border-color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.1);
  }

  .upload-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.8rem;
    border-radius: 9px;
    border: 1px dashed var(--border, rgba(255,255,255,0.15));
    background: none;
    color: var(--text-dim, rgba(255,255,255,0.5));
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .upload-label:hover {
    color: var(--accent, #e8e8e8);
    border-color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.08);
  }

  .upload-label.uploading {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .file-input {
    display: none;
  }

  /* Grid size buttons */
  .size-btns {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    border-radius: 8px;
    overflow: hidden;
  }

  .size-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 28px;
    border: none;
    background: none;
    color: var(--text-dim, rgba(255,255,255,0.4));
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .size-btn:hover {
    color: var(--text, rgba(255,255,255,0.9));
    background: rgba(255,255,255,0.06);
  }

  .size-btn.active {
    color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.12);
  }

  /* ── Workspace body ──────────────────────────────────────────────────── */
  .workspace-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Shared panel ────────────────────────────────────────────────────── */
  .shared-panel {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--border, rgba(255,255,255,0.08));
    display: flex;
    flex-direction: column;
    background: var(--bg-surface, #161616);
    animation: slideIn 0.2s ease;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }

  .shared-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 0.75rem;
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
  }

  .shared-panel-title {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text, rgba(255,255,255,0.9));
  }

  .shared-cat-tabs {
    display: flex;
    padding: 0.4rem 0.5rem;
    gap: 0.2rem;
  }

  .shared-cat-tab {
    flex: 1;
    padding: 0.3rem 0.3rem;
    border-radius: 7px;
    border: none;
    background: none;
    color: var(--text-dim, rgba(255,255,255,0.4));
    font-size: 0.7rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }

  .shared-cat-tab:hover { color: var(--text, rgba(255,255,255,0.9)); }
  .shared-cat-tab.active {
    background: rgba(134,120,191,0.15);
    color: var(--accent, #e8e8e8);
  }

  .shared-panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .shared-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.4rem;
  }

  .shared-item {
    border: 1px solid var(--border, rgba(255,255,255,0.07));
    border-radius: 8px;
    overflow: hidden;
    cursor: grab;
    transition: border-color 0.15s, transform 0.15s;
  }

  .shared-item:hover {
    border-color: rgba(134,120,191,0.4);
    transform: translateY(-1px);
  }

  .shared-thumb {
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    background: rgba(255,255,255,0.02);
  }

  .shared-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.2s;
  }

  .shared-item:hover .shared-thumb img {
    transform: scale(1.05);
  }

  .shared-audio-icon, .shared-file-icon {
    width: 100%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim, rgba(255,255,255,0.3));
    background: rgba(255,255,255,0.02);
  }

  .shared-name {
    display: block;
    font-size: 0.62rem;
    color: var(--text-dim, rgba(255,255,255,0.45));
    padding: 0.25rem 0.3rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Asset canvas ────────────────────────────────────────────────────── */
  .asset-canvas {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .canvas-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    text-align: center;
    color: var(--text-dim, rgba(255,255,255,0.3));
    padding: 3rem 2rem;
  }

  .empty-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted, rgba(255,255,255,0.35));
  }

  .empty-sub {
    font-size: 0.78rem;
    color: var(--text-dim, rgba(255,255,255,0.25));
    max-width: 320px;
    line-height: 1.5;
  }

  .empty-upload-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
    padding: 0.55rem 1.2rem;
    border-radius: 10px;
    border: 1px dashed rgba(134,120,191,0.35);
    background: rgba(134,120,191,0.06);
    color: var(--accent, #e8e8e8);
    font-size: 0.8rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }

  .empty-upload-btn:hover {
    border-color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.12);
  }

  /* ── Asset grid ──────────────────────────────────────────────────────── */
  .asset-grid {
    display: grid;
    gap: 0.6rem;
    align-content: start;
  }

  .asset-card {
    position: relative;
    background: rgba(255,255,255,0.02);
    border: 1.5px solid var(--border, rgba(255,255,255,0.07));
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
    display: flex;
    flex-direction: column;
  }

  .asset-card:hover {
    border-color: rgba(134,120,191,0.4);
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  }

  .asset-card.selected {
    border-color: var(--accent, #e8e8e8);
    box-shadow: 0 0 0 2px rgba(134,120,191,0.25), 0 8px 24px rgba(0,0,0,0.3);
    transform: scale(1.02);
  }

  .asset-card.output-card {
    border-color: rgba(251,191,36,0.25);
  }

  .asset-card.output-card.selected {
    border-color: rgba(251,191,36,0.7);
    box-shadow: 0 0 0 2px rgba(251,191,36,0.2), 0 8px 24px rgba(0,0,0,0.3);
  }

  .card-thumb {
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    background: rgba(255,255,255,0.02);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card-thumb img, .card-thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.25s ease;
  }

  .asset-card:hover .card-thumb img,
  .asset-card:hover .card-thumb video {
    transform: scale(1.06);
  }

  .play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.4);
    color: rgba(255,255,255,0.9);
    transition: background 0.15s;
  }

  .asset-card:hover .play-overlay {
    background: rgba(0,0,0,0.5);
  }

  .file-type-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-dim, rgba(255,255,255,0.3));
  }

  .file-type-icon.audio {
    color: rgba(134,120,191,0.5);
  }

  .card-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.3rem 0.5rem;
    gap: 0.3rem;
  }

  .card-name {
    font-size: 0.65rem;
    color: var(--text-dim, rgba(255,255,255,0.45));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .output-badge {
    font-size: 0.55rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    background: rgba(251,191,36,0.15);
    color: rgba(251,191,36,0.8);
    flex-shrink: 0;
  }

  /* ── Selection panel ─────────────────────────────────────────────────── */
  .selection-panel {
    border: 1px solid var(--accent, #e8e8e8);
    border-radius: 14px;
    background: rgba(134,120,191,0.05);
    display: flex;
    gap: 1rem;
    padding: 0.85rem;
    animation: slideUp 0.2s ease;
    flex-shrink: 0;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .selection-preview {
    flex-shrink: 0;
    width: 120px;
  }

  .selection-img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 10px;
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    cursor: zoom-in;
    transition: opacity 0.15s;
  }

  .selection-img:hover { opacity: 0.85; }

  .selection-video {
    width: 100%;
    border-radius: 10px;
    border: 1px solid var(--border, rgba(255,255,255,0.08));
  }

  .selection-file-icon {
    width: 100%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    color: var(--text-dim, rgba(255,255,255,0.3));
    background: rgba(255,255,255,0.02);
  }

  .selection-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }

  .selection-name {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text, rgba(255,255,255,0.9));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .selection-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    background: rgba(255,255,255,0.04);
    color: var(--text-secondary, rgba(255,255,255,0.7));
    font-size: 0.72rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover {
    border-color: var(--accent, #e8e8e8);
    color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.08);
  }

  .action-btn.primary {
    border-color: rgba(134,120,191,0.3);
    color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.08);
  }

  .action-btn.primary:hover {
    background: rgba(134,120,191,0.16);
  }

  .action-btn.danger:hover {
    border-color: rgba(251,113,133,0.5);
    color: rgba(251,113,133,0.9);
    background: rgba(251,113,133,0.06);
  }

  .ai-instruction-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  .ai-input {
    flex: 1;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 10px;
    padding: 0.5rem 0.7rem;
    color: var(--text, rgba(255,255,255,0.9));
    font-family: inherit;
    font-size: 0.78rem;
    line-height: 1.5;
    resize: none;
    transition: border-color 0.15s;
    min-height: 56px;
  }

  .ai-input:focus {
    outline: none;
    border-color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.05);
  }

  .ai-input::placeholder {
    color: var(--text-dim, rgba(255,255,255,0.25));
  }

  .ai-send-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.9rem;
    border-radius: 10px;
    border: none;
    background: var(--accent, #e8e8e8);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
    height: 56px;
  }

  .ai-send-btn:hover:not(:disabled) {
    background: #9589cc;
    box-shadow: 0 4px 12px rgba(134,120,191,0.4);
  }

  .ai-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Output footer ───────────────────────────────────────────────────── */
  .output-footer {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 1rem;
    border-top: 1px solid var(--border, rgba(255,255,255,0.08));
    background: var(--bg-surface, #161616);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .output-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--text-dim, rgba(255,255,255,0.4));
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .output-file-list {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    flex: 1;
  }

  .output-chip {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.7rem;
    border-radius: 8px;
    border: 1px solid var(--border, rgba(255,255,255,0.08));
    background: rgba(255,255,255,0.03);
    color: var(--text-secondary, rgba(255,255,255,0.65));
    font-size: 0.72rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
  }

  .output-chip:hover {
    border-color: rgba(251,191,36,0.4);
    color: rgba(251,191,36,0.85);
    background: rgba(251,191,36,0.06);
  }

  .output-chip.selected {
    border-color: rgba(251,191,36,0.6);
    color: rgba(251,191,36,0.9);
    background: rgba(251,191,36,0.1);
  }

  .output-dl-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.8rem;
    border-radius: 9px;
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    background: rgba(255,255,255,0.04);
    color: var(--text-secondary, rgba(255,255,255,0.6));
    font-size: 0.73rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .output-dl-btn:hover {
    border-color: var(--accent, #e8e8e8);
    color: var(--accent, #e8e8e8);
    background: rgba(134,120,191,0.08);
  }

  /* ── Shared helpers ──────────────────────────────────────────────────── */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: none;
    background: none;
    color: var(--text-dim, rgba(255,255,255,0.35));
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:hover {
    color: var(--text, rgba(255,255,255,0.9));
    background: rgba(255,255,255,0.06);
  }

  .mini-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(134,120,191,0.15);
    border-top-color: var(--accent, #e8e8e8);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  .mini-spinner.large {
    width: 32px;
    height: 32px;
    border-width: 3px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .loading-center {
    display: flex;
    justify-content: center;
    padding: 2rem;
  }

  .empty-small {
    text-align: center;
    padding: 2rem 1rem;
    font-size: 0.78rem;
    color: var(--text-dim, rgba(255,255,255,0.25));
  }

  /* ── Lightbox ────────────────────────────────────────────────────────── */
  .lightbox {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    cursor: pointer;
    animation: fadeIn 0.2s ease;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .lightbox img {
    max-width: 90vw;
    max-height: 86vh;
    border-radius: 14px;
    cursor: default;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  }

  .lightbox-close {
    position: absolute;
    top: 1.5rem;
    right: 1.5rem;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 50%;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    cursor: pointer;
    transition: background 0.15s;
    z-index: 1;
  }

  .lightbox-close:hover {
    background: rgba(255,255,255,0.2);
  }

  .lightbox-name {
    position: absolute;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(8px);
    color: rgba(255,255,255,0.8);
    font-size: 0.8rem;
    padding: 0.4rem 1rem;
    border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.1);
    white-space: nowrap;
    max-width: 80vw;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Markdown modal ──────────────────────────────────────────────────── */
  .md-modal {
    background: var(--card-bg, #1a1a2e);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 18px;
    width: min(90vw, 720px);
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    cursor: default;
    box-shadow: 0 24px 80px rgba(0,0,0,0.5);
  }

  .md-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text, rgba(255,255,255,0.9));
  }

  .md-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
  }
</style>
