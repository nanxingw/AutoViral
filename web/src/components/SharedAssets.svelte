<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../lib/i18n";

  function tt(key: string): string { return t(key); }

  let { compact = false }: { compact?: boolean } = $props();

  type Category = "characters" | "music" | "templates";

  interface AssetFile {
    name: string;
    url: string;
    size?: number;
    createdAt?: string;
  }

  let activeCategory: Category = $state("characters");
  let files: AssetFile[] = $state([]);
  let loading = $state(false);
  let uploading = $state(false);
  let previewSrc = $state("");
  let playingAudio: HTMLAudioElement | null = $state(null);

  const categoryKeys: { key: Category; labelKey: string; icon: string }[] = [
    { key: "characters", labelKey: "sharedCatCharacters", icon: "user" },
    { key: "music", labelKey: "sharedCatMusic", icon: "music" },
    { key: "templates", labelKey: "sharedCatTemplates", icon: "layout" },
  ];

  function isImage(name: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(name);
  }

  function isAudio(name: string): boolean {
    return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name);
  }

  async function loadAssets() {
    loading = true;
    try {
      const res = await fetch(`/api/shared-assets?category=${activeCategory}`);
      if (res.ok) {
        const data = await res.json();
        files = data.files ?? data.assets ?? data.items ?? [];
      } else {
        files = [];
      }
    } catch {
      files = [];
    } finally {
      loading = false;
    }
  }

  async function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    uploading = true;
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/shared-assets/${activeCategory}`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        await loadAssets();
      }
    } catch {
      // ignore
    } finally {
      uploading = false;
      input.value = "";
    }
  }

  async function handleDelete(fileName: string) {
    try {
      const res = await fetch(`/api/shared-assets/${activeCategory}/${encodeURIComponent(fileName)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        files = files.filter(f => f.name !== fileName);
      }
    } catch {
      // ignore
    }
  }

  function handlePreview(file: AssetFile) {
    if (isImage(file.name)) {
      previewSrc = file.url;
    } else if (isAudio(file.name)) {
      toggleAudio(file);
    }
  }

  function toggleAudio(file: AssetFile) {
    if (playingAudio) {
      playingAudio.pause();
      playingAudio = null;
      return;
    }
    const audio = new Audio(file.url);
    audio.play();
    audio.onended = () => { playingAudio = null; };
    playingAudio = audio;
  }

  function switchCategory(cat: Category) {
    if (cat === activeCategory) return;
    if (playingAudio) {
      playingAudio.pause();
      playingAudio = null;
    }
    activeCategory = cat;
    loadAssets();
  }

  function formatSize(bytes?: number): string {
    if (!bytes) return "";
    if (bytes > 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
    if (bytes > 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
  }

  onMount(() => {
    loadAssets();
    return () => {
      if (playingAudio) playingAudio.pause();
    };
  });
</script>

<div class="shared-assets" class:compact>
  <!-- Category tabs -->
  <div class="asset-tabs">
    {#each categoryKeys as cat}
      <button
        class="asset-tab"
        class:active={activeCategory === cat.key}
        onclick={() => switchCategory(cat.key)}
      >
        {#if cat.icon === "user"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        {:else if cat.icon === "music"}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        {/if}
        {tt(cat.labelKey)}
      </button>
    {/each}

    <label class="upload-btn" class:uploading>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      {uploading ? tt("uploading") : tt("uploadBtn")}
      <input type="file" class="file-input" onchange={handleUpload} disabled={uploading} />
    </label>
  </div>

  <!-- Content -->
  {#if loading}
    <div class="asset-loading">
      <div class="loader-sm"></div>
    </div>
  {:else if files.length === 0}
    <div class="asset-empty">
      <p>{tt("noAssetsInCategory").replace("{category}", categoryKeys.find(c => c.key === activeCategory)?.labelKey ? tt(categoryKeys.find(c => c.key === activeCategory)!.labelKey) : "")}</p>
    </div>
  {:else}
    <div class="asset-grid">
      {#each files as file}
        <div class="asset-item" class:audio-item={isAudio(file.name)}>
          {#if isImage(file.name)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="asset-thumb" onclick={() => handlePreview(file)}>
              <img src={file.url} alt={file.name} loading="lazy" />
            </div>
          {:else if isAudio(file.name)}
            <button class="audio-play-btn" onclick={() => toggleAudio(file)} aria-label={tt("playAudio")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                {#if playingAudio?.src?.includes(encodeURI(file.name))}
                  <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                {:else}
                  <polygon points="5 3 19 12 5 21 5 3"/>
                {/if}
              </svg>
            </button>
          {:else}
            <div class="asset-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
          {/if}
          <div class="asset-info">
            <span class="asset-name" title={file.name}>{file.name}</span>
            {#if file.size}
              <span class="asset-size">{formatSize(file.size)}</span>
            {/if}
          </div>
          <button class="delete-btn" onclick={() => handleDelete(file.name)} aria-label={tt("deleteAsset")} title={tt("deleteAsset")}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Image Preview Lightbox -->
{#if previewSrc}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="lightbox" onclick={() => { previewSrc = ""; }}>
    <img src={previewSrc} alt="Preview" />
  </div>
{/if}

<style>
  .shared-assets {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* ── Category tabs ───────────────────────────────────────────── */
  .asset-tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .asset-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.85rem;
    border-radius: 8px;
    border: 1px solid transparent;
    background: none;
    color: var(--text-dim);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .asset-tab:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
  }

  .asset-tab.active {
    background: rgba(0, 0, 0, 0.12);
    color: var(--accent);
    border-color: rgba(0, 0, 0, 0.2);
  }

  .asset-tab svg {
    opacity: 0.7;
  }

  .asset-tab.active svg {
    opacity: 1;
  }

  .upload-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.85rem;
    border-radius: 8px;
    border: 1px dashed rgba(255, 255, 255, 0.12);
    background: none;
    color: var(--text-dim);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    margin-left: auto;
  }

  .upload-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .upload-btn.uploading {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .file-input {
    display: none;
  }

  /* ── Loading / Empty ─────────────────────────────────────────── */
  .asset-loading {
    display: flex;
    justify-content: center;
    padding: 2rem;
  }

  .loader-sm {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(0, 0, 0, 0.15);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .asset-empty {
    padding: 2rem 1rem;
    text-align: center;
  }

  .asset-empty p {
    font-size: 0.82rem;
    color: var(--text-dim);
    font-weight: 500;
    margin: 0;
  }

  /* ── Asset grid ──────────────────────────────────────────────── */
  .asset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.625rem;
  }

  .compact .asset-grid {
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 0.5rem;
  }

  .asset-item {
    position: relative;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-color 0.2s ease, transform 0.2s ease;
  }

  .asset-item:hover {
    border-color: rgba(0, 0, 0, 0.3);
    transform: translateY(-1px);
  }

  .asset-thumb {
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.02);
  }

  .asset-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.25s ease;
  }

  .asset-item:hover .asset-thumb img {
    transform: scale(1.05);
  }

  .audio-play-btn {
    width: 100%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: linear-gradient(135deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.03));
    color: var(--accent);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .audio-play-btn:hover {
    background: linear-gradient(135deg, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0.06));
  }

  .asset-icon {
    width: 100%;
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    opacity: 0.4;
    background: rgba(255, 255, 255, 0.01);
  }

  .asset-info {
    padding: 0.4rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .asset-name {
    font-size: 0.7rem;
    font-weight: 550;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .asset-size {
    font-size: 0.62rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .delete-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: none;
    background: rgba(0, 0, 0, 0.6);
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.15s ease;
    backdrop-filter: blur(4px);
  }

  .asset-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: rgba(251, 113, 133, 0.8);
    color: white;
  }

  /* ── Compact mode ────────────────────────────────────────────── */
  .compact .asset-tabs {
    gap: 0.15rem;
  }

  .compact .asset-tab {
    padding: 0.3rem 0.65rem;
    font-size: 0.72rem;
  }

  .compact .upload-btn {
    padding: 0.3rem 0.65rem;
    font-size: 0.72rem;
  }

  .compact .asset-info {
    padding: 0.3rem 0.4rem;
  }

  .compact .asset-name {
    font-size: 0.65rem;
  }

  /* ── Lightbox ────────────────────────────────────────────────── */
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
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
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }
</style>
