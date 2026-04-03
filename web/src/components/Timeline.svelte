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
  }

  interface SubtitleEntry {
    start: number;
    end: number;
    text: string;
  }

  let {
    clips = [],
    audio = null,
    subtitles = [],
    currentTime = 0,
    workId = "",
    onReorder,
    onAction,
    onSeek,
  }: {
    clips?: ClipInfo[];
    audio?: AudioInfo | null;
    subtitles?: SubtitleEntry[];
    currentTime?: number;
    workId?: string;
    onReorder?: (newOrder: string[]) => void;
    onAction?: (action: { type: string; target: string; payload?: any }) => void;
    onSeek?: (seconds: number) => void;
  } = $props();

  function assetUrl(path: string): string {
    return `/api/works/${encodeURIComponent(workId)}/assets/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  let totalDuration = $derived(
    clips.reduce((sum, c) => sum + c.duration, 0)
  );

  let clipItems: TrackItem[] = $derived.by(() => {
    let cumulative = 0;
    return clips.map((c) => {
      const item: TrackItem = {
        id: c.id,
        start: cumulative,
        duration: c.duration,
        label: c.path.split("/").pop() ?? c.path,
        thumbnail: c.thumbnail ?? assetUrl(c.path),
        type: "clip",
      };
      cumulative += c.duration;
      return item;
    });
  });

  let audioItems: TrackItem[] = $derived.by(() => {
    if (!audio) return [];
    return [{
      id: "audio-main",
      start: 0,
      duration: Math.min(audio.duration, totalDuration || audio.duration),
      label: audio.name,
      type: "audio" as const,
    }];
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

  // Ruler tick marks
  let rulerTicks = $derived.by(() => {
    if (totalDuration <= 0) return [];
    const interval = totalDuration <= 10 ? 1 : totalDuration <= 30 ? 5 : 10;
    const ticks: { time: number; label: string }[] = [];
    for (let t = 0; t <= totalDuration; t += interval) {
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      ticks.push({ time: t, label: `${m}:${s.toString().padStart(2, "0")}` });
    }
    return ticks;
  });

  let rulerEl: HTMLDivElement | undefined = $state();

  function handleRulerClick(e: MouseEvent) {
    if (!rulerEl || totalDuration <= 0) return;
    const rect = rulerEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    onSeek?.(ratio * totalDuration);
  }

  // Context menu state
  let ctxMenu = $state<{ x: number; y: number; itemId: string } | null>(null);

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
</script>

<svelte:window onclick={closeCtx} />

<div class="timeline-container">
  <!-- Ruler -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="timeline-ruler" bind:this={rulerEl} onclick={handleRulerClick}>
    <div class="ruler-label-spacer"></div>
    <div class="ruler-track">
      {#each rulerTicks as tick}
        <div class="ruler-tick" style="left: {totalDuration > 0 ? (tick.time / totalDuration) * 100 : 0}%;">
          <span class="tick-label">{tick.label}</span>
        </div>
      {/each}
      {#if totalDuration > 0}
        <div class="ruler-playhead" style="left: {(currentTime / totalDuration) * 100}%;"></div>
      {/if}
    </div>
  </div>

  <!-- Tracks -->
  <TrackRow
    label="视频"
    items={clipItems}
    {totalDuration}
    {currentTime}
    draggable={true}
    onItemClick={(id) => onAction?.({ type: "select", target: id })}
    onReorder={onReorder}
    onContextMenu={handleClipContext}
  />
  <TrackRow
    label="音频"
    items={audioItems}
    {totalDuration}
    {currentTime}
    onItemClick={(id) => onAction?.({ type: "select", target: id })}
  />
  <TrackRow
    label="字幕"
    items={subtitleItems}
    {totalDuration}
    {currentTime}
    onItemClick={(id) => onAction?.({ type: "select", target: id })}
  />

  <!-- Context Menu -->
  {#if ctxMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ctx-menu" style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;" onclick={(e) => e.stopPropagation()}>
      <button class="ctx-item" onclick={() => handleCtxAction("replace")}>替换片段</button>
      <button class="ctx-item ctx-danger" onclick={() => handleCtxAction("delete")}>删除片段</button>
    </div>
  {/if}
</div>

<style>
  .timeline-container {
    background: #12122a;
    border-top: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
    user-select: none;
    position: relative;
  }

  /* Ruler */
  .timeline-ruler {
    display: flex;
    height: 24px;
    cursor: pointer;
    background: #0e0e22;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .ruler-label-spacer {
    width: 40px;
    flex-shrink: 0;
  }

  .ruler-track {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .ruler-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid rgba(255,255,255,0.1);
  }

  .tick-label {
    position: absolute;
    top: 4px;
    left: 4px;
    font-size: 9px;
    color: rgba(255,255,255,0.35);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .ruler-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #FE2C55;
    z-index: 5;
    pointer-events: none;
    transition: left 0.1s linear;
  }

  /* Context Menu */
  .ctx-menu {
    position: fixed;
    z-index: 200;
    background: #1e1e3a;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    padding: 4px;
    min-width: 120px;
  }

  .ctx-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: rgba(255,255,255,0.75);
    font-size: 12px;
    font-family: inherit;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
  }

  .ctx-item:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }

  .ctx-danger:hover {
    background: rgba(254, 44, 85, 0.15);
    color: #FE2C55;
  }
</style>
