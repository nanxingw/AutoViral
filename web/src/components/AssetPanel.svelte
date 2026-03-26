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
  }: {
    workId: string;
    visible: boolean;
    refreshTrigger: number;
    showOutput?: boolean;
    onEditAsset?: (assetName: string, assetUrl: string) => void;
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
  let activeSection: "assets" | "output" = $state("assets");
  let pollTimer: ReturnType<typeof setInterval> | null = null;

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

  let assetFiles = $derived(files.filter(f => f.group !== "output"));
  let outputFiles = $derived(files.filter(f => f.group === "output"));

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

        <!-- Upload button at bottom of assets tab -->
        <label class="upload-btn-bottom">
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

      {:else}
        <!-- Output section -->
        {#if outputFiles.length === 0}
          <div class="empty-state">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <span>{tt("noAssetsYet")}</span>
          </div>
        {:else}
          {#each outputFiles as file}
            {#if isImage(file.name)}
              <div class="asset-card">
                <button class="thumb-single" onclick={() => { lightboxSrc = file.url; }}>
                  <img src={file.url} alt={file.name} loading="lazy" />
                  <span class="thumb-name">{file.name}</span>
                </button>
                {#if onEditAsset}<button class="edit-btn" onclick={() => handleEditAsset(file)} title="编辑此素材">✏️ 编辑</button>{/if}
              </div>
            {:else if isVideo(file.name)}
              <div class="video-item">
                <div class="video-wrapper">
                  <video controls preload="metadata" src={file.url}></video>
                </div>
                <div class="asset-row">
                  <span class="file-name">{file.name}</span>
                  {#if onEditAsset}<button class="edit-btn" onclick={() => handleEditAsset(file)} title="编辑此素材">✏️ 编辑</button>{/if}
                </div>
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
    </div>

    <!-- Download all button -->
    {#if files.length > 0}
      <div class="panel-footer">
        <button class="download-all-btn" onclick={handleDownloadAll}>
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

  .video-item video {
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
  }

  .download-all-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.5rem 0.75rem;
    color: var(--text);
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .download-all-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
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

  .upload-btn-bottom {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.55rem;
    margin-top: 0.75rem;
    border: 1px dashed var(--border);
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-family: var(--font-body, inherit);
    font-size: var(--size-sm, 0.8rem);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
  }

  .upload-btn-bottom:hover {
    border-color: var(--text-dim);
    color: var(--text-secondary);
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
