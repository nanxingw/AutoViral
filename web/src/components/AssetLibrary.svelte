<script lang="ts">
  import { onMount } from "svelte";
  import { fetchSharedAssets, uploadAsset, deleteAsset, moveAsset, type AssetFile } from "../lib/api";

  const CATS = [
    { key: "characters", label: "形象参照" },
    { key: "scenes", label: "场景参照" },
    { key: "music", label: "配乐风格" },
    { key: "templates", label: "画面模板" },
    { key: "branding", label: "品牌调性" },
    { key: "general", label: "其他素材" },
  ];

  let assets: Record<string, AssetFile[]> = $state({});
  let activeCat = $state("characters");
  let viewMode: "grid" | "list" = "grid";
  let expanded = $state(false);
  let loading = $state(false);
  let dragOver = $state(false);
  let lightboxUrl: string | null = $state(null);
  let contextMenu: { asset: AssetFile; x: number; y: number } | null = $state(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let playingAudioName: string | null = $state(null);
  let audioEl: HTMLAudioElement | null = $state(null);

  let currentFiles = $derived(assets[activeCat] ?? []);
  let totalCount = $derived(
    Object.values(assets).reduce((sum, arr) => sum + arr.length, 0)
  );

  onMount(() => {
    load();
    function handleClick() { contextMenu = null; }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  });

  async function load() {
    loading = true;
    try {
      assets = await fetchSharedAssets();
    } catch {
      assets = {};
    } finally {
      loading = false;
    }
  }

  async function handleUpload(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    try {
      await uploadAsset(activeCat, files);
      await load();
    } catch {
      // ignore
    }
  }

  async function handleDelete(cat: string, name: string) {
    try {
      await deleteAsset(cat, name);
      await load();
    } catch {
      // ignore
    }
    contextMenu = null;
  }

  async function handleMove(fromCat: string, toCat: string, name: string) {
    try {
      await moveAsset(fromCat, toCat, name);
      await load();
    } catch {
      // ignore
    }
    contextMenu = null;
  }

  function fileIcon(name: string): string {
    if (isImage(name)) return "🖼️";
    if (isAudio(name)) return "🎵";
    if (/\.(mp4|mov|avi|webm|mkv)$/i.test(name)) return "🎬";
    if (/\.(pdf|doc|docx|txt|md)$/i.test(name)) return "📄";
    if (/\.(psd|ai|sketch|fig)$/i.test(name)) return "🎨";
    return "📎";
  }

  function isImage(name: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(name);
  }

  function isAudio(name: string): boolean {
    return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function assetUrl(cat: string, name: string): string {
    return `/api/shared-assets/${encodeURIComponent(cat)}/${encodeURIComponent(name)}`;
  }

  function truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max - 2) + ".." : s;
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function onDragLeave() {
    dragOver = false;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const files = e.dataTransfer?.files;
    if (files) handleUpload(files);
  }

  function onContextMenu(e: MouseEvent, asset: AssetFile) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { asset, x: e.clientX, y: e.clientY };
  }

  function toggleAudio(name: string) {
    if (playingAudioName === name && audioEl) {
      audioEl.pause();
      playingAudioName = null;
      audioEl = null;
      return;
    }
    if (audioEl) audioEl.pause();
    const el = new Audio(assetUrl(activeCat, name));
    el.play();
    el.onended = () => { playingAudioName = null; audioEl = null; };
    audioEl = el;
    playingAudioName = name;
  }

  function formatDate(mtime: string): string {
    try {
      return new Date(mtime).toLocaleDateString();
    } catch {
      return mtime;
    }
  }
</script>

