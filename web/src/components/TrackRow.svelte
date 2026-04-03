<script lang="ts">
  export interface TrackItem {
    id: string;
    start: number;
    duration: number;
    label: string;
    thumbnail?: string;
    type: "clip" | "audio" | "subtitle";
  }

  let {
    label = "",
    items = [],
    totalDuration = 0,
    currentTime = 0,
    draggable = false,
    onItemClick,
    onReorder,
    onContextMenu,
  }: {
    label?: string;
    items?: TrackItem[];
    totalDuration?: number;
    currentTime?: number;
    draggable?: boolean;
    onItemClick?: (itemId: string) => void;
    onReorder?: (newOrder: string[]) => void;
    onContextMenu?: (itemId: string, event: MouseEvent) => void;
  } = $props();

  let dragSourceId: string | null = $state(null);
  let dragOverId: string | null = $state(null);

  function pct(seconds: number): string {
    if (totalDuration <= 0) return "0%";
    return `${(seconds / totalDuration) * 100}%`;
  }

  function handleDragStart(e: DragEvent, id: string) {
    if (!draggable) return;
    dragSourceId = id;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", id);
  }

  function handleDragOver(e: DragEvent, id: string) {
    if (!draggable || !dragSourceId) return;
    e.preventDefault();
    dragOverId = id;
  }

  function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggable || !dragSourceId || dragSourceId === targetId) {
      dragSourceId = null;
      dragOverId = null;
      return;
    }
    const ids = items.map(i => i.id);
    const srcIdx = ids.indexOf(dragSourceId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;
    ids.splice(srcIdx, 1);
    ids.splice(tgtIdx, 0, dragSourceId);
    onReorder?.(ids);
    dragSourceId = null;
    dragOverId = null;
  }

  function handleDragEnd() {
    dragSourceId = null;
    dragOverId = null;
  }

  function formatDur(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }
</script>

<div class="track-row">
  <div class="track-label">{label}</div>
  <div class="track-items">
    {#each items as item (item.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="track-item {item.type}"
        class:drag-over={dragOverId === item.id}
        style="width: {pct(item.duration)}; left: {pct(item.start)};"
        draggable={draggable}
        ondragstart={(e) => handleDragStart(e, item.id)}
        ondragover={(e) => handleDragOver(e, item.id)}
        ondrop={(e) => handleDrop(e, item.id)}
        ondragend={handleDragEnd}
        onclick={() => onItemClick?.(item.id)}
        oncontextmenu={(e) => { e.preventDefault(); onContextMenu?.(item.id, e); }}
      >
        {#if item.type === "clip" && item.thumbnail}
          <div class="clip-thumb" style="background-image: url({item.thumbnail})"></div>
        {/if}
        <span class="item-label">
          {item.label}
          {#if item.type === "clip"}
            <span class="item-dur">{formatDur(item.duration)}</span>
          {/if}
        </span>
      </div>
    {/each}

    <!-- Playhead -->
    {#if totalDuration > 0}
      <div class="playhead" style="left: {pct(currentTime)};"></div>
    {/if}
  </div>
</div>

<style>
  .track-row {
    display: flex;
    align-items: stretch;
    height: 48px;
    background: #1a1a2e;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .track-label {
    width: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: rgba(255,255,255,0.5);
    letter-spacing: 0.5px;
    border-right: 1px solid rgba(255,255,255,0.06);
    background: #151527;
  }

  .track-items {
    flex: 1;
    position: relative;
    padding: 4px 2px;
    display: flex;
    align-items: center;
    gap: 2px;
    overflow: hidden;
  }

  .track-item {
    position: relative;
    height: 100%;
    min-width: 20px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    overflow: hidden;
    flex-shrink: 0;
    transition: outline 0.1s;
  }

  .track-item:hover {
    outline: 1px solid rgba(255,255,255,0.3);
    outline-offset: -1px;
  }

  .track-item.drag-over {
    outline: 2px solid #FE2C55;
    outline-offset: -2px;
  }

  .track-item.clip {
    background: linear-gradient(135deg, #2d2d5e 0%, #1e1e4a 100%);
  }

  .track-item.audio {
    background: linear-gradient(135deg, #1e3a2e 0%, #15302a 100%);
  }

  .track-item.subtitle {
    background: linear-gradient(135deg, #3a2d1e 0%, #302515 100%);
  }

  .clip-thumb {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    opacity: 0.4;
  }

  .item-label {
    position: relative;
    z-index: 1;
    font-size: 10px;
    color: rgba(255,255,255,0.8);
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .item-dur {
    font-size: 9px;
    opacity: 0.6;
    margin-left: 4px;
  }

  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #FE2C55;
    z-index: 10;
    pointer-events: none;
    transition: left 0.1s linear;
    box-shadow: 0 0 4px rgba(254, 44, 85, 0.5);
  }
</style>
