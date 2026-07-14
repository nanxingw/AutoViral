// ADR-009 (PRD-0014 S7) — `setTrackProps`: partial-update a track's editable
// props (label / language / volume(dB) / muted / hidden). Lifted into the shared
// composition-ops core so the studio store's per-affordance lane actions
// (renameTrack / setTrackLanguage / setTrackVolume) and the bridge/CLI (`autoviral
// track set <id> --label/--language/--volume/--muted`) converge on one writer.
//
// Decision #1/#2 (ADR-009): mutate the EXISTING track object IN PLACE (never
// replace it — breaks the immer draft proxy). No fs / http and no
// CompositionSchema.parse.
//
// Spread-guard (#81/#86 lesson): ONLY the keys present in `props` are written;
// every sibling field on the track is left byte-for-byte untouched. `language`
// is the one optional field — a null/undefined value DELETES it (so `track set
// --language ""` / a UI "clear language" round-trips to "no language"), rather
// than storing an `undefined` that a strict write schema would then reject.
//
// This op is intentionally kind-agnostic (the Track schema permits label /
// language / volume / muted / hidden on every kind; volume is only *consumed*
// for audio, a safe no-op elsewhere). The store keeps its friendly per-kind
// affordance guards (language on text lanes, volume on audio lanes) as a UI-level
// concern; the op is the pure data mutation both paths share.

import type { Composition, Track } from "../../composition.js";
import { CompositionOpError } from "./errors.js";

export interface TrackProps {
  label?: string;
  language?: string | null;
  volume?: number;
  muted?: boolean;
  hidden?: boolean;
}

const SCALAR_KEYS = ["label", "volume", "muted", "hidden"] as const;

/**
 * Partial-update the track `trackId` from `props`. Only supplied keys are
 * touched. `language: null | undefined` clears the field. Returns nothing —
 * callers read the mutated track.
 *
 * Throws `CompositionOpError{code:4}` when no track matches `trackId`.
 */
export function setTrackProps(
  comp: Composition,
  p: { trackId: string; props: TrackProps },
): void {
  const track = comp.tracks.find((t) => t.id === p.trackId);
  if (!track) {
    throw new CompositionOpError(
      `setTrackProps: no track with id ${p.trackId}`,
      4,
    );
  }
  const { props } = p;
  const rec = track as unknown as Record<string, unknown>;

  // `language` — presence-checked (an explicit `{ language: undefined }` still
  // means "clear it"), so we branch on the KEY being present, not the value.
  if ("language" in props) {
    if (props.language == null) {
      delete (track as { language?: string }).language;
    } else {
      (track as Track).language = props.language;
    }
  }

  for (const key of SCALAR_KEYS) {
    if (key in props && props[key] !== undefined) {
      rec[key] = props[key];
    }
  }
}
