<script lang="ts">
  let {
    contentType = "short-video",
    workId,
    assets = [],
    selectedAsset = null,
    onSelect,
    onTimeUpdate,
  }: {
    contentType: "short-video" | "image-text";
    workId: string;
    assets: string[];
    selectedAsset: string | null;
    onSelect?: (path: string) => void;
    onTimeUpdate?: (seconds: number) => void;
  } = $props();

  const videoExts = ['mp4', 'mov', 'webm'];
  const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

  let filteredAssets = $derived.by(() => {
    const exts = contentType === "short-video" ? videoExts : imageExts;
    return assets.filter(a => exts.includes(a.split('.').pop()?.toLowerCase() ?? ''));
  });

  function assetUrl(path: string): string {
    return `/api/works/${encodeURIComponent(workId)}/assets/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  // For short-video: find a final video if nothing selected
  let effectiveVideoAsset = $derived.by(() => {
    if (selectedAsset) return selectedAsset;
    const finals = filteredAssets.filter(a => /final/i.test(a));
    if (finals.length > 0) return finals[0];
    return filteredAssets.length > 0 ? filteredAssets[0] : null;
  });

  // For image-text: current index in the filtered list
  let currentImageIndex = $derived.by(() => {
    if (!selectedAsset) return 0;
    const idx = filteredAssets.indexOf(selectedAsset);
    return idx >= 0 ? idx : 0;
  });

  let effectiveImageAsset = $derived.by(() => {
    if (selectedAsset && filteredAssets.includes(selectedAsset)) return selectedAsset;
    return filteredAssets.length > 0 ? filteredAssets[0] : null;
  });

  function navigateImage(delta: number) {
    if (filteredAssets.length === 0) return;
    const newIdx = (currentImageIndex + delta + filteredAssets.length) % filteredAssets.length;
    onSelect?.(filteredAssets[newIdx]);
  }

  function handleTimeUpdate(e: Event) {
    const video = e.target as HTMLVideoElement;
    onTimeUpdate?.(video.currentTime);
  }
</script>

<div class="preview-area">
  {#if contentType === "short-video"}
    <!-- Video mode -->
    {#if effectiveVideoAsset}
      <video
        class="video-player"
        src={assetUrl(effectiveVideoAsset)}
        controls
        ontimeupdate={handleTimeUpdate}
      >
        <track kind="captions" />
      </video>
    {:else}
      <div class="placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
          <path d="M23 7l-7 5 7 5V7z"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
        <span class="placeholder-text">暂无视频</span>
      </div>
    {/if}
  {:else}
    <!-- Image-text mode -->
    {#if effectiveImageAsset}
      <div class="image-viewer">
        <div class="image-main">
          {#if filteredAssets.length > 1}
            <button class="nav-btn nav-prev" onclick={() => navigateImage(-1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          {/if}
          <img
            class="main-image"
            src={assetUrl(effectiveImageAsset)}
            alt={effectiveImageAsset}
          />
          {#if filteredAssets.length > 1}
            <button class="nav-btn nav-next" onclick={() => navigateImage(1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          {/if}
        </div>
        {#if filteredAssets.length > 1}
          <div class="thumbnail-strip">
            {#each filteredAssets as asset}
              <button
                class="thumbnail"
                class:selected={asset === effectiveImageAsset}
                onclick={() => onSelect?.(asset)}
              >
                <img src={assetUrl(asset)} alt={asset} />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <span class="placeholder-text">暂无图片</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .preview-area {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary, #0A0A0F);
    overflow: hidden;
    position: relative;
  }

  /* Video player */
  .video-player {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }

  /* Placeholder */
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dim);
  }

  .placeholder-text {
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.5px;
    color: var(--text-dim);
  }

  /* Image viewer */
  .image-viewer {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .image-main {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .main-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transition: opacity 0.2s ease;
  }

  /* Navigation buttons */
  .nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: var(--bg-surface, rgba(0, 0, 0, 0.5));
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }

  .nav-btn:hover {
    background: var(--bg-elevated, rgba(0, 0, 0, 0.7));
    color: var(--text);
  }

  .nav-prev { left: 12px; }
  .nav-next { right: 12px; }

  /* Thumbnail strip */
  .thumbnail-strip {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    overflow-x: auto;
    background: var(--bg-secondary, rgba(0, 0, 0, 0.3));
  }

  .thumbnail {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: 4px;
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    background: none;
    transition: border-color 0.15s;
  }

  .thumbnail.selected {
    border-color: var(--spark-red, #FE2C55);
  }

  .thumbnail:hover:not(.selected) {
    border-color: var(--text-dim);
  }

  .thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
