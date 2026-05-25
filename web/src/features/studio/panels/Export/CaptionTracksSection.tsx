// Phase H (issue #35) — Caption Tracks export section.
//
// Lists every `kind: "text"` lane in the current composition, with two
// per-row checkboxes:
//   • Burn    — bake this lane into the video (Remotion <Text>)
//   • Sidecar — emit `<output>.<language>.srt` next to the rendered mp4
//
// Constraints:
//   • At most one Burn checkbox can be on at a time (radio-like).
//     Hovering a disabled-by-constraint Burn checkbox surfaces a tooltip
//     explaining why.
//   • Both off is allowed for any row — the lane is skipped at export.
//   • Defaults: first text track Burn=on, every other track Sidecar=on.
//
// Pure presentational + controlled-input shape: the parent owns the
// selection state (so it can fold into the render request body) and the
// component just renders + dispatches change events. This keeps the
// rendering / wiring boundary explicit and the test surface small.

import { useMemo } from "react";
import styles from "./CaptionTracksSection.module.css";

export interface CaptionTrackOption {
  id: string;
  label: string;
  /** Optional ISO 639-1 (or anything; we just display it). When missing,
   *  rendered as the dimmer "und" pill matching the server fallback. */
  language?: string;
}

export interface CaptionSelection {
  /** Id of the lane the user wants burned into the video. `null` =
   *  no track is burned (everything that's checked is sidecar). */
  burnTrackId: string | null;
  /** Ids of the lanes flagged for sidecar SRT emission. */
  sidecarTrackIds: string[];
}

export interface CaptionTracksSectionProps {
  tracks: CaptionTrackOption[];
  selection: CaptionSelection;
  onSelectionChange: (next: CaptionSelection) => void;
}

const BURN_DISABLED_TOOLTIP =
  "Only one track can be burned in at export";

/** Pure helper exposed for tests — derives the default selection
 *  (first track burned, rest sidecar) from a list of text tracks. */
export function defaultCaptionSelection(
  tracks: CaptionTrackOption[],
): CaptionSelection {
  if (tracks.length === 0) {
    return { burnTrackId: null, sidecarTrackIds: [] };
  }
  const [first, ...rest] = tracks;
  return {
    burnTrackId: first.id,
    sidecarTrackIds: rest.map((t) => t.id),
  };
}

export function CaptionTracksSection({
  tracks,
  selection,
  onSelectionChange,
}: CaptionTracksSectionProps) {
  const sidecarSet = useMemo(
    () => new Set(selection.sidecarTrackIds),
    [selection.sidecarTrackIds],
  );

  function toggleBurn(trackId: string, next: boolean) {
    if (next) {
      // Radio-like: setting one Burn auto-unchecks the previously-burned
      // lane. We also strip the newly-burned lane from sidecar (a single
      // track shouldn't be in both columns at once — Resolve's UI hides
      // the sidecar column for the burned lane).
      onSelectionChange({
        burnTrackId: trackId,
        sidecarTrackIds: selection.sidecarTrackIds.filter(
          (id) => id !== trackId,
        ),
      });
    } else if (selection.burnTrackId === trackId) {
      onSelectionChange({ ...selection, burnTrackId: null });
    }
  }

  function toggleSidecar(trackId: string, next: boolean) {
    const without = selection.sidecarTrackIds.filter((id) => id !== trackId);
    onSelectionChange({
      // If user is sidecar'ing the lane that was burned, clear the burn.
      burnTrackId:
        next && selection.burnTrackId === trackId
          ? null
          : selection.burnTrackId,
      sidecarTrackIds: next ? [...without, trackId] : without,
    });
  }

  if (tracks.length === 0) {
    return (
      <section className={styles.root} aria-labelledby="captions-section-title">
        <header className={styles.header}>
          <h3 id="captions-section-title" className={styles.title}>
            Caption tracks
          </h3>
          <span className={styles.eyebrow}>RESOLVE MODEL</span>
        </header>
        <p className={styles.empty}>
          No text tracks in this composition. Add a caption lane to control
          burn/sidecar at export.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="captions-section-title">
      <header className={styles.header}>
        <h3 id="captions-section-title" className={styles.title}>
          Caption tracks
        </h3>
        <span className={styles.eyebrow}>RESOLVE MODEL</span>
      </header>
      <p className={styles.intro}>
        Choose which lane bakes into the video and which write a sidecar
        SRT next to the export. Both off skips the track entirely.
      </p>
      <div className={styles.grid} role="table" aria-label="Caption tracks">
        <div className={styles.gridHead} role="columnheader">
          Track
        </div>
        <div className={styles.gridHeadRight} role="columnheader">
          Burn
        </div>
        <div className={styles.gridHeadRight} role="columnheader">
          Sidecar
        </div>
        {tracks.map((track) => {
          const isBurned = selection.burnTrackId === track.id;
          const isSidecar = sidecarSet.has(track.id);
          const burnDisabled =
            !isBurned && selection.burnTrackId !== null;
          const lang = (track.language ?? "").trim();
          return (
            <div className={styles.row} role="row" key={track.id}>
              <div className={styles.rowLabel} role="cell">
                <span className={styles.rowTitle} title={track.label}>
                  {track.label}
                </span>
                <span
                  className={lang ? styles.langTag : styles.langTagUnd}
                  aria-label={
                    lang ? `Language ${lang}` : "Language undetermined"
                  }
                >
                  {lang || "und"}
                </span>
              </div>
              <div className={styles.cell} role="cell">
                <span className={styles.checkboxWrap}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={isBurned}
                    disabled={burnDisabled}
                    aria-label={`Burn ${track.label} into video`}
                    data-testid={`burn-${track.id}`}
                    onChange={(e) => toggleBurn(track.id, e.target.checked)}
                  />
                  {burnDisabled ? (
                    <span
                      className={`${styles.tooltip} ${styles.tooltipOnHover}`}
                      role="tooltip"
                    >
                      {BURN_DISABLED_TOOLTIP}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className={styles.cell} role="cell">
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={isSidecar}
                  aria-label={`Sidecar ${track.label} as SRT`}
                  data-testid={`sidecar-${track.id}`}
                  onChange={(e) => toggleSidecar(track.id, e.target.checked)}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className={styles.footnote}>
        Sidecar files land as <code>&lt;output&gt;.{"<lang>"}.srt</code>{" "}
        beside the mp4 (YouTube/FCP convention).
      </p>
    </section>
  );
}
