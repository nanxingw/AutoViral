import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet, current, isDraft } from "immer";
import type {
  Composition,
  Clip,
  AssetEntry,
  ProvenanceEdge,
  ExportPreset,
  Keyframe,
  Track,
} from "./types";
import { newTrackId } from "@shared/composition";
import { addOrReplaceKeyframe, splitKeyframesAtLocal } from "@shared/keyframes";
import {
  clipDuration,
  clipEnd,
  MIN_CLIP_DUR,
  OFFSET_EPSILON,
  computeRipplePreview,
  snapDraggedStartFull,
} from "@autoviral/timeline";
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

// Phase E (issue #32) — Track-level undo/redo. No global undo/redo machinery
// exists in this store today; instead of dragging in a generic `zundo`-style
// middleware (which would force us to retrofit every previous slice), we keep
// a focused snapshot stack scoped to lane mutations (add / remove / reorder /
// rename / setLanguage / setVolume). Each action snapshots the *full tracks
// array* before the mutation; undo restores it, redo replays. This is the
// "existing undo/redo stack" PRD §Phase E referenced — we're establishing it
// here as the smallest thing that satisfies the acceptance criteria without
// scope-creeping into clip-level history. Future slices can fold clip ops in
// by extending pushTrackHistory() to snapshot more than just `tracks`.
const TRACK_HISTORY_LIMIT = 50;

export interface TrackHistory {
  past: Track[][];
  future: Track[][];
}

// Result type for removeTrack: UI distinguishes "needs confirm" from "done".
export interface RemoveTrackResult {
  ok: boolean;
  reason?: "has-clips" | "not-found" | "no-composition";
}

// Result type for addTrack: returns the minted id so callers (UI, tests) can
// immediately reference the new lane.
export type AddTrackOpts = {
  afterTrackId?: string;
  language?: string;
  label?: string;
};

interface CompState {
  comp: Composition | null;
  selection: string | null;
  currentFrame: number;
  isPlaying: boolean;
  beats: number[];
  dragState: DragState | null;
  // Phase E (issue #32) — track-op undo/redo stack. Separate from any future
  // clip-level history so the two can be reasoned about independently.
  trackHistory: TrackHistory;
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
  // Phase 6.D — apply a platform export preset. Atomic per D5: updates
  // exportPresets[0] AND aspect/width/height/fps in a single transaction.
  applyPlatformPreset: (preset: ExportPreset) => void;
  // ─── Phase 8.2.B — keyframe mutations for the Inspector KeyframePanel ──
  // addKeyframe is idempotent on (property, time) collision (D4 — replace
  // existing entry via addOrReplaceKeyframe). All three are no-ops for
  // TextClip (D8 — text doesn't carry keyframes) and unknown clipIds.
  // updateKeyframe / removeKeyframe operate on the *original-array index*,
  // not the sorted-display index — the panel must track that mapping.
  addKeyframe: (clipId: string, kf: Keyframe) => void;
  removeKeyframe: (clipId: string, indexInClipArray: number) => void;
  updateKeyframe: (
    clipId: string,
    indexInClipArray: number,
    patch: Partial<Keyframe>,
  ) => void;
  // Phase 4.B — drag-preview actions (begin → update → commit/cancel)
  beginDrag: (clipId: string) => void;
  updateDragCandidate: (candidateStart: number) => void;
  commitDrag: () => void;
  cancelDrag: () => void;
  // ─── Phase E (issue #32) — multi-track stacking lane actions ──────────
  // `addTrack` returns the minted id synchronously. Default placement is
  // *at the end of the same-kind block* — adding an audio lane lands after
  // the last existing audio lane, never inside the video block. Pass
  // `afterTrackId` to override (the new lane gets `displayOrder = anchor + 1`
  // and everything ≥ that gets shifted down by one).
  addTrack: (kind: Track["kind"], opts?: AddTrackOpts) => string;
  // Returns `{ ok: false, reason: "has-clips" }` when the track is non-empty
  // so the UI can pop a confirm dialog; call again with `{ force: true }` to
  // delete anyway. The orphaned clips disappear with the track (UI warning is
  // issue #33's territory).
  removeTrack: (
    id: string,
    opts?: { force?: boolean },
  ) => RemoveTrackResult;
  // Move one track's `displayOrder` to land at `toIndex` in the global
  // (kind-agnostic) sort. Transactional: every other track's `displayOrder`
  // gets recompacted to keep the invariant sort(displayOrder) === 0..N-1.
  reorderTracks: (fromId: string, toIndex: number) => void;
  renameTrack: (id: string, label: string) => void;
  // Subtitle / text lanes only. Calling on other kinds is a friendly no-op
  // (UI shouldn't expose the affordance there; we warn instead of throwing
  // so a buggy caller can't crash the studio).
  setTrackLanguage: (id: string, lang: string | null) => void;
  // Audio lanes only. Wires the dB into a forward-compat `volume` field that
  // issue #34 will formalise on the schema; until then we cast through the
  // type since `Track.volume` doesn't exist on the strict schema yet. Once
  // #34 lands the cast can disappear and round-trip persistence kicks in.
  setTrackVolume: (id: string, db: number) => void;
  // Undo / redo for the lane stack only — clip-level history is a separate
  // future slice. `undoTrackOp` is a no-op when past is empty; same for redo
  // when future is empty.
  undoTrackOp: () => void;
  redoTrackOp: () => void;
}

