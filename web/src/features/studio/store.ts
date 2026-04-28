import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Composition, Clip, AssetEntry, ProvenanceEdge } from "./types";

interface CompState {
  comp: Composition | null;
  selection: string | null;
  currentFrame: number;
  isPlaying: boolean;
  beats: number[];
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
}

function clipEnd(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio")
    return c.trackOffset + (c.out - c.in);
  return c.trackOffset + c.duration;
}

export const useComposition = create<CompState>()(
  immer((set) => ({
    comp: null,
    selection: null,
    currentFrame: 0,
    isPlaying: false,
    beats: [],
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
          cursor += c.kind === "video" || c.kind === "audio"
            ? (c.out - c.in)
            : c.duration;
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
  })),
);
