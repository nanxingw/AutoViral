# Timeline Professional Upgrade + Global UI Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Studio timeline into a professional NLE-grade preview with filmstrip thumbnails, real waveforms, draggable playhead, and zoom controls; simultaneously polish all Studio components with a unified radius/shadow/spacing design system.

**Architecture:** Update CSS design tokens in App.svelte first (radius scale, shadow scale, timeline tokens). Then rewrite Timeline and TrackRow for professional visuals (Canvas filmstrip, Canvas waveform, playhead drag, zoom, trim handles). Finally sweep all Studio-related components to adopt the new tokens. Each task produces a buildable, independently verifiable result.

**Tech Stack:** Svelte 5 (runes), TypeScript, HTML5 Canvas, Web Audio API, CSS custom properties. Build: Vite (run from project root, `npx vite build`). No test framework — verify via build + visual inspection.

**Important build note:** Vite config is at project root with `root: "web"`. Always run `npx vite build` from `/Users/nanjiayan/Desktop/AutoViral/autoviral/`, NOT from `web/`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `web/src/App.svelte` | Modify | Add new design tokens (radius scale, shadow scale, timeline tokens) |
| `web/src/components/TrackRow.svelte` | Rewrite | Canvas filmstrip/waveform, variable height, trim handles, selection |
| `web/src/components/Timeline.svelte` | Rewrite | Zoom state, toolbar, playhead drag, adaptive ruler, track header column |
| `web/src/lib/waveform.ts` | Create | Web Audio API waveform extraction utility |
| `web/src/lib/filmstrip.ts` | Create | Video frame extraction utility for Canvas thumbnails |
| `web/src/components/AssetSidebar.svelte` | Modify | Apply token-based radius, shadow, spacing |
| `web/src/components/PreviewArea.svelte` | Modify | Apply token-based radius, controls styling |
| `web/src/components/ChatPanel.svelte` | Modify | Apply token-based radius, bubbles, input |
| `web/src/components/StreamBlock.svelte` | Modify | Apply token-based radius, block styling |
| `web/src/components/PipelineBar.svelte` | Modify | Apply token-based radius, connectors, badges |
| `web/src/components/ImageLayout.svelte` | Modify | Apply token-based radius, shadow, hover |
| `web/src/pages/Studio.svelte` | Modify | Panel gaps, resize handles, header polish |

---

### Task 1: Design Tokens — Radius, Shadow, and Timeline Scales

**Files:**
- Modify: `web/src/App.svelte` (lines 315-423, the `:global(:root)` and `:global([data-theme])` blocks)

- [ ] **Step 1: Add radius scale tokens to dark theme**

In `web/src/App.svelte`, find the `:global(:root)` block. After the existing `--card-radius: 6px;` line, add:

```css
/* Border radius scale */
--radius-panel: 8px;
--radius-card: 10px;
--radius-element: 12px;
--radius-pill: 9999px;
```

- [ ] **Step 2: Update shadow tokens in dark theme**

In the same `:global(:root)` block, replace the existing shadow definitions:

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.5);
--shadow-md: 0 8px 30px rgba(0,0,0,0.5);
--shadow-lg: 0 24px 64px rgba(0,0,0,0.6);
```

with:

```css
--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.45);
--shadow-hover: 0 6px 16px rgba(0, 0, 0, 0.25);
```

- [ ] **Step 3: Add timeline-specific tokens to dark theme**

After the shadow tokens, add:

```css
/* Timeline */
--track-height-video: 65px;
--track-height-audio: 50px;
--track-height-subtitle: 28px;
--track-header-width: 80px;
--timeline-toolbar-height: 40px;
--waveform-color: rgba(168, 85, 247, 0.6);
--waveform-bg: rgba(168, 85, 247, 0.08);
--subtitle-color: rgba(37, 244, 238, 0.15);
```

- [ ] **Step 4: Mirror tokens in light theme**

In the `:global([data-theme="light"])` block, add/update:

```css
--radius-panel: 8px;
--radius-card: 10px;
--radius-element: 12px;
--radius-pill: 9999px;

--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
--shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.12);
--shadow-hover: 0 6px 16px rgba(0, 0, 0, 0.08);

