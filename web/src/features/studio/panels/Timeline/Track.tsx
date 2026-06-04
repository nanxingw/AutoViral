import { useState, type ReactElement } from "react";
import { Clip } from "./Clip";
import { Filmstrip } from "./Filmstrip";
import { WaveformBars } from "./WaveformBars";
import { useComposition } from "../../store";
import { clipDuration } from "@autoviral/timeline";
import { buildClipFromAsset } from "../AssetSidebar/addAssetToTimeline";
import {
  readDragPayload,
  canAcceptDrop,
  dropTimeFromPointer,
  resolveDropTime,
  resolveDrop,
} from "./dnd";
import { useT } from "@/i18n/useT";
import type { AssetItem } from "@/queries/assets";
import type { Track as TrackType } from "../../types";

interface Props {
  track: TrackType;
  pxPerSecond: number;
  totalWidth: number;
  color: string;
  label: string;
  /** When true, skip the built-in sticky label cell — caller is rendering
   *  its own header (e.g. TimelineTrackHeader from #33). Default false to
   *  preserve the legacy single-component behaviour exercised by tests. */
  hideLabel?: boolean;
}

// I19/I20 — live state of a drag hovering this track's lane. `start` is the
// snapped drop time (drives the indicator line); `legal` drives accept-vs-reject
// styling. null = no drag over this lane.
interface DropPreview {
  start: number;
  legal: boolean;
}

const KIND_ICON: Record<string, ReactElement> = {
  video: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M22 8l-6 4 6 4V8z" />
    </svg>
  ),
  audio: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  text: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  overlay: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
};

