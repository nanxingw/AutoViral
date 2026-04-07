# Timeline Professional Upgrade + Global UI Polish

**Date:** 2026-04-07
**Status:** Approved
**Branch:** refactor/studio-workspace

## Context

The Studio workspace timeline currently uses plain colored DOM boxes for clips, a fake static waveform for audio, and a non-interactive playhead. The overall UI has harsh angular edges (6px border-radius everywhere), tight spacing, and lacks the visual refinement expected of a creative tool.

Research of industry-standard web NLEs (OpenCut 47k stars, designcombo, wavesurfer.js, peaks.js) identified key patterns our timeline must adopt. Meanwhile, Medeo and CapCut-style tools show that rounded, well-spaced interfaces with subtle shadows feel significantly more professional.

Our positioning is **AI-assisted creation** — the timeline is primarily for previewing AI output and making light edits, not full manual editing. This means visual quality must be professional-grade but interaction depth can be simplified.

## Design

### 1. Timeline Visual Upgrade

#### 1.1 Video Track — Filmstrip Thumbnails
- Track height: **65px** (up from 48px)
- Each clip renders a `<canvas>` element that extracts frames from the video at regular intervals
- Frames are tiled horizontally to create a filmstrip effect
- Fallback: if video frame extraction fails, show the existing `<video preload="metadata">` first-frame approach with a tinted overlay
- Clip label + duration overlay at bottom-left with semi-transparent background

#### 1.2 Audio Track — Waveform Rendering
- Track height: **50px** (up from 48px)
- Use Web Audio API (`AudioContext.decodeAudioData`) to extract PCM data
- Render RMS-normalized waveform bars on `<canvas>` (2px bar width, 1px gap)
- Color: `rgba(168, 85, 247, 0.6)` (purple) on `var(--bg-surface)` background
- Fallback: if decoding fails (CORS, unsupported format), show current simulated wave bars
- Label overlay: audio type prefix + filename

#### 1.3 Subtitle Track
- Track height: **28px** (down from 48px)
- Color: cyan-tinted blocks (`rgba(37, 244, 238, 0.15)`)
- Text preview truncated with ellipsis
- Font: 10px, single line

#### 1.4 Playhead
- Full-height vertical line: 2px wide, `var(--spark-red)`
- Top handle: 12px circle, filled `var(--spark-red)`, draggable
- Dragging the handle or clicking the ruler seeks to that position
- Box-shadow glow: `0 0 6px rgba(254, 44, 85, 0.4)`
- Z-index: 30 (above clips, below context menus)

#### 1.5 Ruler — Adaptive Tick Density
- Tick interval adapts to zoom level:
  - Zoomed out: 10s major ticks, 5s minor ticks
  - Default: 5s major, 1s minor
  - Zoomed in: 1s major, 0.5s minor
- Major ticks: time label + taller mark
- Minor ticks: shorter mark, no label
- Current time displayed in ruler area

#### 1.6 Zoom Controls
- Timeline toolbar with: zoom-out button, slider, zoom-in button
- Zoom factor: 1.5x per click
- Ctrl+scroll wheel on timeline area for zoom
- Zoom anchors to playhead position if visible
- Min zoom fits entire duration in viewport
- State: `zoomLevel` (default 1.0, range 0.5–5.0)

#### 1.7 Track Header Column
- Fixed 80px wide column on left (does not scroll horizontally)
- Per track: type icon + track name
- Audio tracks: mute/unmute toggle button
- Visual separator between header column and scrollable track area

#### 1.8 Timeline Toolbar
- Height: 40px, between preview area and ruler
- Left group: split (scissors), delete (trash) — operate on selected clip
- Center: total duration display
- Right group: snap toggle (future), zoom controls

### 2. Light Editing Interactions

#### 2.1 Trim Handles
- Appear only when a clip is selected
- 8px wide invisible hit zones on left and right edges of clip
- Cursor changes to `col-resize` on hover
- Dragging adjusts `trimStart` (left handle) or `trimEnd` / duration (right handle)
- Visual feedback: semi-transparent overlay showing trimmed region
- Changes fire `onTrim` callback with clip ID, new start, new duration

#### 2.2 Drag Reorder
- Existing HTML5 drag-and-drop preserved
- Enhanced visual: dragged clip becomes semi-transparent (opacity 0.4)
- Drop target shows a 2px insertion line between clips
- Only video track supports reorder

### 3. Global UI Polish

#### 3.1 Border Radius Scale
```
--radius-panel: 8px;    /* panels, timeline container, modals */
--radius-card: 10px;    /* cards, inputs, dropdowns */
--radius-element: 12px; /* buttons, tags, pills, clip blocks */
```
Applied consistently across all 8 components.

#### 3.2 Shadow System
```
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
--shadow-md: 0 2px 8px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.15);
--shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.12);
```
- Panels use `--shadow-sm` instead of hard 1px borders
- Hover states use `--shadow-hover` for lift effect
- Modals/dropdowns use `--shadow-lg`
- Borders remain but at reduced contrast: `rgba(255,255,255,0.04)` dark / `rgba(0,0,0,0.06)` light

#### 3.3 Spacing Scale
- Component gap: 8-10px (up from 6px)
- Panel internal padding: 16px (up from 12px)
- Section gaps: 12px
- Tight spacing (4px) only within composite elements

#### 3.4 Interaction Polish
- All interactive elements: `transition: all 0.15s ease`
- Hover: background shift + shadow lift
- Active/pressed: `transform: scale(0.98)` on buttons
- Selected state: 2px solid border + subtle background tint
- Focus-visible: 2px ring with offset for keyboard navigation

### 4. Component Change Map

| Component | Changes |
|-----------|---------|
| **TrackRow.svelte** | Rewrite: Canvas filmstrip/waveform, variable track height, trim handles, selection highlight |
| **Timeline.svelte** | Add: zoom state + controls, toolbar, playhead drag, adaptive ruler, track header column, scrollable track area |
| **AssetSidebar.svelte** | Polish: radius, spacing, shadow, hover states |
| **PreviewArea.svelte** | Polish: radius, control bar styling |
| **ChatPanel.svelte** | Polish: radius, bubble styles, input field, scroll area |
| **PipelineBar.svelte** | Polish: radius, connector style, step badges |
| **Studio.svelte** | Polish: panel gaps, resize handles, header |
| **ImageLayout.svelte** | Polish: card radius, shadow, hover |
| **StreamBlock.svelte** | Polish: block radius, code block styling |

### 5. CSS Custom Properties Additions

Added to the root theme (in App.svelte or equivalent):
```css
/* Border radius scale */
--radius-panel: 8px;
--radius-card: 10px;
--radius-element: 12px;

/* Shadow scale */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
--shadow-md: 0 2px 8px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.15);
--shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.12);

/* Timeline specific */
--track-height-video: 65px;
--track-height-audio: 50px;
--track-height-subtitle: 28px;
--track-header-width: 80px;
--timeline-toolbar-height: 40px;
```

### 6. Out of Scope

- Multi-select / rubber-band selection
- Snap-to-grid / magnetic snapping
- Keyframe editor
- Full Canvas rendering (staying DOM-based)
- Transitions between clips
- Audio mixing / volume envelope
- Undo/redo stack for timeline edits
