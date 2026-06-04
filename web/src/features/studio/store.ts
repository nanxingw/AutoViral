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
  Transition,
} from "./types";
import { clampHandleDuration } from "@shared/transitions";
import { addOrReplaceKeyframe, splitKeyframesAtLocal } from "@shared/keyframes";
// ADR-009 (S6) — shared composition-ops core. splitClip's invariants live here
// now (single source of truth shared with the bridge); the store action calls
// `ops.splitClip` on the immer draft.
import * as ops from "@shared/composition/ops";
import { CompositionOpError } from "@shared/composition/ops";
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
import { useToastStore } from "@/stores/toast";
import { MESSAGES } from "@/i18n/messages";
import { useLocaleStore } from "@/i18n/store";

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
  // #3 — cross-track body-drag target. While the cursor hovers a *different
  // same-kind* lane mid-drag this holds that lane's id; null = stay in the
  // source track (horizontal-only scrub, the pre-#3 behaviour). commitDrag
  // applies a moveClipToTrack when this is set; the destination lane highlights
  // itself by reading this from dragState.
  targetTrackId: string | null;
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

// S20 (US 32) — clip-level undo/redo. The track-op stack above only captures
// lane mutations; a human who splits / trims / moves / sets / removes / adds a
// *clip* had no way back (and no Cmd+Z). This is the symmetrical stack scoped
// to clip mutations. Same `Track[][]` snapshot shape (a clip op only ever
// touches the tracks array — duration is re-derived on undo), same 50-deep
// bound. Kept SEPARATE from trackHistory so Cmd+Z over clip edits never
// resurrects a deleted lane and vice-versa.
export type ClipHistory = TrackHistory;

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
  // Phase E (issue #32) — track-op undo/redo stack. Separate from the
  // clip-level history below so the two can be reasoned about independently.
  trackHistory: TrackHistory;
  // S20 (US 32) — clip-op undo/redo stack (split/trim/move/set/remove/add).
  clipHistory: ClipHistory;
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
  // #88 — move a clip to a different track, preserving its trackOffset (time
  // position). No-op unless the target track exists, differs from the source,
  // and shares the source track's kind (a video clip can't live on an audio
  // lane). Like the other clip-level mutations it does NOT push undo history.
  moveClipToTrack: (clipId: string, targetTrackId: string) => void;
  // #54 Phase 1 — transitions at cut points on a video track. Each action is
  // a no-op for unknown ids / non-video tracks / orphan afterClipId (the cut
  // point's predecessor must exist AND have a successor — a transition pinned
  // to the last clip has nothing to fade INTO). addTransition mints the id +
  // clamps durationSec to the handle (min of the two adjacent clips' usable
  // duration); returns the new id, or null on rejection.
  addTransition: (
    trackId: string,
    init: { afterClipId: string; preset: Transition["preset"]; durationSec?: number },
  ) => string | null;
  updateTransition: (
    trackId: string,
    transitionId: string,
    patch: Partial<Pick<Transition, "preset" | "durationSec" | "alignment" | "easing">>,
  ) => void;
  removeTransition: (trackId: string, transitionId: string) => void;
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
  // #3 — record the cross-track move target while body-dragging. The caller
  // (Clip.tsx) resolves the hovered same-kind lane via `resolveDragTargetTrack`
  // and pushes it here; null clears it (cursor back over the source lane / a
  // cross-kind lane / outside any lane). commitDrag consumes it.
  updateDragTarget: (targetTrackId: string | null) => void;
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
  // Undo / redo for the lane stack only — clip-level history is the separate
  // stack below. `undoTrackOp` is a no-op when past is empty; same for redo
  // when future is empty.
  undoTrackOp: () => void;
  redoTrackOp: () => void;
  // S20 (US 32) — undo / redo for clip mutations only. No-op on an empty
  // stack. Drives the Cmd+Z / Ctrl+Z keybinding (see useShortcuts).
  undoClipOp: () => void;
  redoClipOp: () => void;
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
    clipHistory: { past: [], future: [] },
    loadComposition: (c) =>
      set((s) => {
        s.comp = c;
      }),
    addClip: (trackId, clip) =>
      set((s) => {
        if (!s.comp) return;
        const t = s.comp.tracks.find((t) => t.id === trackId);
        if (!t) return;
        pushClipHistory(s);
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
            // S20 fix-up — only snapshot for Cmd+Z when the patch actually
            // changes a value. `updateClip('b', { trackOffset: 9 })` when
            // trackOffset is already 9 used to push an identical state, so a
            // stray Cmd+Z would appear to do nothing AND the duplicate would
            // evict genuinely-useful older history sooner under the 50-cap.
            // Compare every patched field; if none differs, this is a no-op.
            const rec = c as unknown as Record<string, unknown>;
            const changesSomething = Object.entries(patch).some(
              ([k, v]) => !Object.is(rec[k], v),
            );
            if (!changesSomething) {
              // value-identical patch — apply (harmless) without history.
              Object.assign(c, patch);
              touched = true;
              break;
            }
            // Snapshot the pre-edit tracks ONLY once we know the target exists
            // AND a value really changes, so neither an unknown clipId nor a
            // no-op patch litters the undo stack.
            pushClipHistory(s);
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
        // S20 fix-up — a same-position move (fromIndex === toIndex) changes
        // nothing; pushing history here would snapshot an identical state and
        // make a later Cmd+Z appear to no-op. Bail before the snapshot.
        if (fromIndex === toIndex) return;
        pushClipHistory(s);
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
    // ADR-009 (S8) — the same-kind cross-lane move now lives in the shared
    // composition-ops core (`ops.moveClipToTrack`), consumed identically by the
    // bridge (`autoviral clip move <id> --to-track`). The store action is a thin
    // immer wrapper: snapshot for undo, run the op on the draft (it relocates the
    // clip in place, preserving trackOffset, and prunes any source-track
    // transition the clip anchored), and recompute duration. The op THROWS a
    // typed CompositionOpError on an illegal move (unknown clip / unknown target
    // / cross-kind); here — unlike splitClip's user-facing toast — we keep the
    // historical SILENT no-op contract (an invalid drag just lands nowhere, no
    // toast), so we catch the throw, leave the UI untouched, and never commit
    // the undo snapshot. The op math matches the old inline body, so the existing
    // store moveClipToTrack tests pass without touching a single assertion.
    moveClipToTrack: (clipId, targetTrackId) =>
      set((s) => {
        if (!s.comp) return;
        // S20 discipline — a move that doesn't relocate the clip (target IS the
        // clip's current lane) must not snapshot an identical state (a later
        // Cmd+Z would appear to no-op). The clip already sits on its current
        // lane, so bail before the snapshot when target === source.
        const currentTrackId = s.comp.tracks.find((tr) =>
          (tr.clips as Clip[]).some((c) => c.id === clipId),
        )?.id;
        if (currentTrackId !== undefined && currentTrackId === targetTrackId) {
          return;
        }
        // Snapshot BEFORE mutating so undo restores the pre-move tracks; only
        // commit it to history if the op actually relocates the clip.
        const preTracks = snapshotTracks(s.comp.tracks);
        try {
          ops.moveClipToTrack(s.comp, { clipId, targetTrackId });
        } catch (err) {
          if (err instanceof CompositionOpError) {
            // Silent no-op contract (#88) — an invalid move just doesn't happen.
            return; // UI untouched, history NOT committed.
          }
          throw err;
        }
        // recompute duration — a move can leave a now-empty source lane shorter.
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
        s.clipHistory.past.push(preTracks);
        if (s.clipHistory.past.length > TRACK_HISTORY_LIMIT) {
          s.clipHistory.past.shift();
        }
        s.clipHistory.future = [];
      }),
    // ADR-009 (S9) — transition add now lives in the shared composition-ops core
    // (`ops.addTransition`), consumed identically by the bridge (`autoviral
    // transition add --track --after --preset --duration`). The store action is a
    // thin immer wrapper that preserves the historical `string | null` contract:
    // the op THROWS a typed CompositionOpError on a rejection (unknown track /
    // clip, last-clip anchor, non-video track, unknown preset), so we catch it and
    // return null (the UI's silent-no-op contract — an invalid add just doesn't
    // happen). The op mints the same `tr_<uuid>` id and clamps durationSec to the
    // handle, so the existing store transition tests pass without touching a single
    // assertion. We capture the minted id out of the producer to return it.
    addTransition: (trackId, init) => {
      let mintedId: string | null = null;
      set((s) => {
        if (!s.comp) return;
        try {
          const { transitionId } = ops.addTransition(s.comp, {
            trackId,
            afterClipId: init.afterClipId,
            preset: init.preset,
            durationSec: init.durationSec,
          });
          mintedId = transitionId;
        } catch (err) {
          if (err instanceof CompositionOpError) {
            return; // silent no-op contract — leave the composition untouched.
          }
          throw err;
        }
      });
      return mintedId;
    },
    updateTransition: (trackId, transitionId, patch) =>
      set((s) => {
        if (!s.comp) return;
        const t = s.comp.tracks.find((tt) => tt.id === trackId);
        if (!t || !t.transitions) return;
        const tr = t.transitions.find((x) => x.id === transitionId);
        if (!tr) return;
        // Re-clamp durationSec against current adjacent clip durations so the
        // handle invariant never breaks even if the user trimmed a clip after.
        if (patch.durationSec !== undefined) {
          const beforeIdx = (t.clips as Clip[]).findIndex((c) => c.id === tr.afterClipId);
          if (beforeIdx >= 0 && beforeIdx < t.clips.length - 1) {
            const before = (t.clips as Clip[])[beforeIdx];
            const after = (t.clips as Clip[])[beforeIdx + 1];
            tr.durationSec = clampHandleDuration(
              patch.durationSec,
              clipDuration(before),
              clipDuration(after),
            );
          }
        }
        if (patch.preset !== undefined) tr.preset = patch.preset;
        if (patch.alignment !== undefined) tr.alignment = patch.alignment;
        if (patch.easing !== undefined) tr.easing = patch.easing;
      }),
    // ADR-009 (S9) — transition remove now routes through the shared op
    // (`ops.removeTransition`), consumed identically by the bridge (`autoviral
    // transition remove <id>`). The op finds the transition across any track (so
    // the `trackId` arg is now advisory — kept for the existing call sites + test
    // signatures) and THROWS CompositionOpError when no transition matches; the
    // store keeps the historical silent-no-op contract, so we catch and leave the
    // composition untouched. Existing store tests pass unchanged.
    removeTransition: (_trackId, transitionId) =>
      set((s) => {
        if (!s.comp) return;
        try {
          ops.removeTransition(s.comp, { transitionId });
        } catch (err) {
          if (err instanceof CompositionOpError) {
            return; // silent no-op — unknown id leaves the composition untouched.
          }
          throw err;
        }
      }),
    removeClip: (clipId) =>
      set((s) => {
        if (!s.comp) return;
        // Only snapshot when the clip actually exists, so a stray remove of an
        // unknown id doesn't push an identical state onto the undo stack.
        const exists = s.comp.tracks.some((t) =>
          (t.clips as Clip[]).some((c) => c.id === clipId),
        );
        if (exists) pushClipHistory(s);
        for (const t of s.comp.tracks) {
          t.clips = (t.clips as Clip[]).filter((c) => c.id !== clipId) as typeof t.clips;
          // #54 / S8 — drop transitions the removal just orphaned. TWO conditions
          // (mirrors ops.moveClipToTrack): (a) the transition's anchor clip just
          // vanished, OR (b) removing the clip made a surviving clip the new LAST
          // clip and a transition is pinned to it (a last-clip transition has no
          // successor → Track superRefine rejects the next parse). newLastClipId
          // is read AFTER the clip filter above.
          if (t.transitions?.length) {
            const clips = t.clips as Clip[];
            const newLastClipId = clips[clips.length - 1]?.id;
            t.transitions = t.transitions.filter(
              (tr) =>
                tr.afterClipId !== clipId && tr.afterClipId !== newLastClipId,
            );
          }
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
            // S20 fix-up — ripple-delete is the single most destructive clip
            // edit (removes a clip AND ripples its successors left), yet it was
            // the one clip mutation that never snapshotted for Cmd+Z. Snapshot
            // ONLY once the target is found, so a stray ripple-delete of an
            // unknown id doesn't litter the stack (mirrors removeClip).
            pushClipHistory(s);
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
        const before = s.comp.tracks[idx];
        const collapsed = collapseGapsOnTrack(before) as typeof before;
        // S20 fix-up — collapse-gaps repositions every clip on the track but
        // never snapshotted for Cmd+Z. Only push history when the collapse
        // actually moved a clip (compare offsets pre/post), so collapsing an
        // already-tight track is a true no-op and doesn't pad the undo stack
        // with an identical state (which would evict useful history sooner
        // under the 50-deep cap and let a stray Cmd+Z appear to do nothing).
        const moved =
          before.clips.length !== collapsed.clips.length ||
          before.clips.some(
            (c, i) => c.trackOffset !== collapsed.clips[i]?.trackOffset,
          );
        if (!moved) return;
        pushClipHistory(s);
        s.comp.tracks[idx] = collapsed;
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
          pushClipHistory(s);
          const c = clips[idx] as Clip;
          const start = c.trackOffset;
          const dur = clipDuration(c);
          const end = start + dur;
          if (edge === "right") {
            if (c.kind === "video" || c.kind === "audio") {
              // ADR-009 (S7) — the right-edge resize of a video/audio clip is a
              // source-window trim with trackOffset ANCHORED: it sets `out` and
              // leaves the timeline position put. That is exactly the canonical
              // intent `ops.trimClip` speaks, so route through the shared op
              // (the SAME invariants the agent's `autoviral clip trim --out`
              // runs through the bridge → CLI and Studio edge-drag converge on
              // one composition, ADR-009). The desired source `out` for a
              // timeline clip-end at `newTime` is `in + (newTime - start)`; the
              // op applies the adjacency cap, MIN_CLIP_DUR floor and right-edge
              // keyframe drop itself. The clip is already located (idx >= 0) and
              // is video/audio, so the op never throws here.
              ops.trimClip(s.comp, {
                clipId,
                out: c.in + (newTime - start),
              });
            } else {
              // text / overlay are duration-based (no in/out source window) and
              // have no shared op yet → keep the inline duration clamp. D2 cap
              // at the next clip's start; single-clip tracks → cap = +∞.
              const next = clips
                .filter(
                  (x) =>
                    x.id !== clipId && x.trackOffset > start + OFFSET_EPSILON,
                )
                .sort((x, y) => x.trackOffset - y.trackOffset)[0];
              const cap = next ? next.trackOffset : Infinity;
              const clamped = Math.min(
                cap,
                Math.max(start + MIN_CLIP_DUR, newTime),
              );
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
    // ADR-009 (S6) — the split math + invariants now live in the shared
    // composition-ops core (`ops.splitClip`), consumed identically by the
    // bridge. The store action is a thin immer wrapper: snapshot for undo,
    // call the op on the draft (it mutates `s.comp` in place), and — per
    // ADR-009 decision #4 — SURFACE the op's typed CompositionOpError (unknown
    // id / out-of-clip / boundary) as a user-visible toast rather than swallow
    // it silently. The UI is left untouched (no throw, no partial mutation),
    // but the user now learns why the split landed nowhere. The op math is
    // unchanged from the old inline body, so the existing store splitClip tests
    // pass without touching a single assertion (zero-behaviour-change proof).
    splitClip: (clipId, atSec) =>
      set((s) => {
        if (!s.comp) return;
        // Snapshot BEFORE mutating so undo restores the pre-split tracks; only
        // commit the snapshot to history if the op actually splits.
        const preTracks = snapshotTracks(s.comp.tracks);
        try {
          ops.splitClip(s.comp, { clipId, atSec });
        } catch (err) {
          if (err instanceof CompositionOpError) {
            // ADR-009 #4 — surface, don't swallow. Push a localized headline
            // toast with the op's technical message as the detail line.
            const locale = useLocaleStore.getState().locale;
            useToastStore.getState().push({
              variant: "warn",
              message: MESSAGES[locale].studio.toast.splitFailed,
              detail: err.message,
              ttlMs: 4000,
            });
            return; // UI untouched (no partial split), but the user is told.
          }
          throw err;
        }
        s.clipHistory.past.push(preTracks);
        if (s.clipHistory.past.length > TRACK_HISTORY_LIMIT) {
          s.clipHistory.past.shift();
        }
        s.clipHistory.future = [];
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
          targetTrackId: null,
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
    updateDragTarget: (targetTrackId) =>
      set((s) => {
        if (!s.dragState) return;
        s.dragState.targetTrackId = targetTrackId;
      }),
    commitDrag: () =>
      set((s) => {
        if (!s.comp || !s.dragState) return;
        const draggedId = s.dragState.clipId;
        const targetTrackId = s.dragState.targetTrackId;
        const preview = s.dragState.preview;
        // 1) Apply the horizontal scrub — the ripple preview's candidate
        //    trackOffsets land on every previewed clip (the dragged clip plus
        //    any cascaded same-track neighbours). This writes the dragged
        //    clip's final trackOffset *before* the lane move below, and
        //    moveClipToTrack preserves trackOffset, so the offset survives the
        //    move onto the destination lane.
        for (const t of s.comp.tracks) {
          for (const c of t.clips as Clip[]) {
            const newStart = preview.get(c.id);
            if (newStart !== undefined) c.trackOffset = newStart;
          }
        }
        // 2) #3 / S8 — cross-track move. If the cursor settled over a different
        //    same-kind lane, run the SHARED op so native drag, the Inspector
        //    lane-select action and the CLI/bridge path all consume ONE
        //    implementation (ADR-009 convergence) and inherit the same orphan-
        //    transition prune (anchor AND new-last-clip). The op preserves
        //    trackOffset, so the dragged clip's final offset (written in step 1
        //    above) survives the lane move. An illegal target (cross-kind /
        //    unknown / same lane) throws a typed CompositionOpError, which we
        //    swallow to keep the historical SILENT no-op contract — a stale
        //    targetTrackId just lands nowhere. Only the dragged clip moves lanes;
        //    cascaded neighbours keep their (already-applied) offsets.
        if (targetTrackId) {
          try {
            ops.moveClipToTrack(s.comp, {
              clipId: draggedId,
              targetTrackId,
            });
          } catch (err) {
            if (!(err instanceof CompositionOpError)) throw err;
            // illegal move → no-op (drag lands nowhere on the new lane).
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
      // S10 (ADR-009) — placement math + id mint live in `ops.addTrack`, the
      // SAME implementation the bridge `POST /track` runs, so an agent adding a
      // lane via the CLI and a human clicking "+ lane" converge. The store only
      // owns the trackHistory snapshot (the bridge has no undo stack). We mint
      // the id INSIDE the op; capture it in an outer `let` so the return value
      // survives the immer transaction.
      let id = "";
      set((s) => {
        if (!s.comp) return;
        // Snapshot before mutating — even no-op-on-load paths skipped above
        // mean we never push useless history entries.
        pushHistory(s);
        ({ trackId: id } = ops.addTrack(s.comp, { kind, opts }));
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
        if (!s.comp.tracks.some((t) => t.id === id)) return;
        pushHistory(s);
        // S10 (ADR-009) — the unconditional splice + displayOrder recompact is
        // `ops.removeTrack`, the SAME implementation the bridge `DELETE
        // /track/:id` runs. The two-step has-clips confirm gate stays here in
        // the store (the bridge has no confirm step). The id is known-present
        // (we just checked), so the op can't throw on this path.
        ops.removeTrack(s.comp, { trackId: id });
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
    // ─── S20 (US 32) — clip-op undo / redo ────────────────────────────────
    // Symmetrical with undo/redoTrackOp but reads from clipHistory. Restoring
    // tracks can change the timeline length (split adds, removeClip shortens),
    // so both directions re-derive comp.duration from the restored clips —
    // unlike the track-op pair, where lane ops never touch clip timing.
    undoClipOp: () =>
      set((s) => {
        if (!s.comp) return;
        const prev = s.clipHistory.past.pop();
        if (!prev) return; // empty stack — nothing to undo
        s.clipHistory.future.push(snapshotTracks(s.comp.tracks));
        s.comp.tracks = prev as typeof s.comp.tracks;
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
        reconcileSelection(s);
      }),
    redoClipOp: () =>
      set((s) => {
        if (!s.comp) return;
        const next = s.clipHistory.future.pop();
        if (!next) return;
        s.clipHistory.past.push(snapshotTracks(s.comp.tracks));
        s.comp.tracks = next as typeof s.comp.tracks;
        s.comp.duration = Math.max(
          0,
          ...s.comp.tracks.flatMap((t) => (t.clips as Clip[]).map(clipEnd)),
        );
        reconcileSelection(s);
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

// S20 (US 32) — clip-op counterpart of pushHistory. Same snapshot-before +
// bounded-stack + clear-redo-branch contract, against clipHistory. A fresh
// clip op always invalidates the clip redo branch (standard editor semantics).
function pushClipHistory(s: {
  comp: Composition | null;
  clipHistory: ClipHistory;
}) {
  if (!s.comp) return;
  s.clipHistory.past.push(snapshotTracks(s.comp.tracks));
  if (s.clipHistory.past.length > TRACK_HISTORY_LIMIT) {
    s.clipHistory.past.shift();
  }
  s.clipHistory.future = [];
}

// S20 fix-up — after a clip-op undo/redo restores `tracks`, the current
// `selection` may point at a clip id that no longer exists in the restored
// tracks (undoing an addClip whose new clip is selected, or redoing a
// removeClip). A dangling selection makes the Inspector / handles read a clip
// that isn't there. Drop it to null when it no longer resolves; leave a valid
// selection untouched.
function reconcileSelection(s: { comp: Composition | null; selection: string | null }) {
  if (!s.comp || s.selection == null) return;
  const stillExists = s.comp.tracks.some((t) =>
    (t.clips as Clip[]).some((c) => c.id === s.selection),
  );
  if (!stillExists) s.selection = null;
}