export function Track({ track, pxPerSecond, totalWidth, color, label, hideLabel = false }: Props) {
  const t = useT();
  const compact = track.kind === "text";
  // R47-fix4: text track was 36px → clip body 16px after padding, but the
  // rendered content (duration sub-label + actual text) needs ~30px and
  // overflow:hidden cropped the second line. 44px gives the clip a 24px
  // body which fits the dropped-duration-sublabel layout from Clip.tsx.
  const height = compact ? 44 : 56;

  // ── I19/I20 — this lane is a native-DnD drop target ──────────────────────
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);

  // Read the dragged payload, compute the snapped drop time, and update the
  // hover preview. Shared by dragenter/dragover so the indicator tracks the
  // cursor. Returns whether the drop is legal (drives dropEffect).
  const updateHover = (e: React.DragEvent): boolean => {
    const payload = readDragPayload(e.dataTransfer);
    // Not a timeline drag (e.g. a file drop) — let it pass through untouched.
    if (!payload) return false;
    const legal = canAcceptDrop(payload, track.kind);
    const laneLeft = e.currentTarget.getBoundingClientRect().left + 6; // +6 lane padding
    const rawTime = dropTimeFromPointer(e.clientX, laneLeft, pxPerSecond);
    const store = useComposition.getState();
    const comp = store.comp;
    const fps = comp?.fps || 30;
    const playhead = store.currentFrame / fps;
    // Snap; for an asset use the default placeholder length, for a clip its real
    // duration (so the end-edge snaps too). Exclude a clip from its own edges.
    let dur = 5;
    let excludeId: string | null = null;
    if (payload.source === "clip") {
      const dragged = comp?.tracks
        .flatMap((tr) => tr.clips)
        .find((c) => c.id === payload.clipId);
      if (dragged) dur = clipDuration(dragged);
      excludeId = payload.clipId;
    }
    const { start } = resolveDropTime(comp, rawTime, dur, playhead, excludeId);
    setDropPreview({ start, legal });
    return legal;
  };

  const onDragOver = (e: React.DragEvent) => {
    const payload = readDragPayload(e.dataTransfer);
    if (!payload) return; // file drop / foreign drag — don't intercept
    // preventDefault is REQUIRED for the drop event to fire at all.
    e.preventDefault();
    const legal = updateHover(e);
    e.dataTransfer.dropEffect = legal ? (payload.source === "clip" ? "move" : "copy") : "none";
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Ignore leave events bubbling from child clips — only clear when the
    // cursor truly exits the lane (relatedTarget outside currentTarget).
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setDropPreview(null);
  };

  const onDrop = (e: React.DragEvent) => {
    const payload = readDragPayload(e.dataTransfer);
    if (!payload) return; // not ours
    e.preventDefault();
    setDropPreview(null);
    const store = useComposition.getState();
    const comp = store.comp;
    if (!comp) return;
    const laneLeft = e.currentTarget.getBoundingClientRect().left + 6;
    const rawTime = dropTimeFromPointer(e.clientX, laneLeft, pxPerSecond);
    const fps = comp.fps || 30;
    const playhead = store.currentFrame / fps;
    let dur = 5;
    let excludeId: string | null = null;
    let sourceTrackId: string | null = null;
    if (payload.source === "clip") {
      for (const tr of comp.tracks) {
        const found = tr.clips.find((c) => c.id === payload.clipId);
        if (found) {
          dur = clipDuration(found);
          sourceTrackId = tr.id;
          break;
        }
      }
      excludeId = payload.clipId;
    }
    const { start } = resolveDropTime(comp, rawTime, dur, playhead, excludeId);
    const intent = resolveDrop(payload, { id: track.id, kind: track.kind }, start, sourceTrackId);
    if (intent.type === "add-asset") {
      // buildClipFromAsset only reads kind + path — reconstruct a minimal asset.
      const asset = { kind: intent.assetKind, path: intent.assetPath } as AssetItem;
      const clip = buildClipFromAsset(asset, intent.start);
      if (clip) {
        store.addClip(intent.trackId, clip);
        store.setSelection(clip.id);
      }
    } else if (intent.type === "move-clip") {
      store.moveClipToTrack(intent.clipId, intent.targetTrackId);
    }
    // reject → no store mutation; the cue already showed during hover.
  };

  return (
    <div
      data-kind={track.kind}
      style={{
        display: "flex",
        borderBottom: "1px solid var(--divider)",
        minHeight: height,
      }}
    >
      {/* Label column (sticky-ish). Skipped when TimelineTrackHeader is
          rendering the label upstream (Phase F, issue #33) so the two don't
          visually overlap — see Timeline/index.tsx wiring. */}
      {!hideLabel && (
        <div
          style={{
            width: 152,
            flexShrink: 0,
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderRight: "1px solid var(--divider)",
            background: "var(--surface-0)",
            position: "sticky",
            left: 0,
            zIndex: 3,
          }}
        >
          <span style={{ color, display: "grid", placeItems: "center" }}>
            {KIND_ICON[track.kind] ?? KIND_ICON.video}
          </span>
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-dim)" }}>
            {label}
          </span>
        </div>
      )}

      {/* Clip lane — also the I19/I20 drop target. */}
      <div
        data-testid={`track-lane-${track.kind}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          flex: 1,
          padding: 6,
          position: "relative",
          minWidth: totalWidth,
          height,
          // Reject cue: a not-allowed cursor over an illegal target lane.
          cursor: dropPreview && !dropPreview.legal ? "not-allowed" : undefined,
        }}
      >
        {/* I19/I20 — drop indicator line at the snapped start. Accent when the
            drop is legal, red when the lane rejects the dragged kind. */}
        {dropPreview && (
          <>
            <div
              data-testid="drop-indicator"
              data-legal={dropPreview.legal}
              aria-hidden
              style={{
                position: "absolute",
                left: dropPreview.start * pxPerSecond,
                top: 0,
                bottom: 0,
                width: 2,
                background: dropPreview.legal
                  ? "var(--accent-hi)"
                  : "var(--status-error, #d4756c)",
                boxShadow: dropPreview.legal
                  ? "0 0 8px var(--accent-hi)"
                  : "0 0 8px rgba(212,117,108,0.7)",
                pointerEvents: "none",
                zIndex: 7,
              }}
            />
            {/* I19/I20 — the localized accept/reject TEXT pinned to the
                indicator. The colored line alone never told the user *why* a
                drop was refused; this label makes the reject cue explicit.
                aria-live announces the same text to screen readers. */}
            <div
              data-testid="drop-label"
              role="status"
              aria-live="polite"
              style={{
                position: "absolute",
                left: dropPreview.start * pxPerSecond + 6,
                top: 4,
                maxWidth: totalWidth,
                padding: "2px 6px",
                borderRadius: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 8,
                color: dropPreview.legal ? "var(--accent-hi)" : "#fff",
                background: dropPreview.legal
                  ? "var(--surface-0)"
                  : "var(--status-error, #d4756c)",
                border: `1px solid ${
                  dropPreview.legal
                    ? "var(--accent-hi)"
                    : "var(--status-error, #d4756c)"
                }`,
              }}
            >
              {dropPreview.legal
                ? t("studio.timeline.dnd.dropHere")
                : t("studio.timeline.dnd.dropRejected")}
            </div>
          </>
        )}
        {/* Phase 4.D — filmstrip overlays render BENEATH the clip overlay
            (rendered first so the Clip header/handles z-index above them). */}
        {track.kind === "video" &&
          track.clips.map((c) =>
            c.kind === "video" ? (
              <div
                key={`fs-${c.id}`}
                style={{
                  position: "absolute",
                  left: c.trackOffset * pxPerSecond,
                  top: 4,
                  height: height - 8,
                  pointerEvents: "none",
                }}
              >
                <Filmstrip
                  clip={c}
                  pxPerSecond={pxPerSecond}
                  height={height - 8}
                />
              </div>
            ) : null,
          )}
        {/* Phase 4.E — waveform overlays beneath audio clips. Same
            mounting pattern as the filmstrip overlay above. */}
        {track.kind === "audio" &&
          track.clips.map((c) =>
            c.kind === "audio" ? (
              <div
                key={`wf-${c.id}`}
                style={{
                  position: "absolute",
                  left: c.trackOffset * pxPerSecond,
                  top: 4,
                  height: height - 8,
                  pointerEvents: "none",
                }}
              >
                <WaveformBars
                  clip={c}
                  pxPerSecond={pxPerSecond}
                  height={height - 8}
                />
              </div>
            ) : null,
          )}
        {track.clips.map((c) => (
          <Clip
            key={c.id}
            clipId={c.id}
            pxPerSecond={pxPerSecond}
            trackKind={track.kind}
            color={color}
          />
        ))}
      </div>
    </div>
  );
}
