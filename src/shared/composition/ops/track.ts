// ADR-009 (S10) — `addTrack` / `removeTrack`: lane add + remove lifted into the
// shared composition-ops core. The studio store's lane actions (Timeline track
// header "+ lane" / removeTrack) and the bridge read-modify-write path
// (`POST /track`, `DELETE /track/:id`) consume THESE implementations, so an
// agent adding an A2 lane via the CLI (`autoviral track add --kind audio`) and
// a human clicking "+ lane" in the UI converge on the same composition.
//
// Decision #1/#2 (ADR-009): mutate `comp` IN PLACE — never replace `comp`,
// `comp.tracks`, or `comp.tracks[i]` with a fresh object (that breaks the immer
// draft proxy on the store side). We push/splice the EXISTING `comp.tracks`
// array so it keeps its identity. No fs / http here, and no
// CompositionSchema.parse (the bridge chokepoint validates on write; the store
// validates at its existing moments). Illegal params throw
// CompositionOpError{code:4}.
//
// History (trackHistory.past snapshot) is the STORE's responsibility, not the
// op's — the op is the pure composition mutation; the store wraps it with
// `pushHistory`. Keeping history out of the op means the bridge path (which has
// no undo stack) reuses the exact same placement math.

import { newTrackId, type Composition, type Track } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

// Recompact displayOrder so the array sorted by displayOrder is contiguous
// 0..N-1. Mirrors the store's `recompactDisplayOrder` (single source of truth
// for the invariant lives here now). Sort a shallow copy, then assign fresh
// indices in place onto the EXISTING track objects (ties resolve by current
// array position via the stable sort).
function recompactDisplayOrder(tracks: Track[]): void {
  const sorted = [...tracks].sort((a, b) => a.displayOrder - b.displayOrder);
  sorted.forEach((t, i) => {
    t.displayOrder = i;
  });
}

export interface AddTrackOpts {
  afterTrackId?: string;
  language?: string;
  label?: string;
}

/**
 * Add a new lane of `kind` to `comp`. Mints a fresh `trk_` id, auto-labels it
 * `<LETTER><N>` (audio→A2, video→V2, text→CC2, overlay→O1) unless `opts.label`
 * overrides, and places it:
 *  - directly after `opts.afterTrackId` when given (anchor.displayOrder + 1,
 *    shifting everything ≥ that down by one); or
 *  - at the END of the same-kind block by default (a new audio lane lands after
 *    the last existing audio lane, never inside the video block); or
 *  - at the tail of all tracks when no lane of `kind` exists yet.
 *
 * Returns the minted `trackId` so callers (UI, CLI, tests) can immediately
 * reference the new lane. Recompacts displayOrder so the contiguous-0..N-1
 * invariant holds after the add.
 */
export function addTrack(
  comp: Composition,
  p: { kind: Track["kind"]; opts?: AddTrackOpts },
): { trackId: string } {
  const { kind, opts } = p;
  const id = newTrackId();

  // Default label: `<KIND><N>` where N is the current count of that kind + 1
  // (1-indexed for human friendliness). Caller can override via opts.label.
  const sameKindCount = comp.tracks.filter((t) => t.kind === kind).length;
  const kindLetter =
    kind === "video" ? "V" :
    kind === "audio" ? "A" :
    kind === "text" ? "CC" :
    "O";
  const label = opts?.label ?? `${kindLetter}${sameKindCount + 1}`;

  // Decide insertion displayOrder. Two paths (mirrors the store action):
  //  1. afterTrackId — insert immediately after that anchor.
  //  2. default — insert at the end of the same-kind block; fall through to
  //     "tail of all tracks" when no lane of `kind` exists yet.
  let insertOrder: number;
  if (opts?.afterTrackId) {
    const anchor = comp.tracks.find((t) => t.id === opts.afterTrackId);
    if (!anchor) {
      // Anchor vanished — degrade to tail-of-kind placement rather than throw;
      // the caller is presumably out of date.
      const sameKind = comp.tracks.filter((t) => t.kind === kind);
      insertOrder = sameKind.length
        ? Math.max(...sameKind.map((t) => t.displayOrder)) + 1
        : comp.tracks.length;
    } else {
      insertOrder = anchor.displayOrder + 1;
    }
  } else {
    const sameKind = comp.tracks.filter((t) => t.kind === kind);
    insertOrder = sameKind.length
      ? Math.max(...sameKind.map((t) => t.displayOrder)) + 1
      : comp.tracks.length;
  }

  // Shift any existing track with displayOrder ≥ insertOrder down by one so the
  // new lane can take that slot.
  for (const t of comp.tracks) {
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
    transitions: [], // #54 — TrackSchema.transitions default [], required on output type
    ...(opts?.language ? { language: opts.language } : {}),
  };
  // Push onto the EXISTING tracks array — keep its identity (decision #1).
  comp.tracks.push(newTrack);
  // Belt-and-suspenders: guarantee the contiguous 0..N-1 invariant survives any
  // future refactor of the shift logic above.
  recompactDisplayOrder(comp.tracks);

  return { trackId: id };
}

/**
 * Remove the lane `trackId` from `comp` and recompact displayOrder. The
 * lane's clips disappear with it (orphaning is the caller's concern — the
 * store's two-step has-clips confirm gate lives in the store; this op is the
 * unconditional removal once that gate has passed). We `splice` the EXISTING
 * `comp.tracks` array so it keeps its identity (decision #1).
 *
 * Throws `CompositionOpError{code:4}` when no track matches `trackId`.
 */
export function removeTrack(
  comp: Composition,
  p: { trackId: string },
): void {
  const idx = comp.tracks.findIndex((t) => t.id === p.trackId);
  if (idx < 0) {
    throw new CompositionOpError(
      `removeTrack: no track with id ${p.trackId}`,
      4,
    );
  }
  comp.tracks.splice(idx, 1);
  recompactDisplayOrder(comp.tracks);
}
