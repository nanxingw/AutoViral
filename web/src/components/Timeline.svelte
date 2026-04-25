<script lang="ts">
  import TrackRow from "./TrackRow.svelte";
  import type { TrackItem } from "./TrackRow.svelte";

  interface ClipInfo {
    id: string;
    path: string;
    duration: number;
    thumbnail?: string;
  }

  interface AudioInfo {
    path: string;
    name: string;
    duration: number;
    audioType?: "bgm" | "voiceover" | "sfx";
  }

  interface SubtitleEntry {
    start: number;
    end: number;
    text: string;
  }

  let {
    clips = [],
    audio = null,
    audioTracks = [],
    subtitles = [],
    currentTime = 0,
    workId = "",
    selectedClipId = null,
    onReorder,
    onAction,
    onSeek,
    onTrim,
  }: {
    clips?: ClipInfo[];
    audio?: AudioInfo | null;
    audioTracks?: AudioInfo[];
    subtitles?: SubtitleEntry[];
    currentTime?: number;
    workId?: string;
    selectedClipId?: string | null;
    onReorder?: (newOrder: string[]) => void;
    onAction?: (action: { type: string; target: string; payload?: any }) => void;
    onSeek?: (seconds: number) => void;
    onTrim?: (clipId: string, side: "left" | "right", deltaSec: number) => void;
  } = $props();

  function assetUrl(path: string): string {
    return `/api/works/${encodeURIComponent(workId)}/assets/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  // --- State ---
  let zoomLevel = $state(1.0);
  let scrollContainerEl: HTMLDivElement | undefined = $state(undefined);
  let ctxMenu = $state<{ x: number; y: number; itemId: string } | null>(null);
  let draggingPlayhead = $state(false);

  // --- Derived ---
  let totalDuration = $derived(
    clips.reduce((sum, c) => sum + c.duration, 0)
  );

  let pixelsPerSecond = $derived(80 * zoomLevel);
  let totalContentWidth = $derived(totalDuration * pixelsPerSecond);

  let clipItems: TrackItem[] = $derived.by(() => {
    let cumulative = 0;
    return clips.map((c) => {
      const item: TrackItem = {
        id: c.id,
        start: cumulative,
        duration: c.duration,
        label: (c.path.split("/").pop() ?? c.path).replace(/\.[^.]+$/, ''),
        thumbnail: c.thumbnail ?? assetUrl(c.path),
        type: "clip",
      };
      cumulative += c.duration;
      return item;
    });
  });

  let audioItems: TrackItem[] = $derived.by(() => {
    const allAudio: AudioInfo[] = [];
    if (audioTracks.length > 0) {
      allAudio.push(...audioTracks);
    } else if (audio) {
      allAudio.push(audio);
    }
    if (allAudio.length === 0) return [];

    const audioTypeLabels: Record<string, string> = {
      bgm: "BGM",
      voiceover: "配音",
      sfx: "音效",
    };

    return allAudio.map((a, i) => {
      const dur = a.duration > 0 ? Math.min(a.duration, totalDuration) : totalDuration;
      const typeLabel = audioTypeLabels[a.audioType ?? ""] ?? "";
      const label = typeLabel ? `${typeLabel}: ${a.name}` : a.name;
      return {
        id: `audio-${i}`,
        start: 0,
        duration: dur > 0 ? dur : totalDuration,
        label,
        audioUrl: assetUrl(a.path),
        type: "audio" as const,
      };
    });
  });

  let subtitleItems: TrackItem[] = $derived.by(() => {
    return subtitles.map((s, i) => ({
      id: `sub-${i}`,
      start: s.start,
      duration: s.end - s.start,
      label: s.text,
      type: "subtitle" as const,
    }));
  });

  // --- Adaptive ruler ticks ---
  interface RulerTick {
    time: number;
    label: string;
    major: boolean;
  }

  let rulerTicks = $derived.by((): RulerTick[] => {
    if (totalDuration <= 0 || !scrollContainerEl) return [];

    let majorInterval: number;
    let minorInterval: number;

    if (pixelsPerSecond < 20) {
      majorInterval = 10; minorInterval = 5;
    } else if (pixelsPerSecond < 60) {
      majorInterval = 5; minorInterval = 1;
    } else if (pixelsPerSecond < 150) {
      majorInterval = 1; minorInterval = 0.5;
    } else {
      majorInterval = 0.5; minorInterval = 0.1;
    }

    // Only render ticks in visible viewport
    const scrollLeft = scrollContainerEl.scrollLeft;
    const viewWidth = scrollContainerEl.clientWidth;
    const startTime = Math.max(0, (scrollLeft / pixelsPerSecond) - minorInterval);
    const endTime = Math.min(totalDuration, ((scrollLeft + viewWidth) / pixelsPerSecond) + minorInterval);

    const ticks: RulerTick[] = [];

    // Minor ticks
    const minStart = Math.floor(startTime / minorInterval) * minorInterval;
    for (let t = minStart; t <= endTime; t += minorInterval) {
      const rounded = Math.round(t * 100) / 100;
      if (rounded < 0) continue;
      const isMajor = Math.abs(rounded % majorInterval) < 0.001 || Math.abs(rounded % majorInterval - majorInterval) < 0.001;
      if (isMajor) {
        const m = Math.floor(rounded / 60);
        const s = Math.floor(rounded % 60);
        const frac = rounded % 1;
        let label = `${m}:${s.toString().padStart(2, "0")}`;
        if (majorInterval < 1 && frac > 0.01) {
          label += `.${Math.round(frac * 10)}`;
        }
        ticks.push({ time: rounded, label, major: true });
      } else {
        ticks.push({ time: rounded, label: "", major: false });
      }
    }
    return ticks;
  });

  // Reactive scroll tracking for ruler
  let scrollLeft = $state(0);

  function handleScroll() {
    if (scrollContainerEl) {
      scrollLeft = scrollContainerEl.scrollLeft;
    }
  }

  // --- Format duration ---
  function formatDuration(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // --- Zoom ---
  function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoomLevel = Math.max(0.3, Math.min(5.0, zoomLevel + delta));
  }

  function zoomIn() {
    zoomLevel = Math.min(5.0, zoomLevel * 1.5);
  }

  function zoomOut() {
    zoomLevel = Math.max(0.3, zoomLevel / 1.5);
  }

  // --- Playhead drag ---
  let rulerEl: HTMLDivElement | undefined = $state(undefined);

  function timeFromClientX(clientX: number): number {
    if (!rulerEl || totalDuration <= 0) return 0;
    const rect = rulerEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const time = x / pixelsPerSecond;
    return Math.max(0, Math.min(totalDuration, time));
  }

  function handleRulerClick(e: MouseEvent) {
    if (draggingPlayhead) return;
    const time = timeFromClientX(e.clientX);
    onSeek?.(time);
  }

  function handlePlayheadDown(e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    draggingPlayhead = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePlayheadMove(e: PointerEvent) {
    if (!draggingPlayhead) return;
    const time = timeFromClientX(e.clientX);
    onSeek?.(time);
  }

  function handlePlayheadUp(e: PointerEvent) {
    if (!draggingPlayhead) return;
    draggingPlayhead = false;
    const time = timeFromClientX(e.clientX);
    onSeek?.(time);
  }

  // --- Context menu ---
  function handleClipContext(itemId: string, event: MouseEvent) {
    ctxMenu = { x: event.clientX, y: event.clientY, itemId };
  }

  function handleCtxAction(type: string) {
    if (ctxMenu) {
      onAction?.({ type, target: ctxMenu.itemId });
      ctxMenu = null;
    }
  }

  function closeCtx() {
    ctxMenu = null;
  }

  // --- Toolbar actions ---
  function handleSplit() {
    if (selectedClipId) {
      onAction?.({ type: "split", target: selectedClipId });
    }
  }

  function handleDelete() {
    if (selectedClipId) {
      onAction?.({ type: "delete", target: selectedClipId });
    }
  }

  // Playhead position in pixels
  let playheadPx = $derived(totalDuration > 0 ? currentTime * pixelsPerSecond : 0);
</script>

<svelte:window onclick={closeCtx} />

<div class="timeline-container">
  <!-- Toolbar -->
  <div class="timeline-toolbar">
    <div class="toolbar-left">
      <button
        class="toolbar-btn"
        title="分割 (Split)"
        disabled={!selectedClipId}
        onclick={handleSplit}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="2" x2="12" y2="22"></line>
          <polyline points="8 6 12 2 16 6"></polyline>
          <polyline points="8 18 12 22 16 18"></polyline>
        </svg>
      </button>
      <button
        class="toolbar-btn toolbar-btn-danger"
        title="删除 (Delete)"
        disabled={!selectedClipId}
        onclick={handleDelete}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>

    <div class="toolbar-center">
      <span class="duration-display">{formatDuration(totalDuration)}</span>
    </div>

    <div class="toolbar-right">
      <button class="toolbar-btn" onclick={zoomOut} title="缩小">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <input
        type="range"
        class="zoom-slider"
        min="0.3"
        max="5.0"
        step="0.1"
        bind:value={zoomLevel}
      />
      <button class="toolbar-btn" onclick={zoomIn} title="放大">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    </div>
  </div>

  <!-- Scrollable area with fixed track headers -->
  <div class="timeline-body">
    <!-- Fixed track header column -->
    <div class="track-headers">
      <div class="header-cell ruler-header" style="height: 24px;"></div>
      <div class="header-cell" style="height: 65px;">
        <span class="header-icon">🎬</span>
        <span class="header-text">视频</span>
      </div>
      {#if audioItems.length <= 1}
        <div class="header-cell" style="height: 50px;">
          <span class="header-icon">🔊</span>
          <span class="header-text">音频</span>
        </div>
      {:else}
        {#each audioItems as audioItem, i}
          <div class="header-cell" style="height: 50px;">
            <span class="header-icon">🔊</span>
            <span class="header-text">{audioItem.label.split(":")[0] || "音频"}</span>
          </div>
        {/each}
      {/if}
      <div class="header-cell" style="height: 28px;">
        <span class="header-icon">💬</span>
        <span class="header-text">字幕</span>
      </div>
    </div>

    <!-- Scrollable tracks area -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="scroll-area"
      bind:this={scrollContainerEl}
      onscroll={handleScroll}
      onwheel={handleWheel}
    >
      <!-- Ruler -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="ruler"
        bind:this={rulerEl}
        style="width: {totalContentWidth}px;"
        onclick={handleRulerClick}
      >
        {#each rulerTicks as tick}
          <div
            class="ruler-tick"
            class:major={tick.major}
            style="left: {tick.time * pixelsPerSecond}px;"
          >
            {#if tick.major}
              <span class="tick-label">{tick.label}</span>
            {/if}
          </div>
        {/each}

        <!-- Playhead handle (circle on ruler) -->
        {#if totalDuration > 0}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="playhead-handle"
            style="left: {playheadPx}px;"
            onpointerdown={handlePlayheadDown}
            onpointermove={handlePlayheadMove}
            onpointerup={handlePlayheadUp}
          ></div>
        {/if}
      </div>

      <!-- Tracks container -->
      <div class="tracks-content" style="width: {totalContentWidth}px;">
        <TrackRow
          items={clipItems}
          {totalDuration}
          {currentTime}
          trackHeight={65}
          draggable={true}
          selectedItemId={selectedClipId}
          onItemClick={(id) => onAction?.({ type: "select", target: id })}
          onReorder={onReorder}
          onContextMenu={handleClipContext}
          onTrim={onTrim}
        />
        {#if audioItems.length <= 1}
          <TrackRow
            items={audioItems}
            {totalDuration}
            {currentTime}
            trackHeight={50}
            onItemClick={(id) => onAction?.({ type: "select", target: id })}
          />
        {:else}
          {#each audioItems as audioItem, i}
            <TrackRow
              items={[audioItem]}
              {totalDuration}
              {currentTime}
              trackHeight={50}
              onItemClick={(id) => onAction?.({ type: "select", target: id })}
            />
          {/each}
        {/if}
        <TrackRow
          items={subtitleItems}
          {totalDuration}
          {currentTime}
          trackHeight={28}
          onItemClick={(id) => onAction?.({ type: "select", target: id })}
        />
      </div>

      <!-- Playhead line (spans ruler + all tracks) -->
      {#if totalDuration > 0}
        <div
          class="playhead-line"
          style="left: {playheadPx}px;"
        ></div>
      {/if}
    </div>
  </div>

  <!-- Context Menu -->
  {#if ctxMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="ctx-menu" role="menu" tabindex="-1" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;" onclick={(e) => e.stopPropagation()}>
      <button class="ctx-item" onclick={() => handleCtxAction("replace")}>替换片段</button>
      <button class="ctx-item ctx-danger" onclick={() => handleCtxAction("delete")}>删除片段</button>
    </div>
  {/if}
</div>

<style>
  .timeline-container {
    background: var(--bg-secondary, #12121A);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* ---- Toolbar ---- */
  .timeline-toolbar {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    background: var(--bg-elevated, #1e1e3a);
    border-bottom: 1px solid var(--border-subtle, var(--border));
    gap: 8px;
  }

  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .toolbar-center {
    display: flex;
    align-items: center;
  }

  .duration-display {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    font-family: "Space Grotesk", "DM Sans", system-ui, sans-serif;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-element, 6px);
    color: var(--text-muted);
    cursor: pointer;
    transition: var(--transition-fast, all 0.12s ease);
    padding: 0;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: var(--bg-surface, #2a2a3e);
    color: var(--text);
    border-color: var(--border-subtle, var(--border));
  }

  .toolbar-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .toolbar-btn-danger:hover:not(:disabled) {
    color: var(--spark-red, #FE2C55);
    background: color-mix(in srgb, var(--spark-red, #FE2C55) 10%, transparent);
  }

  .zoom-slider {
    width: 80px;
    height: 4px;
    appearance: none;
    -webkit-appearance: none;
    background: var(--border-subtle, var(--border));
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .zoom-slider::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-muted);
    cursor: pointer;
    transition: background 0.12s;
  }

  .zoom-slider::-webkit-slider-thumb:hover {
    background: var(--text);
  }

  /* ---- Body: headers + scroll area ---- */
  .timeline-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  /* ---- Fixed track headers ---- */
  .track-headers {
    width: 80px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary, #0A0A0F);
    border-right: 1px solid var(--border-subtle, var(--border));
    z-index: 5;
  }

  .header-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.5px;
  }

  .header-cell.ruler-header {
    background: var(--bg-primary, #0A0A0F);
  }

  .header-icon {
    font-size: 14px;
    line-height: 1;
  }

  .header-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 70px;
    text-align: center;
  }

  /* ---- Scrollable area ---- */
  .scroll-area {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    position: relative;
  }

  /* ---- Ruler ---- */
  .ruler {
    height: 24px;
    position: relative;
    cursor: pointer;
    background: var(--bg-primary, #0A0A0F);
    border-bottom: 1px solid var(--border);
    min-width: 100%;
  }

  .ruler-tick {
    position: absolute;
    bottom: 0;
    height: 6px;
    border-left: 1px solid var(--border);
  }

  .ruler-tick.major {
    height: 12px;
  }

  .tick-label {
    position: absolute;
    bottom: 12px;
    left: 3px;
    font-size: 9px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }

  /* ---- Playhead handle (triangle + wider hit area on ruler) ---- */
  .playhead-handle {
    position: absolute;
    top: 0;
    width: 24px;
    height: 24px;
    transform: translateX(-12px);
    cursor: grab;
    z-index: 31;
    touch-action: none;
  }
  /* Visual triangle */
  .playhead-handle::after {
    content: "";
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 8px solid var(--spark-red, #FE2C55);
    filter: drop-shadow(0 0 4px rgba(254, 44, 85, 0.4));
  }

  .playhead-handle:active {
    cursor: grabbing;
  }

  /* ---- Playhead line ---- */
  .playhead-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--spark-red, #FE2C55);
    box-shadow: 0 0 6px rgba(254, 44, 85, 0.4);
    transform: translateX(-1px);
    z-index: 30;
    pointer-events: none;
  }

  /* ---- Tracks content ---- */
  .tracks-content {
    min-width: 100%;
  }

  /* Hide TrackRow's own label column since we use external headers */
  .tracks-content :global(.track-label) {
    display: none;
  }

  /* ---- Context Menu ---- */
  .ctx-menu {
    position: fixed;
    z-index: 200;
    background: var(--bg-elevated, #1e1e3a);
    border: 1px solid var(--border);
    border-radius: var(--radius-card, 6px);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.4));
    padding: 4px;
    min-width: 120px;
  }

  .ctx-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 12px;
    font-family: inherit;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
  }

  .ctx-item:hover {
    background: var(--bg-surface);
    color: var(--text);
  }

  .ctx-danger:hover {
    background: color-mix(in srgb, var(--spark-red, #FE2C55) 15%, transparent);
    color: var(--spark-red, #FE2C55);
  }
</style>
