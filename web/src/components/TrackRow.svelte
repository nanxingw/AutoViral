<script lang="ts">
  import { renderFilmstrip } from "../lib/filmstrip";
  import { renderWaveform, renderFakeWaveform } from "../lib/waveform";

  export interface TrackItem {
    id: string;
    start: number;
    duration: number;
    label: string;
    thumbnail?: string;
    audioUrl?: string;
    type: "clip" | "audio" | "subtitle";
  }

  let {
    label = "",
    icon = "",
    items = [],
    totalDuration = 0,
    currentTime = 0,
    trackHeight = 65,
    draggable = false,
    selectedItemId = null,
    onItemClick,
    onReorder,
    onContextMenu,
    onTrim,
  }: {
    label?: string;
    icon?: string;
    items?: TrackItem[];
    totalDuration?: number;
    currentTime?: number;
    trackHeight?: number;
    draggable?: boolean;
    selectedItemId?: string | null;
    onItemClick?: (itemId: string) => void;
    onReorder?: (newOrder: string[]) => void;
    onContextMenu?: (itemId: string, event: MouseEvent) => void;
    onTrim?: (itemId: string, side: "left" | "right", deltaSec: number) => void;
  } = $props();

  // --- Drag & drop state ---
  let dragSourceId: string | null = $state(null);
  let dragOverId: string | null = $state(null);

  // --- Canvas refs ---
  let canvasRefs: Map<string, HTMLCanvasElement> = new Map();
  let trackItemsEl: HTMLDivElement | undefined = $state(undefined);

  // --- Trim state ---
  let trimming: { itemId: string; side: "left" | "right"; startX: number } | null = $state(null);

  // --- Helpers ---
  function pct(seconds: number): string {
    if (totalDuration <= 0) return "0%";
    return `${(seconds / totalDuration) * 100}%`;
  }

  function pctNum(seconds: number): number {
    if (totalDuration <= 0) return 0;
    return (seconds / totalDuration) * 100;
  }

  function formatDur(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function itemWidthPx(item: TrackItem): number {
    if (!trackItemsEl || totalDuration <= 0) return 0;
    const containerWidth = trackItemsEl.clientWidth;
    return Math.max(40, (item.duration / totalDuration) * containerWidth);
  }

  // --- Canvas rendering (guarded to prevent infinite re-render loops) ---
  let renderedKeys = new Set<string>();

  $effect(() => {
    const _items = items;
    const _el = trackItemsEl;
    if (!_el) return;

    const computedStyle = getComputedStyle(document.documentElement);
    const waveformColor = computedStyle.getPropertyValue("--waveform-color").trim() || "rgba(168, 85, 247, 0.6)";

    for (const item of _items) {
      const canvas = canvasRefs.get(item.id);
      if (!canvas) continue;

      const w = itemWidthPx(item);
      const h = trackHeight - 8;
      if (w <= 0 || h <= 0) continue;

      // Build a unique key from item id + dimensions to avoid re-rendering
      const key = `${item.id}:${Math.round(w)}x${Math.round(h)}`;
      if (renderedKeys.has(key)) continue;
      renderedKeys.add(key);

      if (item.type === "clip" && item.thumbnail) {
        renderFilmstrip({
          videoUrl: item.thumbnail,
          canvas,
          width: w,
          height: h,
        });
      } else if (item.type === "audio") {
        if (item.audioUrl) {
          renderWaveform({
            audioUrl: item.audioUrl,
            canvas,
            width: w,
            height: h,
            color: waveformColor,
          }).then((ok) => {
            if (!ok) renderFakeWaveform(canvas, w, h, waveformColor);
          });
        } else {
          renderFakeWaveform(canvas, w, h, waveformColor);
        }
      }
    }
  });

  // --- Drag handlers ---
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
    const ids = items.map((i) => i.id);
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

  // --- Trim handlers ---
  function handleTrimStart(e: PointerEvent, itemId: string, side: "left" | "right") {
    e.stopPropagation();
    e.preventDefault();
    trimming = { itemId, side, startX: e.clientX };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleTrimMove(e: PointerEvent) {
    if (!trimming || !trackItemsEl) return;
    // Visual feedback is handled via CSS on the trim handle
  }

  function handleTrimEnd(e: PointerEvent) {
    if (!trimming || !trackItemsEl) return;
    const deltaX = e.clientX - trimming.startX;
    const containerWidth = trackItemsEl.clientWidth;
    const deltaSec = (deltaX / containerWidth) * totalDuration;
    if (Math.abs(deltaSec) > 0.01) {
      onTrim?.(trimming.itemId, trimming.side, deltaSec);
    }
    trimming = null;
  }

  function bindCanvas(el: HTMLCanvasElement, id: string) {
    canvasRefs.set(id, el);
  }
</script>

<div class="track-row" style="height: {trackHeight}px;">
  <div class="track-label">
    {#if icon}
      <span class="track-icon">{icon}</span>
    {/if}
    {#if label}
      <span class="track-label-text">{label}</span>
    {/if}
  </div>

  <div class="track-items" bind:this={trackItemsEl}>
    {#each items as item (item.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
      <div
        class="track-item {item.type}"
        class:drag-over={dragOverId === item.id}
        class:selected={selectedItemId === item.id}
        class:dragging={dragSourceId === item.id}
        style="flex: 0 0 {pctNum(item.duration)}%; min-width: 40px; height: {trackHeight - 8}px;"
        draggable={draggable}
        ondragstart={(e) => handleDragStart(e, item.id)}
        ondragover={(e) => handleDragOver(e, item.id)}
        ondrop={(e) => handleDrop(e, item.id)}
        ondragend={handleDragEnd}
        onclick={() => onItemClick?.(item.id)}
        oncontextmenu={(e) => { e.preventDefault(); onContextMenu?.(item.id, e); }}
      >
        <!-- Canvas for clip / audio -->
        {#if item.type === "clip" || item.type === "audio"}
          <canvas
            class="item-canvas"
            use:bindCanvas={item.id}
          ></canvas>
        {/if}

        <!-- Label overlay -->
        <div class="item-overlay" class:subtitle-overlay={item.type === "subtitle"}>
          <span class="item-label">{item.label}</span>
          {#if item.type === "clip"}
            <span class="item-dur">{formatDur(item.duration)}</span>
          {/if}
        </div>

        <!-- Trim handles (only when selected) -->
        {#if selectedItemId === item.id}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="trim-handle trim-left"
            class:trim-active={trimming?.itemId === item.id && trimming?.side === "left"}
            onpointerdown={(e) => handleTrimStart(e, item.id, "left")}
            onpointermove={handleTrimMove}
            onpointerup={handleTrimEnd}
          ></div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="trim-handle trim-right"
            class:trim-active={trimming?.itemId === item.id && trimming?.side === "right"}
            onpointerdown={(e) => handleTrimStart(e, item.id, "right")}
            onpointermove={handleTrimMove}
            onpointerup={handleTrimEnd}
          ></div>
        {/if}
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
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .track-label {
    width: var(--track-header-width, 80px);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.5px;
    border-right: 1px solid var(--border-subtle, var(--border));
    background: var(--bg-primary);
  }

  .track-icon {
    font-size: 14px;
    line-height: 1;
  }

  .track-label-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-align: center;
  }

  .track-items {
    flex: 1;
    position: relative;
    padding: 4px 0;
    display: flex;
    align-items: center;
    gap: 0;
    overflow: hidden;
  }

  .track-item {
    position: relative;
    min-width: 40px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: flex-end;
    overflow: hidden;
    flex-shrink: 0;
    transition: outline 0.12s;
  }

  .track-item:hover {
    outline: 1px solid var(--text-dim);
    outline-offset: -1px;
  }

  .track-item.drag-over {
    outline: 2px solid var(--spark-red, #FE2C55);
    outline-offset: -2px;
  }

  .track-item.selected {
    outline: 2px solid var(--spark-cyan, #25F4EE);
    outline-offset: -2px;
    z-index: 2;
  }

  .track-item.dragging {
    opacity: 0.4;
  }

  /* Type-specific backgrounds */
  .track-item.clip {
    background: var(--bg-primary, #0a0a0f);
  }

  .track-item.audio {
    background: color-mix(in srgb, var(--waveform-color, rgba(168, 85, 247, 0.6)) 15%, var(--bg-surface, #2a2a3e));
  }

  .track-item.subtitle {
    background: var(--subtitle-color, rgba(37, 244, 238, 0.15));
  }

  /* Canvas fills the item */
  .item-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* Label overlay at bottom */
  .item-overlay {
    position: relative;
    z-index: 1;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
  }

  .item-overlay.subtitle-overlay {
    background: transparent;
    backdrop-filter: none;
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
  }

  .item-label {
    font-size: 10px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .item-dur {
    font-size: 9px;
    opacity: 0.6;
    flex-shrink: 0;
  }

  /* Trim handles */
  .trim-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    z-index: 3;
    cursor: col-resize;
    transition: background 0.12s;
  }

  .trim-handle:hover,
  .trim-handle.trim-active {
    background: rgba(37, 244, 238, 0.3);
  }

  .trim-left {
    left: 0;
    border-radius: var(--radius-element, 12px) 0 0 var(--radius-element, 12px);
  }

  .trim-right {
    right: 0;
    border-radius: 0 var(--radius-element, 12px) var(--radius-element, 12px) 0;
  }

  /* Playhead */
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--spark-red, #FE2C55);
    z-index: 10;
    pointer-events: none;
    transition: left 0.1s linear;
    box-shadow: 0 0 4px rgba(254, 44, 85, 0.5);
  }
</style>
