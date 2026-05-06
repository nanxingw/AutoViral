import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { Composition, Clip, AssetEntry, ProvenanceEdge } from "./types";
import {
  clipDuration,
  clipEnd,
  MIN_CLIP_DUR,
  OFFSET_EPSILON,
} from "./panels/Timeline/clipMath";
import {
  computeRipplePreview,
  snapDraggedStartFull,
} from "./panels/Timeline/dragEngine";
import { rippleDeleteFromTrack } from "./panels/Timeline/toolbar/rippleDelete";
import { collapseGapsOnTrack } from "./panels/Timeline/toolbar/collapseGaps";

// Phase 4.B — `dragState.preview` is a Map; immer needs the MapSet plugin
// enabled at module load to draft map mutations under produce().
enableMapSet();

export { clipDuration, clipEnd };

// Phase 4.B — drag-preview state. `preview` is keyed by clipId; values are
// candidate trackOffset (= start) seconds. `snapTime` surfaces the world-time
// of the active snap line so D10 (Playhead overlay) can render it.
export interface DragState {
  clipId: string;
  originalStart: number;
  candidateStart: number;
  preview: Map<string, number>;
  snapTime: number | null;
}

interface CompState {
  comp: Composition | null;
  selection: string | null;
  currentFrame: number;
  isPlaying: boolean;
  beats: number[];
  dragState: DragState | null;
  loadComposition: (c: Composition | null) => void;
  addClip: (trackId: string, clip: Clip) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  // Phase 4.C — ripple-delete + collapse-gaps. `rippleDeleteClip` is
  // separate from `removeClip` (which leaves a gap). D6 binds Backspace to
  // removeClip and Shift+Backspace to rippleDeleteClip in 4.J.
  rippleDeleteClip: (clipId: string) => void;
  collapseGaps: (trackId: string) => void;
  // Phase 4.I — edge-drag resize. `newTime` is the proposed timeline-time of
  // the moving edge. Clamps left at 0, right at next clip's trackOffset (D2),
  // and enforces minDuration 0.05s on both edges. Branches on clip kind:
  // video/audio mutate `in`/`out`; text/overlay mutate `duration`.
  resizeClip: (clipId: string, edge: "left" | "right", newTime: number) => void;
  // Phase 4.G — click-to-split tool (BladeTool). `bladeMode` toggles the
  // overlay; `splitClip` splits the clip whose time-range contains
  // `atSec` into two halves at `atSec`. D7: new id from
  // `crypto.randomUUID()`. D4: split-on-gap (or out-of-clip) is a silent
  // no-op. Audit Q3: both children inherit transforms/filters/style/
  // position/volume/fadeIn/fadeOut identically.
  bladeMode: boolean;
  setBladeMode: (on: boolean) => void;
  splitClip: (clipId: string, atSec: number) => void;
  setSelection: (id: string | null) => void;
  setFrame: (f: number) => void;
  setPlaying: (p: boolean) => void;
  setBeats: (b: number[]) => void;
  recomputeDuration: () => void;
  moveClipWithinTrack: (trackId: string, fromIndex: number, toIndex: number) => void;
  // Phase 1.6 — provenance graph mutations
  addAsset: (asset: AssetEntry) => void;
  addProvenance: (edge: ProvenanceEdge) => void;
  removeAsset: (assetId: string) => void;
  // Phase 5.B — rebind a clip to a different asset (no provenance edge per D4)
  rebindClip: (clipId: string, newAssetId: string) => void;
  // Phase 4.B — drag-preview actions (begin → update → commit/cancel)
  beginDrag: (clipId: string) => void;
  updateDragCandidate: (candidateStart: number) => void;
  commitDrag: () => void;
  cancelDrag: () => void;
}