// Deep-clone tracks for the history stack. Two paths because the same helper
// gets called from both inside the immer producer (where `tracks` is a draft
// proxy that `structuredClone` cannot serialise) AND from outside it (when we
// pre-read state in `removeTrack` to decide the return value). `current()`
// materialises a draft into a plain immutable snapshot; for already-plain
// arrays we JSON-clone, which is fine because Track has no Date / Map / Set
// fields (every property is a primitive, string-keyed object, or nested
// arrays of the same).
function snapshotTracks(tracks: Track[]): Track[] {
  const plain = isDraft(tracks) ? (current(tracks) as Track[]) : tracks;
  return JSON.parse(JSON.stringify(plain)) as Track[];
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
    trackHistory: { past: [], future: [] },
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
            const newDur = clamped - start;
            if (c.kind === "video" || c.kind === "audio") {
              c.out = c.in + newDur;
            } else {
              // text / overlay
              c.duration = newDur;
            }
            // #48 — a right-edge trim shrinks the clip-local window to
            // [0, newDur). Keyframe time is trackOffset-relative and the left
            // edge stays anchored, so existing times remain valid; only the
            // tail past the new end must be dropped/clamped. Reuse the SAME
            // helper splitClip uses (#46 sibling): splitKeyframesAtLocal's left
            // half (.a) keeps keyframes before newDur and inserts a boundary at
            // newDur preserving the curve up to the cut.
            const rKfs = (c as { keyframes?: Keyframe[] }).keyframes;
            if (rKfs && rKfs.some((k) => k.time > newDur + OFFSET_EPSILON)) {
              (c as { keyframes?: Keyframe[] }).keyframes =
                splitKeyframesAtLocal(rKfs, newDur).a;
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
            // #48 — a left-edge trim shifts the clip's content start by `delta`
            // seconds, so every keyframe (time is trackOffset-relative) must
            // rebase by -delta and any frames now off the front drop. Reuse
            // splitKeyframesAtLocal's right half (.b): a boundary at clip-local
            // 0 holding the interpolated value at the cut, then later keyframes
            // rebased to 0 — identical math to splitClip's child B (#46), which
            // keeps C0 continuity instead of snapping to a held value. delta<0
            // (left-extend) shifts every keyframe right, also handled by .b.
            const lKfs = (c as { keyframes?: Keyframe[] }).keyframes;
            if (lKfs && lKfs.length > 0 && Math.abs(delta) > OFFSET_EPSILON) {
              (c as { keyframes?: Keyframe[] }).keyframes =
                splitKeyframesAtLocal(lKfs, delta).b;
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
          // #46 — partition + rebase keyframes at the clip-local split point so
          // each half keeps only its own keyframes (rebased to clip-local 0 for
          // child B). offsetIntoClip is already the clip-local split time for
          // every kind (renderers measure keyframe time from trackOffset, not
          // source `in`). undefined keyframes (text clips, D8) → empty halves.
          const origKfs = (orig as { keyframes?: Keyframe[] }).keyframes;
          const { a: kfA, b: kfB } = origKfs
            ? splitKeyframesAtLocal(origKfs, offsetIntoClip)
            : { a: undefined, b: undefined };
          if (orig.kind === "video" || orig.kind === "audio") {
            const childA = { ...orig, out: orig.in + offsetIntoClip };
            const childB = {
              ...orig,
              id: newId,
              in: orig.in + offsetIntoClip,
              trackOffset: atSec,
            };
            if (origKfs) {
              (childA as { keyframes?: Keyframe[] }).keyframes = kfA;
              (childB as { keyframes?: Keyframe[] }).keyframes = kfB;
            }
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
            if (origKfs) {
              (childA as { keyframes?: Keyframe[] }).keyframes = kfA;
              (childB as { keyframes?: Keyframe[] }).keyframes = kfB;
            }
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
    // ─── Phase 6.D — applyPlatformPreset (D5 atomic) ──────────────────────
    // One zustand transaction: exportPresets[0] + aspect + width + height +
    // fps all flip together. Aspect is inferred from preset width/height
    // (9:16 / 1:1 / 16:9 / 4:5); non-canonical ratios keep the existing
    // aspect untouched.
    applyPlatformPreset: (preset) =>
      set((s) => {
        if (!s.comp) return;
        const ratio = preset.width / preset.height;
        let aspect: typeof s.comp.aspect = s.comp.aspect;
        if (Math.abs(ratio - 9 / 16) < 0.01) aspect = "9:16";
        else if (Math.abs(ratio - 1) < 0.01) aspect = "1:1";
        else if (Math.abs(ratio - 16 / 9) < 0.01) aspect = "16:9";
        else if (Math.abs(ratio - 4 / 5) < 0.01) aspect = "4:5";
        s.comp.aspect = aspect;
        s.comp.width = preset.width;
        s.comp.height = preset.height;
        s.comp.fps = preset.fps as 24 | 25 | 30 | 60;
        s.comp.exportPresets = [preset]; // replace, not append
        s.comp.updatedAt = new Date().toISOString();
      }),
    // ─── Phase 8.2.B — keyframe mutations ─────────────────────────────────
    // Walk every track, find the clip by id, then mutate `keyframes` on the
    // draft. Skip TextClip (D8) and unknown clipIds (silent no-op). The
    // (property, time) collision math lives inside `addOrReplaceKeyframe`
    // (8.2.A) — we just delegate.
    addKeyframe: (clipId, kf) =>
      set((s) => {
        if (!s.comp) return;
        for (const t of s.comp.tracks) {
          const c = (t.clips as Clip[]).find((c) => c.id === clipId);
          if (!c) continue;
          if (c.kind === "text") return; // D8
          // c is VideoClip | AudioClip | OverlayClip — all have keyframes?: Keyframe[]
          const target = c as { keyframes?: Keyframe[] };
          target.keyframes = addOrReplaceKeyframe(target.keyframes, kf);
          return;
        }
      }),
    removeKeyframe: (clipId, indexInClipArray) =>
      set((s) => {
        if (!s.comp) return;
        for (const t of s.comp.tracks) {
          const c = (t.clips as Clip[]).find((c) => c.id === clipId);
          if (!c) continue;
          if (c.kind === "text") return;
          const target = c as { keyframes?: Keyframe[] };
          const arr = target.keyframes;
          if (!arr) return;
          if (indexInClipArray < 0 || indexInClipArray >= arr.length) return;
          arr.splice(indexInClipArray, 1);
          if (arr.length === 0) target.keyframes = undefined;
          return;
        }
      }),
    updateKeyframe: (clipId, indexInClipArray, patch) =>
      set((s) => {
        if (!s.comp) return;
        for (const t of s.comp.tracks) {
          const c = (t.clips as Clip[]).find((c) => c.id === clipId);
          if (!c) continue;
          if (c.kind === "text") return;
          const target = c as { keyframes?: Keyframe[] };
          const arr = target.keyframes;
          if (!arr) return;
          const entry = arr[indexInClipArray];
          if (!entry) return;
          Object.assign(entry, patch);
          return;
        }
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
    // ─── Phase E (issue #32) — multi-track stacking lane actions ────────
    // All five mutating actions (addTrack / removeTrack / reorderTracks /
    // renameTrack / setTrackLanguage / setTrackVolume) push the pre-mutation
    // `tracks` snapshot into `trackHistory.past` and clear `trackHistory
    // .future` (a new branch invalidates redo). Atomicity is guaranteed by
    // immer's produce(): if any inner step throws, the draft is discarded
    // and the store state is unchanged — getters mid-action see the previous
    // commit, never a half-state. (Pitfall #1 reminder: we mutate
    // `displayOrder` only; ids are immutable for the track's lifetime.)
    addTrack: (kind, opts) => {
      // We mint the id outside the producer so the return value is fixed
      // even if the immer transaction rolls back (which shouldn't happen
      // here, but the id stays predictable for tests).
      const id = newTrackId();
      set((s) => {
        if (!s.comp) return;
        // Snapshot before mutating — even no-op-on-load paths skipped above
        // mean we never push useless history entries.
        pushHistory(s);
        // Default label: `<KIND><N>` where N is the current count of that
        // kind + 1 (1-indexed for human friendliness). Audio gets `A2`,
        // video gets `V2`, text gets `CC2`, overlay gets `O2`. Caller can
        // override via opts.label.
        const sameKindCount = s.comp.tracks.filter(
          (t) => t.kind === kind,
        ).length;
        const kindLetter =
          kind === "video" ? "V" :
          kind === "audio" ? "A" :
          kind === "text" ? "CC" :
          "O";
        const label = opts?.label ?? `${kindLetter}${sameKindCount + 1}`;

        // Decide insertion displayOrder. Two paths:
        //  1. Caller passed `afterTrackId` — insert immediately after that
        //     anchor (anchor.displayOrder + 1, shift everything ≥ that down
        //     by one before adding the new lane).
        //  2. Default — insert at the *end of the same-kind block* so a new
        //     audio lane lands after the last existing audio lane (not after
        //     the video block). When no track of `kind` exists, fall through
        //     to "tail of all tracks".
        let insertOrder: number;
        if (opts?.afterTrackId) {
          const anchor = s.comp.tracks.find(
            (t) => t.id === opts.afterTrackId,
          );
          if (!anchor) {
            // Anchor vanished — degrade to tail-of-kind placement rather
            // than throw; the caller is presumably out of date.
            const sameKind = s.comp.tracks.filter((t) => t.kind === kind);
            insertOrder = sameKind.length
              ? Math.max(...sameKind.map((t) => t.displayOrder)) + 1
              : s.comp.tracks.length;
          } else {
            insertOrder = anchor.displayOrder + 1;
          }
        } else {
          const sameKind = s.comp.tracks.filter((t) => t.kind === kind);
          insertOrder = sameKind.length
            ? Math.max(...sameKind.map((t) => t.displayOrder)) + 1
            : s.comp.tracks.length;
        }

        // Shift any existing track with displayOrder ≥ insertOrder down by
        // one so the new lane can take that slot.
        for (const t of s.comp.tracks) {
          if (t.displayOrder >= insertOrder) t.displayOrder += 1;
        }

        const newTrack: Track = {
          id,
          kind,
          label,
          displayOrder: insertOrder,
          volume: 0, // dB gain, unity default (matches TrackSchema.volume)
          muted: false,
          hidden: false,
          clips: [],
          ...(opts?.language ? { language: opts.language } : {}),
        };
        s.comp.tracks.push(newTrack);
        // Recompact to guarantee the contiguous-0..N-1 invariant. This is a
        // belt-and-suspenders pass — the shift logic above should already be
        // contiguous, but a recompact makes the invariant survive any future
        // refactor that introduces gaps.
        recompactDisplayOrder(s.comp.tracks);
      });
      return id;
    },
    removeTrack: (id, opts) => {
      // We need to return a result *after* the immer transaction observes
      // state. Pre-read here under getState() so the result reflects the
      // canonical comp, then commit the mutation only when allowed.
      const state = useComposition.getState();
      if (!state.comp) return { ok: false, reason: "no-composition" };
      const target = state.comp.tracks.find((t) => t.id === id);
      if (!target) return { ok: false, reason: "not-found" };
      const force = opts?.force === true;
      if (target.clips.length > 0 && !force) {
        return { ok: false, reason: "has-clips" };
      }
      set((s) => {
        if (!s.comp) return;
        // Re-find inside the draft — the pre-read above used the previous
        // snapshot; another action could have raced in between (unlikely
        // in zustand's synchronous model but defensive).
        const idx = s.comp.tracks.findIndex((t) => t.id === id);
        if (idx < 0) return;
        pushHistory(s);
        s.comp.tracks.splice(idx, 1);
        recompactDisplayOrder(s.comp.tracks);
      });
      return { ok: true };
    },
    reorderTracks: (fromId, toIndex) =>
      set((s) => {
        if (!s.comp) return;
        const tracks = s.comp.tracks;
        const fromIdx = tracks.findIndex((t) => t.id === fromId);
        if (fromIdx < 0) return; // unknown id — silent no-op
        // Clamp toIndex into [0, N-1]. We accept any integer; out-of-bounds
        // values get pinned rather than thrown so DnD libraries that pass
        // overshoot indices Just Work.
        const target = Math.max(0, Math.min(tracks.length - 1, toIndex));
        // No-op when target equals current sorted position — avoid pushing
        // a redundant history entry.
        const sortedIds = [...tracks]
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((t) => t.id);
        const currentSortedIdx = sortedIds.indexOf(fromId);
        if (currentSortedIdx === target) return;

        pushHistory(s);
        // Rebuild the sorted id sequence with the move applied, then walk it
        // assigning fresh 0..N-1 displayOrder values. This is the cleanest
        // way to keep the invariant: we never partial-mutate displayOrder
        // mid-loop and risk a transient duplicate.
        const newOrder = [...sortedIds];
        newOrder.splice(currentSortedIdx, 1);
        newOrder.splice(target, 0, fromId);

        for (let i = 0; i < newOrder.length; i++) {
          const t = tracks.find((x) => x.id === newOrder[i]);
          if (t) t.displayOrder = i;
        }
      }),
    renameTrack: (id, label) =>
      set((s) => {
        if (!s.comp) return;
        const t = s.comp.tracks.find((t) => t.id === id);
        if (!t) return;
        if (t.label === label) return; // no-op if unchanged
        pushHistory(s);
        t.label = label;
      }),
    setTrackLanguage: (id, lang) =>
      set((s) => {
        if (!s.comp) return;
        const t = s.comp.tracks.find((t) => t.id === id);
        if (!t) return;
        if (t.kind !== "text") {
          // Brief contract: language is a subtitle/CC-track concern only.
          // Video / audio / overlay kinds get a friendly warn-and-bail so a
          // mis-wired UI affordance can't crash the studio.
          console.warn(
            `[studio.store] setTrackLanguage no-op on ${t.kind} track ${id}`,
          );
          return;
        }
        const next = lang ?? undefined;
        if (t.language === next) return;
        pushHistory(s);
        if (next === undefined) {
          delete (t as { language?: string }).language;
        } else {
          t.language = next;
        }
      }),
    setTrackVolume: (id, db) =>
      set((s) => {
        if (!s.comp) return;
        const t = s.comp.tracks.find((t) => t.id === id);
        if (!t) return;
        if (t.kind !== "audio") {
          console.warn(
            `[studio.store] setTrackVolume no-op on ${t.kind} track ${id}`,
          );
          return;
        }
        // Cast through — `volume` lands on the schema in issue #34. Until
        // then we attach it as a forward-compat field so the action works
        // end-to-end; the schema parser will accept it once #34 lands.
        const target = t as Track & { volume?: number };
        if (target.volume === db) return;
        pushHistory(s);
        target.volume = db;
      }),
    undoTrackOp: () =>
      set((s) => {
        if (!s.comp) return;
        const prev = s.trackHistory.past.pop();
        if (!prev) return; // empty stack — nothing to undo
        // Push the *current* tracks onto future before restoring, so a
        // subsequent redo can return us here.
        s.trackHistory.future.push(snapshotTracks(s.comp.tracks));
        s.comp.tracks = prev as typeof s.comp.tracks;
      }),
    redoTrackOp: () =>
      set((s) => {
        if (!s.comp) return;
        const next = s.trackHistory.future.pop();
        if (!next) return;
        s.trackHistory.past.push(snapshotTracks(s.comp.tracks));
        s.comp.tracks = next as typeof s.comp.tracks;
      }),
  })),
);

// ─── Phase E helpers — kept module-local so the actions read top-down ──
// pushHistory snapshots BEFORE the mutation so undo restores the pre-state.
// Trim past to TRACK_HISTORY_LIMIT entries to bound memory on long sessions.
// future is cleared because performing a new op invalidates any redo branch
// (standard editor semantics — diverge once you act).
function pushHistory(s: {
  comp: Composition | null;
  trackHistory: TrackHistory;
}) {
  if (!s.comp) return;
  s.trackHistory.past.push(snapshotTracks(s.comp.tracks));
  if (s.trackHistory.past.length > TRACK_HISTORY_LIMIT) {
    s.trackHistory.past.shift();
  }
  s.trackHistory.future = [];
}

// Recompact displayOrder so the array sorted by displayOrder is contiguous
// 0..N-1. Used after add / remove to guarantee the invariant.
function recompactDisplayOrder(tracks: Track[]) {
  // Sort a shallow copy by current displayOrder, then assign fresh 0..N-1
  // indices in-place. Each track is touched once; ties resolve by current
  // array position (stable sort), which keeps a deterministic recovery from
  // any accidental duplicate displayOrder state.
  const sorted = [...tracks].sort((a, b) => a.displayOrder - b.displayOrder);
  sorted.forEach((t, i) => {
    t.displayOrder = i;
  });
}
