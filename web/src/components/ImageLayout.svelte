<script lang="ts">
  export interface ImageInfo {
    path: string;
    order: number;
  }

  export interface CopyText {
    title: string;
    body: string;
    tags: string[];
    topics: string[];
  }

  let {
    images = [],
    copytext = null,
    workId = "",
    onReorder,
    onSelect,
    onAction,
  }: {
    images: ImageInfo[];
    copytext: CopyText | null;
    workId: string;
    onReorder?: (newOrder: string[]) => void;
    onSelect?: (path: string) => void;
    onAction?: (action: { type: string; target: string }) => void;
  } = $props();

  let dragIndex: number | null = $state(null);
  let dragOverIndex: number | null = $state(null);
  let hoveredIndex: number | null = $state(null);

  function assetUrl(path: string): string {
    return `/api/works/${encodeURIComponent(workId)}/assets/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  function handleDragStart(e: DragEvent, index: number) {
    dragIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    dragOverIndex = index;
  }

  function handleDragLeave() {
    dragOverIndex = null;
  }

  function handleDrop(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      const reordered = [...images];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(index, 0, moved);
      onReorder?.(reordered.map(img => img.path));
    }
    dragIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    dragIndex = null;
    dragOverIndex = null;
  }

  function handleClick(path: string) {
    onSelect?.(path);
  }

  function handleContextMenu(e: MouseEvent, path: string) {
    e.preventDefault();
    // Context menu could be expanded; for now fire a replace action
    onAction?.({ type: "replace", target: path });
  }
</script>

<div class="image-layout">
  <!-- Image grid section -->
  <div class="image-grid-section">
    <div class="image-grid">
      {#each images as img, i}
        <button
          class="image-card"
          class:dragging={dragIndex === i}
          class:drag-over={dragOverIndex === i && dragIndex !== i}
          draggable="true"
          ondragstart={(e) => handleDragStart(e, i)}
          ondragover={(e) => handleDragOver(e, i)}
          ondragleave={handleDragLeave}
          ondrop={(e) => handleDrop(e, i)}
          ondragend={handleDragEnd}
          onclick={() => handleClick(img.path)}
          oncontextmenu={(e) => handleContextMenu(e, img.path)}
          onmouseenter={() => (hoveredIndex = i)}
          onmouseleave={() => (hoveredIndex = null)}
        >
          <span class="order-badge">{i + 1}</span>
          <img
            class="thumb"
            src={assetUrl(img.path)}
            alt="图片 {i + 1}"
            draggable="false"
          />
          {#if hoveredIndex === i}
            <div class="hover-overlay">
              <button
                class="overlay-btn"
                onclick={(e) => { e.stopPropagation(); onAction?.({ type: "replace", target: img.path }); }}
                title="替换"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/>
                  <path d="M2.5 11.5a10 10 0 0 1 18.8-4.3"/><path d="M21.5 12.5a10 10 0 0 1-18.8 4.3"/>
                </svg>
              </button>
              <button
                class="overlay-btn overlay-btn--danger"
                onclick={(e) => { e.stopPropagation(); onAction?.({ type: "delete", target: img.path }); }}
                title="删除"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/>
                </svg>
              </button>
            </div>
          {/if}
        </button>
      {/each}

      <!-- Add card -->
      <button
        class="image-card add-card"
        onclick={() => onAction?.({ type: "add", target: "" })}
        title="添加图片"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Divider -->
  <div class="divider"></div>

  <!-- Copytext section -->
  <div class="copytext-section">
    {#if copytext}
      <h3 class="copytext-title">{copytext.title}</h3>
      <p class="copytext-body">{copytext.body}</p>
      {#if copytext.tags.length > 0 || copytext.topics.length > 0}
        <div class="tags-row">
          {#each copytext.topics as topic}
            <span class="pill pill--topic">#{topic}</span>
          {/each}
          {#each copytext.tags as tag}
            <span class="pill pill--tag">#{tag}</span>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="copytext-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span>暂无文案</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .image-layout {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-secondary);
  }

  /* ── Image grid section ── */
  .image-grid-section {
    flex: 0 0 auto;
    max-height: 60%;
    padding: 12px;
    overflow-y: auto;
  }

  .image-grid {
    display: flex;
    flex-wrap: nowrap;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .image-card {
    flex-shrink: 0;
    position: relative;
    width: 96px;
    height: 96px;
    border-radius: 8px;
    border: 2px solid var(--border);
    background: var(--bg-surface);
    cursor: pointer;
    overflow: hidden;
    padding: 0;
    transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
  }

  .image-card:hover {
    border-color: var(--text-dim);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .image-card.dragging {
    opacity: 0.4;
  }

  .image-card.drag-over {
    border-color: var(--spark-cyan, #25F4EE);
    box-shadow: 0 0 0 2px rgba(37, 244, 238, 0.25);
  }

  .order-badge {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 2;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* Hover overlay */
  .hover-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    z-index: 3;
  }

  .overlay-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: background 0.15s;
  }

  .overlay-btn:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .overlay-btn--danger:hover {
    background: rgba(254, 44, 85, 0.5);
    color: #fff;
  }

  /* Add card */
  .add-card {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    border-style: dashed;
    border-color: var(--text-dim);
  }

  .add-card:hover {
    color: var(--text-muted);
    border-color: var(--text-muted);
  }

  /* ── Divider ── */
  .divider {
    flex-shrink: 0;
    height: 1px;
    background: var(--border-subtle, rgba(255, 255, 255, 0.05));
    margin: 0 12px;
  }

  /* ── Copytext section ── */
  .copytext-section {
    flex: 1 1 40%;
    min-height: 0;
    padding: 14px 16px;
    overflow-y: auto;
  }

  .copytext-title {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 650;
    color: var(--text);
    line-height: 1.4;
  }

  .copytext-body {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.7;
    white-space: pre-wrap;
  }

  .tags-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.5;
  }

  .pill--topic {
    background: rgba(37, 244, 238, 0.12);
    color: var(--spark-cyan, #25F4EE);
  }

  .pill--tag {
    background: rgba(254, 44, 85, 0.10);
    color: var(--spark-red, #FE2C55);
  }

  /* Placeholder */
  .copytext-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 500;
  }
</style>