<div class="asset-library">
  <!-- Header -->
  <button class="section-header" onclick={() => expanded = !expanded}>
    <span class="section-title">我的素材{#if totalCount > 0} · {totalCount}{/if}</span>
    <svg class="chevron" class:open={expanded} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  </button>

  {#if expanded}
    <div class="panel">
      <p class="guide-text">上传你的照片、场景、品牌素材等，它们将作为所有视频生成的参照物，让 AI 更准确地还原你的形象与风格。</p>

      <!-- Category tabs -->
      <div class="cat-tabs">
        {#each CATS as cat}
          <button
            class="cat-tab"
            class:active={activeCat === cat.key}
            onclick={() => activeCat = cat.key}
          >
            {cat.label}
            {#if (assets[cat.key]?.length ?? 0) > 0}
              <span class="cat-count">{assets[cat.key].length}</span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Toolbar -->
      <div class="toolbar">
        <button class="upload-btn" onclick={() => fileInput?.click()}>+ 上传</button>
        <input
          bind:this={fileInput}
          type="file"
          multiple
          class="hidden-input"
          onchange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            if (input.files) handleUpload(input.files);
            input.value = "";
          }}
        />
      </div>

      <!-- Drop zone -->
      <div
        class="drop-zone"
        class:drag-over={dragOver}
        ondragover={onDragOver}
        ondragleave={onDragLeave}
        ondrop={onDrop}
      >
        {#if loading}
          <div class="empty-msg">加载中...</div>
        {:else if currentFiles.length === 0}
          <div class="empty-msg">暂无文件，拖放或点击上传</div>
        {:else if viewMode === "grid"}
          <!-- Grid view -->
          <div class="grid-view">
            {#each currentFiles as file}
              <div
                class="grid-card"
                oncontextmenu={(e) => onContextMenu(e, file)}
              >
                {#if isImage(file.name)}
                  <button class="card-thumb" onclick={() => lightboxUrl = assetUrl(activeCat, file.name)}>
                    <img src={assetUrl(activeCat, file.name)} alt={file.name} loading="lazy" />
                  </button>
                {:else if isAudio(file.name)}
                  <button class="card-thumb audio-thumb" onclick={() => toggleAudio(file.name)}>
                    <span class="audio-icon">{playingAudioName === file.name ? "⏸" : "🎵"}</span>
                  </button>
                {:else}
                  <div class="card-thumb file-thumb">
                    <span class="file-icon">{fileIcon(file.name)}</span>
                  </div>
                {/if}
                <div class="card-name" title={file.name}>{truncate(file.name, 12)}</div>
                <div class="card-size">{formatSize(file.size)}</div>
              </div>
            {/each}
          </div>
        {:else}
          <!-- List view -->
          <table class="list-view">
            <thead>
              <tr>
                <th>文件名</th>
                <th>大小</th>
                <th>日期</th>
              </tr>
            </thead>
            <tbody>
              {#each currentFiles as file}
                <tr oncontextmenu={(e) => onContextMenu(e, file)}>
                  <td class="list-name">
                    <span class="list-icon">{fileIcon(file.name)}</span>
                    {#if isImage(file.name)}
                      <button class="link-btn" onclick={() => lightboxUrl = assetUrl(activeCat, file.name)}>{file.name}</button>
                    {:else if isAudio(file.name)}
                      <button class="link-btn" onclick={() => toggleAudio(file.name)}>{file.name}{playingAudioName === file.name ? " ⏸" : ""}</button>
                    {:else}
                      <span>{file.name}</span>
                    {/if}
                  </td>
                  <td>{formatSize(file.size)}</td>
                  <td>{formatDate(file.mtime)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Context menu -->
  {#if contextMenu}
    <div
      class="context-menu"
      style="left:{contextMenu.x}px;top:{contextMenu.y}px"
      onclick={(e) => e.stopPropagation()}
    >
      <a class="ctx-item" href={assetUrl(activeCat, contextMenu.asset.name)} download={contextMenu.asset.name}>下载</a>
      <button class="ctx-item danger" onclick={() => contextMenu && handleDelete(activeCat, contextMenu.asset.name)}>删除</button>
      <div class="ctx-divider"></div>
      <div class="ctx-label">移动到</div>
      {#each CATS.filter(c => c.key !== activeCat) as cat}
        <button class="ctx-item" onclick={() => contextMenu && handleMove(activeCat, cat.key, contextMenu.asset.name)}>{cat.label}</button>
      {/each}
    </div>
  {/if}

  <!-- Lightbox -->
  {#if lightboxUrl}
    <div class="lightbox" onclick={() => lightboxUrl = null}>
      <button class="lightbox-close" onclick={() => lightboxUrl = null}>✕</button>
      <img src={lightboxUrl} alt="preview" onclick={(e) => e.stopPropagation()} />
    </div>
  {/if}
</div>

<style>
  .asset-library {}

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text);
  }
  .section-title {
    font-size: var(--size-sm, 0.8rem);
    font-weight: 600;
    color: var(--text-muted);
  }
  .chevron {
    color: var(--text-dim);
    transition: transform 0.2s ease;
  }
  .chevron.open {
    transform: rotate(180deg);
  }

  .panel {
    margin-top: 0.65rem;
  }

  .guide-text {
    font-size: var(--size-sm, 0.78rem);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 0.75rem 0;
    padding: 0.5rem 0.75rem;
    border-left: 2px solid var(--border);
  }

  /* Category tabs */
  .cat-tabs {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.65rem;
    flex-wrap: wrap;
  }
  .cat-tab {
    padding: 0.25rem 0.6rem;
    font-size: var(--size-xs, 0.7rem);
    border: none;
    border-radius: 100px;
    background: var(--bg-surface, rgba(255,255,255,0.06));
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s;
    font-weight: 500;
  }
  .cat-tab:hover {
    color: var(--text);
    background: var(--bg-elevated);
  }
  .cat-tab.active {
    background: var(--text);
    color: var(--bg);
  }
  .cat-count {
    font-size: 0.6rem;
    opacity: 0.7;
    margin-left: 0.15rem;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .upload-btn {
    padding: 0.25rem 0.65rem;
    font-size: var(--size-xs, 0.7rem);
    font-weight: 500;
    background: none;
    color: var(--text-muted);
    border: 1px dashed var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .upload-btn:hover {
    color: var(--text);
    border-color: var(--text-dim);
  }
  .hidden-input { display: none; }

  /* Drop zone */
  .drop-zone {
    min-height: 48px;
    border: 2px dashed transparent;
    border-radius: 8px;
    transition: border-color 0.2s, background 0.2s;
  }
  .drop-zone.drag-over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .empty-msg {
    text-align: center;
    padding: 1.25rem;
    color: var(--text-dim);
    font-size: var(--size-sm, 0.78rem);
  }

  /* Grid view */
  .grid-view {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 0.35rem;
  }
  .grid-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.3rem;
    border-radius: 8px;
    background: var(--bg-surface);
    border: 1px solid transparent;
    transition: border-color 0.15s;
    cursor: default;
  }
  .grid-card:hover {
    border-color: var(--border);
  }

  .card-thumb {
    width: 100%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    overflow: hidden;
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }
  .card-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 6px;
  }
  .audio-thumb {
    background: var(--bg-elevated);
  }
  .audio-icon {
    font-size: 1.3rem;
  }
  .file-thumb {
    background: var(--bg-elevated);
    cursor: default;
  }
  .file-icon {
    font-size: 1.3rem;
  }
  .card-name {
    font-size: 0.6rem;
    color: var(--text-muted);
    margin-top: 0.2rem;
    text-align: center;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-size {
    font-size: 0.52rem;
    color: var(--text-dim);
  }

  /* List view */
  .list-view {
    width: 100%;
    font-size: var(--size-sm, 0.78rem);
    border-collapse: collapse;
  }
  .list-view th {
    text-align: left;
    padding: 0.25rem 0.5rem;
    color: var(--text-dim);
    font-weight: 500;
    border-bottom: 1px solid var(--border);
    font-size: var(--size-xs, 0.7rem);
  }
  .list-view td {
    padding: 0.25rem 0.5rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }
  .list-view tr:hover td {
    background: var(--bg-surface);
  }
  .list-name {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--text) !important;
  }
  .list-icon {
    font-size: 0.85rem;
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
    text-align: left;
  }
  .link-btn:hover {
    text-decoration: underline;
  }

  /* Context menu */
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.3rem 0;
    min-width: 120px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 0.35rem 0.75rem;
    font-size: var(--size-sm, 0.78rem);
    color: var(--text);
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    text-decoration: none;
  }
  .ctx-item:hover {
    background: var(--bg-surface);
  }
  .ctx-item.danger {
    color: var(--spark-red);
  }
  .ctx-divider {
    height: 1px;
    background: var(--border);
    margin: 0.2rem 0;
  }
  .ctx-label {
    padding: 0.2rem 0.75rem;
    font-size: var(--size-xs, 0.7rem);
    color: var(--text-dim);
    font-weight: 600;
  }

  /* Lightbox */
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0,0,0,0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .lightbox img {
    max-width: 90vw;
    max-height: 90vh;
    border-radius: 8px;
    cursor: default;
  }
  .lightbox-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    font-size: 1.5rem;
    color: #fff;
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s;
  }
  .lightbox-close:hover { opacity: 1; }
</style>
