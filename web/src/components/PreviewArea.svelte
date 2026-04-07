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

  function isVideo(path: string): boolean {
    return videoExts.includes(path.split('.').pop()?.toLowerCase() ?? '');
  }

  function isImage(path: string): boolean {
    return imageExts.includes(path.split('.').pop()?.toLowerCase() ?? '');
  }

  let filteredVideos = $derived(assets.filter(a => isVideo(a)));
  let filteredImages = $derived(assets.filter(a => isImage(a)));

  function assetUrl(path: string): string {
    return `/api/works/${encodeURIComponent(workId)}/assets/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  // Determine what to show: respect user selection first, regardless of content type
  let displayMode = $derived.by<"video" | "image" | "none">(() => {
    if (selectedAsset) {
      if (isVideo(selectedAsset)) return "video";
      if (isImage(selectedAsset)) return "image";
    }
    // Fallback to content type default
    if (contentType === "short-video") {
      return filteredVideos.length > 0 ? "video" : (filteredImages.length > 0 ? "image" : "none");
    }
    return filteredImages.length > 0 ? "image" : "none";
  });

  // For video: find the best video asset to show (prioritize output/final)
  let effectiveVideoAsset = $derived.by(() => {
    if (selectedAsset && isVideo(selectedAsset)) return selectedAsset;
    // Prioritize output/final videos
    const finals = filteredVideos.filter(a => /output\//i.test(a) || /final[._-]/i.test(a.split('/').pop() ?? ''));
    if (finals.length > 0) return finals[0];
    return filteredVideos.length > 0 ? filteredVideos[0] : null;
  });

  // For image: current index in the filtered list
  let currentImageIndex = $derived.by(() => {
    if (!selectedAsset) return 0;
    const idx = filteredImages.indexOf(selectedAsset);
    return idx >= 0 ? idx : 0;
  });

  let effectiveImageAsset = $derived.by(() => {
    if (selectedAsset && isImage(selectedAsset)) return selectedAsset;
    return filteredImages.length > 0 ? filteredImages[0] : null;
  });

  function navigateImage(delta: number) {
    if (filteredImages.length === 0) return;
    const newIdx = (currentImageIndex + delta + filteredImages.length) % filteredImages.length;
    onSelect?.(filteredImages[newIdx]);
  }

  function handleTimeUpdate(e: Event) {
    const video = e.target as HTMLVideoElement;
    onTimeUpdate?.(video.currentTime);
  }
</script>

<div class="preview-area">
  {#if displayMode === "video"}
    {#if effectiveVideoAsset}
      <video
        class="video-player"
        src={assetUrl(effectiveVideoAsset)}
        controls
        ontimeupdate={handleTimeUpdate}
      >
        <track kind="captions" />
      </video>
    {/if}
  {:else if displayMode === "image"}
    {#if effectiveImageAsset}
      <div class="image-viewer">
        <div class="image-main">
          {#if filteredImages.length > 1}
            <button class="nav-btn nav-prev" onclick={() => navigateImage(-1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          {/if}
          <img
            class="main-image"
            src={assetUrl(effectiveImageAsset)}
            alt={effectiveImageAsset}
          />
          {#if filteredImages.length > 1}
            <button class="nav-btn nav-next" onclick={() => navigateImage(1)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          {/if}
        </div>
        {#if filteredImages.length > 1}
          <div class="thumbnail-strip">
            {#each filteredImages as asset}
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
    {/if}
  {:else}
    <div class="placeholder">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
        {#if contentType === "short-video"}
          <path d="M23 7l-7 5 7 5V7z"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        {:else}
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        {/if}
      </svg>
      <span class="placeholder-text">暂无素材预览</span>
      <span class="placeholder-hint">从左侧选择素材或等待 AI 生成</span>
    </div>
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

  .placeholder-hint {
    font-size: 12px;
    color: var(--text-dim);
    opacity: 0.6;
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
    box-shadow: var(--shadow-md);
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
    border-radius: 0 0 var(--radius-panel) var(--radius-panel);
  }

  .thumbnail {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-element);
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    background: none;
    transition: border-color 0.15s;
  }

  .thumbnail.selected {
    border-color: var(--spark-red, #FE2C55);
    box-shadow: 0 0 0 2px var(--spark-red);
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
