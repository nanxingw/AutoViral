<script lang="ts">
  let {
    workId,
    assets = [],
    selectedAsset = null,
    onSelect,
  }: {
    workId: string;
    assets: string[];
    selectedAsset: string | null;
    onSelect?: (assetPath: string) => void;
  } = $props();

  type AssetGroup = "IMAGES" | "CLIPS" | "AUDIO" | "BGM" | "REFERENCE";

  interface ClassifiedAsset {
    path: string;
    group: AssetGroup;
    stageTag: string;
    filename: string;
  }

  const groupOrder: AssetGroup[] = ["IMAGES", "CLIPS", "AUDIO", "BGM", "REFERENCE"];

  const groupIcons: Record<AssetGroup, string> = {
    IMAGES: "🖼",
    CLIPS: "🎬",
    AUDIO: "🎙",
    BGM: "🎵",
    REFERENCE: "📄",
  };

  let collapsed: Record<string, boolean> = $state({});

  function classifyAsset(path: string): ClassifiedAsset {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const filename = path.split("/").pop() ?? path;
    const isImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
    const isClip = ["mp4", "mov", "webm"].includes(ext);
    const isAudio = ["mp3", "wav", "aac", "m4a", "ogg"].includes(ext);
    const isBgm = /bgm/i.test(path) || path.includes("bgm/");

    let group: AssetGroup = "REFERENCE";
    if (isImage) group = "IMAGES";
    else if (isClip) group = "CLIPS";
    else if (isBgm) group = "BGM";
    else if (isAudio) group = "AUDIO";

    let stageTag = "AI生成";
    if (/research\/|trends\//.test(path)) stageTag = "调研";
    else if (/output\//.test(path)) stageTag = "成品";
    else if (/bgm\//.test(path)) stageTag = "配乐";

    return { path, group, stageTag, filename };
  }

  let grouped = $derived.by(() => {
    const map: Record<AssetGroup, ClassifiedAsset[]> = {
      IMAGES: [], CLIPS: [], AUDIO: [], BGM: [], REFERENCE: [],
    };
    for (const p of assets) {
      const c = classifyAsset(p);
      map[c.group].push(c);
    }
    return map;
  });

  function assetUrl(path: string): string {
    return `/api/works/${encodeURIComponent(workId)}/assets/${encodeURIComponent(path)}`;
  }

  function toggleGroup(g: string) {
    collapsed[g] = !collapsed[g];
  }

  function isThumbnailGroup(g: AssetGroup): boolean {
    return g === "IMAGES" || g === "CLIPS";
  }
</script>

<div class="asset-sidebar">
  {#each groupOrder as g}
    {@const items = grouped[g]}
    {#if items.length > 0}
      <div class="group">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="group-header" onclick={() => toggleGroup(g)} onkeydown={() => {}}>
          <span class="group-icon">{groupIcons[g]}</span>
          <span class="group-label">{g}</span>
          <span class="group-count">{items.length}</span>
          <svg class="chevron" class:collapsed={collapsed[g]} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        {#if !collapsed[g]}
          <div class="group-content">
            {#if isThumbnailGroup(g)}
              <div class="thumb-grid">
                {#each items as item}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="thumb-item"
                    class:selected={selectedAsset === item.path}
                    onclick={() => onSelect?.(item.path)}
                    onkeydown={() => {}}
                    title={item.filename}
                  >
                    {#if g === "IMAGES"}
                      <img src={assetUrl(item.path)} alt={item.filename} loading="lazy" />
                    {:else}
                      <div class="clip-thumb">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
                      </div>
                    {/if}
                    <span class="stage-tag">{item.stageTag}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="list-items">
                {#each items as item}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="list-item"
                    class:selected={selectedAsset === item.path}
                    onclick={() => onSelect?.(item.path)}
                    onkeydown={() => {}}
                    title={item.filename}
                  >
                    <span class="item-icon">{g === "BGM" ? "🎵" : g === "AUDIO" ? "🎙" : "📄"}</span>
                    <span class="item-name">{item.filename}</span>
                    <span class="stage-tag">{item.stageTag}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/each}
  {#if assets.length === 0}
    <div class="empty-state">暂无素材</div>
  {/if}
</div>

<style>
  .asset-sidebar {
    width: 200px;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-secondary, #1a1a2e);
    padding: 0.5rem 0;
    font-size: 0.75rem;
  }

  .group {
    margin-bottom: 0.25rem;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    color: var(--text-muted, #94a3b8);
    font-weight: 600;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    user-select: none;
    transition: color 0.12s;
  }

  .group-header:hover {
    color: var(--text, #e2e8f0);
  }

  .group-icon {
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .group-label {
    flex: 1;
  }

  .group-count {
    background: var(--bg-surface, #2a2a3e);
    color: var(--text-dim, #64748b);
    font-size: 0.6rem;
    font-weight: 700;
    padding: 0.05rem 0.35rem;
    border-radius: 8px;
    min-width: 1.2rem;
    text-align: center;
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.15s;
  }
  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .group-content {
    padding: 0.2rem 0.4rem 0.4rem;
  }

  /* Thumbnail grid */
  .thumb-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .thumb-item {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    border: 2px solid transparent;
    transition: border-color 0.12s;
    background: var(--bg-surface, #2a2a3e);
  }

  .thumb-item:hover {
    border-color: var(--text-dim, #64748b);
  }

  .thumb-item.selected {
    border-color: var(--spark-red, #FE2C55);
  }

  .thumb-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .clip-thumb {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim, #64748b);
    background: var(--bg-surface, #2a2a3e);
  }

  .stage-tag {
    position: absolute;
    bottom: 2px;
    right: 2px;
    font-size: 0.55rem;
    font-weight: 600;
    padding: 0.05rem 0.25rem;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.7);
    color: var(--text-muted, #94a3b8);
    opacity: 0;
    transition: opacity 0.12s;
    pointer-events: none;
    white-space: nowrap;
  }

  .thumb-item:hover .stage-tag,
  .list-item:hover .stage-tag {
    opacity: 1;
  }

  /* List items */
  .list-items {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.4rem;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-dim, #64748b);
    position: relative;
    transition: background 0.1s, color 0.1s;
    border: 1px solid transparent;
  }

  .list-item:hover {
    background: var(--bg-surface, #2a2a3e);
    color: var(--text-muted, #94a3b8);
  }

  .list-item.selected {
    border-color: var(--spark-red, #FE2C55);
    color: var(--text, #e2e8f0);
    background: var(--bg-surface, #2a2a3e);
  }

  .item-icon {
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.7rem;
  }

  .list-item .stage-tag {
    position: static;
    opacity: 0;
    flex-shrink: 0;
  }

  .empty-state {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--text-dim, #64748b);
    font-size: 0.75rem;
  }
</style>
