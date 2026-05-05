import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { Composition, Clip, AssetEntry, ProvenanceEdge } from "./types";
import { clipDuration, clipEnd } from "./panels/Timeline/clipMath";
import {
  computeRipplePreview,
  snapDraggedStartFull,
} from "./panels/Timeline/dragEngine";

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
    setSelection: (id) =>
      set((s) => {
        s.selection = id;
      }),
    setFrame: (f) =>
      set((s) => {
        s.currentFrame = f;
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