--track-height-video: 65px;
--track-height-audio: 50px;
--track-height-subtitle: 28px;
--track-header-width: 80px;
--timeline-toolbar-height: 40px;
--waveform-color: rgba(168, 85, 247, 0.5);
--waveform-bg: rgba(168, 85, 247, 0.06);
--subtitle-color: rgba(37, 244, 238, 0.12);
```

- [ ] **Step 5: Update --card-radius to use new token**

Replace `--card-radius: 6px;` with `--card-radius: var(--radius-card);` in both theme blocks.

- [ ] **Step 6: Build and verify**

Run: `npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.svelte
git commit -m "style: add radius/shadow/timeline design token scales"
```

---

### Task 2: Filmstrip Utility — Video Frame Extraction

**Files:**
- Create: `web/src/lib/filmstrip.ts`

- [ ] **Step 1: Create filmstrip extraction utility**

Create `web/src/lib/filmstrip.ts`:

```typescript
/**
 * Extract evenly-spaced frames from a video and draw them as a filmstrip on a canvas.
 * Falls back gracefully if video cannot be decoded.
 */
export interface FilmstripOptions {
  videoUrl: string;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  numFrames?: number;
}

export async function renderFilmstrip(opts: FilmstripOptions): Promise<boolean> {
  const { videoUrl, canvas, width, height, numFrames = 8 } = opts;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  video.src = videoUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Video load failed"));
      setTimeout(() => reject(new Error("Timeout")), 8000);
    });

    const duration = video.duration;
    if (!duration || !isFinite(duration)) return false;

    const frameWidth = width / numFrames;
    const aspect = video.videoWidth / video.videoHeight;
    const drawHeight = height;
    const drawWidth = drawHeight * aspect;

    for (let i = 0; i < numFrames; i++) {
      const seekTime = (i / numFrames) * duration;
      video.currentTime = seekTime;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(() => resolve(), 2000);
      });

      const x = i * frameWidth;
      // Center-crop the frame into the tile
      const srcX = Math.max(0, (drawWidth - frameWidth) / 2);
      ctx.drawImage(video, x - srcX, 0, drawWidth, drawHeight);
    }

    return true;
  } catch {
    return false;
  } finally {
    video.src = "";
    video.load();
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/filmstrip.ts
git commit -m "feat: add filmstrip frame extraction utility"
```

---

### Task 3: Waveform Utility — Audio RMS Extraction

**Files:**
- Create: `web/src/lib/waveform.ts`

- [ ] **Step 1: Create waveform rendering utility**

Create `web/src/lib/waveform.ts`:

```typescript
/**
 * Fetch an audio file, decode it with Web Audio API, extract RMS amplitudes,
 * and render a bar-style waveform on a canvas.
 */
export interface WaveformOptions {
  audioUrl: string;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  barWidth?: number;
  barGap?: number;
  color?: string;
}

export async function renderWaveform(opts: WaveformOptions): Promise<boolean> {
  const {
    audioUrl, canvas, width, height,
    barWidth = 2, barGap = 1,
    color = "rgba(168, 85, 247, 0.6)",
  } = opts;

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const dpr = window.devicePixelRatio;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) return false;
    const arrayBuffer = await response.arrayBuffer();

    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    audioCtx.close();

    const channelData = audioBuffer.getChannelData(0);
    const numBars = Math.floor(width / (barWidth + barGap));
    const samplesPerBar = Math.floor(channelData.length / numBars);

    // Compute RMS per bar
    const rmsValues: number[] = [];
    let maxRms = 0;
    for (let i = 0; i < numBars; i++) {
      let sum = 0;
      const start = i * samplesPerBar;
      for (let j = start; j < start + samplesPerBar && j < channelData.length; j++) {
        sum += channelData[j] * channelData[j];
      }
      const rms = Math.sqrt(sum / samplesPerBar);
      rmsValues.push(rms);
      if (rms > maxRms) maxRms = rms;
    }

    // Normalize and draw
    ctx.fillStyle = color;
    const padding = 4;
    const drawHeight = height - padding * 2;

    for (let i = 0; i < numBars; i++) {
      const normalized = maxRms > 0 ? rmsValues[i] / maxRms : 0;
      // Log scale for better visual dynamics
      const logNorm = Math.log1p(normalized * 10) / Math.log1p(10);
      const barH = Math.max(2, logNorm * drawHeight);
      const x = i * (barWidth + barGap);
      const y = padding + (drawHeight - barH) / 2;
      ctx.fillRect(x, y, barWidth, barH);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Draw a fake waveform (used as fallback when audio decoding fails).
 */
export function renderFakeWaveform(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  color: string = "rgba(168, 85, 247, 0.4)",
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = color;
  const barWidth = 2;
  const barGap = 1;
  const numBars = Math.floor(width / (barWidth + barGap));
  const padding = 4;
  const drawHeight = height - padding * 2;

  for (let i = 0; i < numBars; i++) {
    const t = i / numBars;
    const amplitude = 0.3 + 0.4 * Math.sin(t * Math.PI * 6) + 0.2 * Math.sin(t * Math.PI * 14 + 1) + 0.1 * Math.random();
    const barH = Math.max(2, amplitude * drawHeight);
    const x = i * (barWidth + barGap);
    const y = padding + (drawHeight - barH) / 2;
    ctx.fillRect(x, y, barWidth, barH);
  }
}
```

- [ ] **Step 2: Build and verify**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/waveform.ts
git commit -m "feat: add waveform RMS extraction and canvas rendering utility"
```

---

### Task 4: TrackRow Rewrite — Canvas Visuals, Variable Height, Trim Handles

**Files:**
- Rewrite: `web/src/components/TrackRow.svelte`

This is the largest task. The current TrackRow uses DOM elements for clips. The new version uses Canvas for filmstrip/waveform rendering inside each clip, supports variable track heights, trim handles on selection, and adopts new design tokens.

- [ ] **Step 1: Rewrite TrackRow.svelte**

Read the current file first, then replace the entire content. The new component must:

- Accept props: `label, icon, items, totalDuration, currentTime, trackHeight, draggable, selectedItemId, onItemClick, onReorder, onContextMenu, onTrim`
- TrackItem type adds optional `videoUrl` and `audioUrl` fields
- Each item renders a `<canvas>` that calls `renderFilmstrip` (for clips) or `renderWaveform` (for audio)
- Selected items show trim handles (8px invisible zones on left/right edges, cursor `col-resize`)
- Track height driven by prop (defaults differ by type: 65/50/28px)
- Label column is 80px wide with icon + text, does not scroll horizontally
- Clips use `--radius-element: 12px` border radius
- Items sized proportionally: `flex: 0 0 {pct}; min-width: 40px;`
- Subtitle items: colored block with text label, no canvas

Key interactions:
- Click: calls `onItemClick`
- Right-click: calls `onContextMenu`
- Drag: existing HTML5 D&D logic preserved
- Trim: pointer down on left/right 8px edge starts trim mode, pointer move adjusts, pointer up fires `onTrim(itemId, side, delta)`

- [ ] **Step 2: Build and verify**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/TrackRow.svelte
git commit -m "feat: rewrite TrackRow with canvas filmstrip/waveform, trim handles, variable height"
```

---

### Task 5: Timeline Rewrite — Zoom, Toolbar, Playhead Drag, Adaptive Ruler

**Files:**
- Rewrite: `web/src/components/Timeline.svelte`
- Modify: `web/src/pages/Studio.svelte` (update Timeline props)

The new Timeline adds:
- Zoom state with toolbar controls
- Draggable playhead with circular top handle
- Adaptive ruler tick density based on zoom
- Horizontally scrollable track area with fixed track header column
- Timeline toolbar between preview and tracks

- [ ] **Step 1: Rewrite Timeline.svelte**

Read the current file first, then replace. The new component must:

**Props:** `clips, audioTracks, subtitles, currentTime, workId, selectedClipId, onReorder, onAction, onSeek, onTrim`

**State:**
- `zoomLevel` ($state, default 1.0, range 0.3–5.0)
- `scrollLeft` ($state, sync with scroll container)
- `ctxMenu` ($state, for right-click menu)

**Layout (top to bottom):**
1. **Toolbar** (40px): left = action buttons (split, delete), center = duration display, right = zoom controls (−, slider, +)
2. **Ruler** (24px): adaptive ticks, playhead indicator, click-to-seek
3. **Track header column** (80px, fixed left) + **Scrollable tracks area**
   - Video TrackRow(s)
   - Audio TrackRow(s)
   - Subtitle TrackRow

**Zoom:**
- `pixelsPerSecond = 80 * zoomLevel`
- Total width = `totalDuration * pixelsPerSecond`
- Ctrl+wheel on track area adjusts zoom, anchored to mouse position
- Toolbar slider: range input bound to zoomLevel
- +/- buttons: multiply/divide by 1.5

**Playhead:**
- Vertical line spanning all tracks + ruler
- Top: 12px circle handle, draggable
- Position: `(currentTime / totalDuration) * totalWidth`
- Drag: pointer events on handle → calculate new time from x position → `onSeek`
- Click on ruler: instant seek

**Ruler ticks:**
- Compute interval based on `pixelsPerSecond`:
  - < 20px/s: 10s major, 5s minor
  - 20-60px/s: 5s major, 1s minor
  - 60-150px/s: 1s major, 0.5s minor
  - > 150px/s: 0.5s major, 0.1s minor
- Only render ticks in visible viewport (virtual rendering)

**Track headers:**
- Fixed 80px column, does not scroll horizontally
- Each row: type icon (SVG) + label text
- Audio rows: mute button (speaker icon toggle)

- [ ] **Step 2: Update Studio.svelte Timeline usage**

In `web/src/pages/Studio.svelte`, update the `<Timeline>` component call to pass the new `onTrim` handler:

```typescript
function handleTimelineTrim(clipId: string, side: "left" | "right", deltaSec: number) {
  const clip = videoClips.find(c => c.id === clipId);
  if (!clip) return;
  const action = side === "left" ? "trim-start" : "trim-end";
  handleChatSend({
    text: `请调整视频片段 ${clip.path.split('/').pop()} 的${side === 'left' ? '开头' : '结尾'}，${deltaSec > 0 ? '延长' : '缩短'} ${Math.abs(deltaSec).toFixed(1)} 秒`,
    attachments: [],
  });
}
```

And pass it: `onTrim={handleTimelineTrim}`

- [ ] **Step 3: Build and verify**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Timeline.svelte web/src/pages/Studio.svelte
git commit -m "feat: rewrite Timeline with zoom, toolbar, draggable playhead, adaptive ruler"
```

---

### Task 6: UI Polish — Studio Shell

**Files:**
- Modify: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Polish Studio layout styles**

Read the current Studio.svelte styles (from line ~708 onwards). Apply these changes:

1. Replace all hardcoded `border-radius` values with token vars:
   - `6px` → `var(--radius-panel)`
   - `4px` on small elements → `var(--radius-element)`

2. Replace `.panel-left`, `.panel-right` border styles:
   - Remove `border-right: 1px solid var(--border)` from `.panel-left`
   - Add `box-shadow: var(--shadow-sm)` and `border-right: 1px solid var(--border-subtle)` instead

3. `.studio-header`: add `box-shadow: var(--shadow-sm)` and remove `border-bottom`, add `border-radius: 0`

4. `.preview-wrapper`: add `border-radius: var(--radius-panel)` and `overflow: hidden`

5. Resize handles: make them 6px wide/tall, add `border-radius: 3px` on hover state

6. `.tag-dropdown`: use `border-radius: var(--radius-card)`, `box-shadow: var(--shadow-lg)`

7. `.tag-option`: use `border-radius: var(--radius-element)`

8. `.eval-toggle`: use `border-radius: var(--radius-pill)`

9. `.toggle-switch`: keep existing 11px radius (pill shape)

- [ ] **Step 2: Build and verify**

Run: `npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Studio.svelte
git commit -m "style: polish Studio shell — tokens, shadows, rounded corners"
```

---

### Task 7: UI Polish — AssetSidebar

**Files:**
- Modify: `web/src/components/AssetSidebar.svelte`

- [ ] **Step 1: Apply design tokens**

Read the current file. Apply these style changes:

1. `.asset-sidebar`: `border-radius: var(--radius-panel) 0 0 var(--radius-panel)` (rounded on left)
2. `.thumb-item`: `border-radius: var(--radius-card)`, add `box-shadow: var(--shadow-sm)` on hover
3. `.thumb-item.selected`: `box-shadow: 0 0 0 2px var(--spark-red), var(--shadow-md)`
4. `.group-header`: `border-radius: var(--radius-element)`, `margin: 0 8px`, add hover background
5. `.list-item`: `border-radius: var(--radius-element)`
6. `.group-content`: `padding: 0.4rem 0.6rem 0.6rem`
7. `.clip-play-icon`: `border-radius: var(--radius-element)`
8. `.group-count`: `border-radius: var(--radius-pill)`

- [ ] **Step 2: Build and verify**

Run: `npx vite build`

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AssetSidebar.svelte
git commit -m "style: polish AssetSidebar — rounded corners, shadows, spacing"
```

---

### Task 8: UI Polish — ChatPanel + StreamBlock

**Files:**
- Modify: `web/src/components/ChatPanel.svelte`
- Modify: `web/src/components/StreamBlock.svelte`

- [ ] **Step 1: Polish ChatPanel**

Read ChatPanel.svelte. Apply:

1. Chat input container: `border-radius: var(--radius-card)`, `box-shadow: var(--shadow-sm)`
2. Send button: `border-radius: var(--radius-element)`
3. Eval-blocked panel: `border-radius: var(--radius-card)`
4. Attachment chips: `border-radius: var(--radius-pill)`
5. Scroll area: smooth `scroll-behavior: smooth`
6. Input focus state: `box-shadow: 0 0 0 2px var(--spark-red), var(--shadow-md)`

- [ ] **Step 2: Polish StreamBlock**

Read StreamBlock.svelte. Apply:

1. `.stream-block` (all block types): `border-radius: var(--radius-card)`
2. `.tool-card`, `.thinking-card`: `border-radius: var(--radius-card)`
3. Code blocks inside: `border-radius: var(--radius-element)`
4. User message bubbles: `border-radius: var(--radius-card)` (keep asymmetric if present)
5. Eval divider badges: `border-radius: var(--radius-pill)`
6. Expand/collapse buttons: `border-radius: var(--radius-element)`
7. Add `transition: all var(--transition-fast)` to interactive elements

- [ ] **Step 3: Build and verify**

Run: `npx vite build`

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChatPanel.svelte web/src/components/StreamBlock.svelte
git commit -m "style: polish ChatPanel + StreamBlock — rounded, shadows, transitions"
```

---

### Task 9: UI Polish — PipelineBar + ImageLayout + PreviewArea

**Files:**
- Modify: `web/src/components/PipelineBar.svelte`
- Modify: `web/src/components/ImageLayout.svelte`
- Modify: `web/src/components/PreviewArea.svelte`

- [ ] **Step 1: Polish PipelineBar**

Read PipelineBar.svelte. Apply:

1. `.pipeline-bar`: `border-radius: 0` (flush bottom), `box-shadow: 0 -1px 3px rgba(0,0,0,0.1)` (top shadow)
2. `.step`: `border-radius: var(--radius-element)`, `padding: 0.35rem 0.75rem`
3. `.step-current`: `box-shadow: var(--shadow-sm)`
4. `.step-clickable:hover`: `box-shadow: var(--shadow-hover)`, `transform: translateY(-1px)`
5. `.connector`: style as a subtle dotted line with arrow, `border-radius: 1px`

- [ ] **Step 2: Polish ImageLayout**

Read ImageLayout.svelte. Apply:

1. `.image-card`: `border-radius: var(--radius-card)`, `box-shadow: var(--shadow-sm)`
2. `.image-card:hover`: `box-shadow: var(--shadow-hover)`, `transform: translateY(-2px)`
3. `.add-card`: `border-radius: var(--radius-card)`
4. `.overlay-btn`: `border-radius: var(--radius-element)`
5. `.order-badge`: keep `border-radius: 50%`
6. `.pill`: `border-radius: var(--radius-pill)`
7. `.copytext-title`, `.copytext-body`: increase line-height slightly for readability

- [ ] **Step 3: Polish PreviewArea**

Read PreviewArea.svelte. Apply:

1. `.preview-area`: `border-radius: var(--radius-panel)`, `overflow: hidden`
2. `.nav-btn`: `border-radius: 50%`, `box-shadow: var(--shadow-md)`
3. `.thumbnail`: `border-radius: var(--radius-element)`
4. `.thumbnail.selected`: `box-shadow: 0 0 0 2px var(--spark-red)`
5. `.thumbnail-strip`: `border-radius: 0 0 var(--radius-panel) var(--radius-panel)`
6. `.placeholder`: `border-radius: var(--radius-panel)`

- [ ] **Step 4: Build and verify**

Run: `npx vite build`

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PipelineBar.svelte web/src/components/ImageLayout.svelte web/src/components/PreviewArea.svelte
git commit -m "style: polish PipelineBar, ImageLayout, PreviewArea — tokens, shadows, hover lift"
```

---

### Task 10: Visual Verification and Final Polish

**Files:**
- Possibly modify any of the above files for fixes

- [ ] **Step 1: Full build**

Run: `npx vite build`
Expected: Clean build, no errors.

- [ ] **Step 2: Visual inspection via browser**

Open `http://localhost:5173/` in Chrome. Navigate to a work with assets (e.g. 西游记蛮荒版 or 当曝水变成变诗大片). Verify:

1. Timeline shows filmstrip thumbnails on video clips (or graceful fallback)
2. Audio track shows waveform bars spanning full width
3. Subtitle track is shorter (28px) with text labels
4. Playhead has circular top handle and can be dragged
5. Zoom controls work (toolbar slider, +/- buttons)
6. Clicking a clip selects it (cyan highlight) without sending chat
7. Trim handles appear on selected clip edges (cursor changes)
8. All components use rounded corners consistently
9. Hover states have shadow lift effects
10. Pipeline bar steps are nicely rounded
11. Chat panel input and bubbles are polished
12. Light theme looks equally good (toggle via settings)

- [ ] **Step 3: Fix any visual issues found**

Address any broken layouts, misaligned elements, or visual regressions.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "style: final visual polish pass — verify all components"
```