export const useComposition = create<CompState>()(
  immer((set) => ({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
    dragState: null,
    bladeMode: false,
    loadComposition: (c) =>
      set((s) => {
        s.comp = c;
      }),
    addClip: (trackId, clip) =>
      set((s) => {
        if (!s.comp) return;
        const t = s.comp.tracks.find((t) => t.id === trackId);
        if (!t) return;
        // immer-friendly: cast to satisfy union element typing
        (t.clips as Clip[]).push(clip);
        const end = clipEnd(clip);
        if (end > s.comp.duration) s.comp.duration = end;
      }),
    updateClip: (clipId, patch) =>
      set((s) => {
        if (!s.comp) return;
        let touched = false;
        for (const t of s.comp.tracks) {
          const c = (t.clips as Clip[]).find((c) => c.id === clipId);
          if (c) {
            Object.assign(c, patch);
            touched = true;
            break;
          }
        }
        // If clip timing changed, duration may need to grow OR shrink.
        // Plain `if (end > duration)` (the previous behaviour) only ever grew it,
        // so dragging a clip earlier left stale empty tail. (Codex review 2026-04-27)
        if (touched) {
          s.comp.duration = Math.max(
            0,
            ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
          );
        }
      }),
    moveClipWithinTrack: (trackId: string, fromIndex: number, toIndex: number) =>
      set((s) => {
        if (!s.comp) return;
        const t = s.comp.tracks.find((t) => t.id === trackId);
        if (!t) return;
        const clips = t.clips as Clip[];
        if (fromIndex < 0 || fromIndex >= clips.length || toIndex < 0 || toIndex >= clips.length) return;
        const [moved] = clips.splice(fromIndex, 1);
        clips.splice(toIndex, 0, moved);
        // Re-pack trackOffsets so visual order matches time order
        let cursor = 0;
        for (const c of clips) {
          c.trackOffset = cursor;
          cursor += clipDuration(c);
        }
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
      }),
    removeClip: (clipId) =>
      set((s) => {
        if (!s.comp) return;
        for (const t of s.comp.tracks) {
          t.clips = (t.clips as Clip[]).filter((c) => c.id !== clipId) as typeof t.clips;
        }
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
      }),
    // ─── Phase 4.C — ripple-delete + collapse-gaps ───────────────────────
    // Both delegate to pure-track helpers under
    // `panels/Timeline/toolbar/{rippleDelete,collapseGaps}.ts`. Adapted
    // from pneuma's CompositionCommand[] builders (see those files for
    // citations) and gated behind D3 (`clipDuration` from clipMath.ts).
    rippleDeleteClip: (clipId) =>
      set((s) => {
        if (!s.comp) return;
        for (let i = 0; i < s.comp.tracks.length; i++) {
          const t = s.comp.tracks[i];
          if ((t.clips as Clip[]).some((c) => c.id === clipId)) {
            s.comp.tracks[i] = rippleDeleteFromTrack(t, clipId) as typeof t;
            break;
          }
        }
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
      }),
    collapseGaps: (trackId) =>
      set((s) => {
        if (!s.comp) return;
        const idx = s.comp.tracks.findIndex((t) => t.id === trackId);
        if (idx < 0) return;
        s.comp.tracks[idx] = collapseGapsOnTrack(
          s.comp.tracks[idx],
        ) as typeof s.comp.tracks[number];
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
      }),
    // ─── Phase 4.I — edge-drag resize ─────────────────────────────────────
    // Adopts pneuma's clamp expressions (`.cache/pneuma-clipcraft/.../
    // useClipResize.ts:132-156`) — pneuma dispatches commands; we mutate
    // state directly. D2 caps the right edge at the next clip's trackOffset
    // to avoid overlap. Both edges enforce minDuration 0.05s.
    resizeClip: (clipId, edge, newTime) =>
      set((s) => {
        if (!s.comp) return;
        for (const track of s.comp.tracks) {
          const clips = track.clips as Clip[];
          const idx = clips.findIndex((c) => c.id === clipId);
          if (idx < 0) continue;
          const c = clips[idx] as Clip;
          const start = c.trackOffset;
          const dur = clipDuration(c);
          const end = start + dur;
          if (edge === "right") {
            // D2 — right-edge cap at the next clip's start (any neighbour
            // strictly after `start`, on the same track). Single-clip tracks
            // have no neighbour → cap = +∞.
            const next = clips
              .filter(
                (x) => x.id !== clipId && x.trackOffset > start + OFFSET_EPSILON,
              )
              .sort((x, y) => x.trackOffset - y.trackOffset)[0];
            const cap = next ? next.trackOffset : Infinity;
            const clamped = Math.min(
              cap,
              Math.max(start + MIN_CLIP_DUR, newTime),
            );
            if (c.kind === "video" || c.kind === "audio") {
              c.out = c.in + (clamped - start);
            } else {
              // text / overlay
              c.duration = clamped - start;
            }
          } else {
            // Left edge: clamp to [0, end - MIN_CLIP_DUR].
            const clamped = Math.min(end - MIN_CLIP_DUR, Math.max(0, newTime));
            const delta = clamped - start;
            if (c.kind === "video" || c.kind === "audio") {
              // pneuma: left edge increments inPoint, anchors right edge.
              c.in += delta;
              c.trackOffset = clamped;
            } else {
              c.duration -= delta;
              c.trackOffset = clamped;
            }
          }
          s.comp.duration = Math.max(
            0,
            ...s.comp.tracks.flatMap((t) =>
              (t.clips as Clip[]).map(clipEnd),
            ),
          );
          return;
        }
      }),
    // ─── Phase 4.G — BladeTool (click-to-split) ──────────────────────────
    // Pneuma reference: master plan §4.2.G + `useSplitHoverSnap.ts`. We
    // diverge from pneuma's CompositionCommand pipeline (it dispatches a
    // SPLIT command); here we mutate state directly. Math: at timeline-
    // time `t` where `clip.trackOffset ≤ t < clip.trackOffset +
    // clipDuration(clip)`, child A keeps the original id and shrinks to
    // `[trackOffset, t)`; child B gets `crypto.randomUUID()` (D7) and
    // covers `[t, end)`. Boundary equality (`t === start` or `t === end`)
    // is a silent no-op — would otherwise produce a zero-width child.
    setBladeMode: (on) =>
      set((s) => {
        s.bladeMode = on;
      }),
    splitClip: (clipId, atSec) =>
      set((s) => {
        if (!s.comp) return;
        for (const track of s.comp.tracks) {
          const clips = track.clips as Clip[];
          const idx = clips.findIndex((c) => c.id === clipId);
          if (idx < 0) continue;
          const orig = clips[idx];
          const start = orig.trackOffset;
          const dur = clipDuration(orig);
          const end = start + dur;
          // D4 — split-on-gap (out-of-clip) is a silent no-op. Boundary
          // equality (within OFFSET_EPSILON) also no-ops to prevent
          // zero-width children.
          if (atSec <= start + OFFSET_EPSILON) return;
          if (atSec >= end - OFFSET_EPSILON) return;
          const offsetIntoClip = atSec - start;
          const newId = crypto.randomUUID();
          if (orig.kind === "video" || orig.kind === "audio") {
            const childA = { ...orig, out: orig.in + offsetIntoClip };
            const childB = {
              ...orig,
              id: newId,
              in: orig.in + offsetIntoClip,
              trackOffset: atSec,
            };
            (track.clips as Clip[]).splice(idx, 1, childA, childB);
          } else {
            // text / overlay — duration-based
            const childA = { ...orig, duration: offsetIntoClip };
            const childB = {
              ...orig,
              id: newId,
              trackOffset: atSec,
              duration: dur - offsetIntoClip,
            };
            (track.clips as Clip[]).splice(idx, 1, childA, childB);
          }
          s.comp.duration = Math.max(
            0,
            ...s.comp.tracks.flatMap((t) =>
              (t.clips as Clip[]).map(clipEnd),
            ),
          );
          return;
        }
      }),
    rebindClip: (clipId, newAssetId) =>
      set((s) => {
        if (!s.comp) return;
        const newAsset = s.comp.assets.find((a) => a.id === newAssetId);
        if (!newAsset) return; // unknown asset → silent no-op (test contract)
        for (const t of s.comp.tracks) {
          const c = (t.clips as Clip[]).find((c) => c.id === clipId);
          if (c) {
            // text clips have no `src` field — skip them; rebind only applies
            // to video / audio / overlay clips that bind to a media URI.
            if (c.kind !== "text") {
              c.src = newAsset.uri;
            }
            return;
          }
        }
        // clipId not found → silent no-op
      }),
    setSelection: (id) =>
      set((s) => {
        s.selection = id;
      }),
    setFrame: (f) =>
      set((s) => {
        // Clamp at the action so any caller (Playhead drag, 4.J keyboard
        // nudge, future playback engine, devtools) can't write a negative
        // or out-of-bounds frame. Upper bound = ceil(comp.duration * fps).
        if (!Number.isFinite(f)) return;
        const fps = s.comp?.fps ?? 30;
        const max = s.comp ? Math.ceil(s.comp.duration * fps) : Infinity;
        s.currentFrame = Math.max(0, Math.min(max, Math.round(f)));
      }),
    setPlaying: (p) =>
      set((s) => {
        s.isPlaying = p;
      }),
    setBeats: (b) =>
      set((s) => {
        s.beats = b;
      }),
    recomputeDuration: () =>
      set((s) => {
        if (!s.comp) return;
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
      }),
    // ─── Phase 1.6 — provenance graph mutations ───────────────────────────
    addAsset: (asset) =>
      set((s) => {
        if (!s.comp) return;
        if (s.comp.assets.some((a) => a.id === asset.id)) return;
        s.comp.assets.push(asset);
      }),
    addProvenance: (edge) =>
      set((s) => {
        if (!s.comp) return;
        s.comp.provenance.push(edge);
      }),
    removeAsset: (assetId) =>
      set((s) => {
        if (!s.comp) return;
        s.comp.assets = s.comp.assets.filter((a) => a.id !== assetId);
        s.comp.provenance = s.comp.provenance.filter(
          (e) => e.toAssetId !== assetId,
        );
      }),
    // ─── Phase 4.B — drag-preview pipeline ────────────────────────────────
    // Pneuma's dragState lives in the React store (not React component
    // state) so the Playhead overlay can read `snapTime` for its full-height
    // snap line (D10) and Track/Filmstrip can render ghost positions.
    beginDrag: (clipId) =>
      set((s) => {
        if (!s.comp) return;
        const all = s.comp.tracks.flatMap((t) => t.clips as Clip[]);
        const clip = all.find((c) => c.id === clipId);
        if (!clip) return;
        s.dragState = {
          clipId,
          originalStart: clip.trackOffset,
          candidateStart: clip.trackOffset,
          preview: new Map([[clipId, clip.trackOffset]]),
          snapTime: null,
        };
      }),
    updateDragCandidate: (candidateStart) =>
      set((s) => {
        if (!s.comp || !s.dragState) return;
        const draggedId = s.dragState.clipId;
        // Ripple stays within the dragged clip's own track — cross-track
        // clips are visible via collectSnapPoints (for snap lines) but never
        // get pushed by the cascade.
        const track = s.comp.tracks.find((t) =>
          (t.clips as Clip[]).some((c) => c.id === draggedId),
        );
        if (!track) return;
        const dragged = (track.clips as Clip[]).find((c) => c.id === draggedId);
        if (!dragged) return;
        const draggedDur = clipDuration(dragged);
        const fps = s.comp.fps || 30;
        const playhead = s.currentFrame / fps;
        const snap = snapDraggedStartFull(
          s.comp,
          draggedId,
          draggedDur,
          candidateStart,
          playhead,
          0.06,
        );
        const preview = computeRipplePreview(
          track.clips as Clip[],
          draggedId,
          snap.start,
        );
        s.dragState.candidateStart = candidateStart;
        s.dragState.preview = preview;
        s.dragState.snapTime = snap.snapTime;
      }),
    commitDrag: () =>
      set((s) => {
        if (!s.comp || !s.dragState) return;
        const preview = s.dragState.preview;
        for (const t of s.comp.tracks) {
          for (const c of t.clips as Clip[]) {
            const newStart = preview.get(c.id);
            if (newStart !== undefined) c.trackOffset = newStart;
          }
        }
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
        s.dragState = null;
      }),
    cancelDrag: () =>
      set((s) => {
        s.dragState = null;
      }),
  })),
);
