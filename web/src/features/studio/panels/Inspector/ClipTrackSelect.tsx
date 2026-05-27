import { useMemo } from "react";
import { useComposition } from "../../store";
import { useT } from "@/i18n/useT";
import type { Clip, Track } from "../../types";

/**
 * #88 — move the selected clip to another lane of the SAME kind. The pointer
 * drag engine only changes a clip's time (trackOffset), never its track, and
 * clips had no context menu — so a clip was permanently pinned to its birth
 * lane and an empty A2 lane could never be filled. This is the reliable,
 * always-available path (the issue's "兜底" option 3); a full vertical-drag
 * implementation can layer on later.
 *
 * Hidden when nothing is selected or there's only one track of the clip's kind
 * (no destination to move to).
 */
export function ClipTrackSelect() {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const moveClipToTrack = useComposition((s) => s.moveClipToTrack);
  const t = useT();

  const { currentTrackId, sameKindTracks } = useMemo<{
    currentTrackId: string | null;
    sameKindTracks: Track[];
  }>(() => {
    if (!comp || !selection) return { currentTrackId: null, sameKindTracks: [] };
    for (const tr of comp.tracks) {
      if ((tr.clips as Clip[]).some((c) => c.id === selection)) {
        return {
          currentTrackId: tr.id,
          sameKindTracks: comp.tracks.filter((x) => x.kind === tr.kind),
        };
      }
    }
    return { currentTrackId: null, sameKindTracks: [] };
  }, [comp, selection]);

  if (!currentTrackId || sameKindTracks.length < 2 || !selection) return null;

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-dimmer)",
        }}
      >
        {t("studio.inspector.clipTrack")}
      </span>
      <select
        aria-label={t("studio.inspector.clipTrack")}
        value={currentTrackId}
        onChange={(e) => moveClipToTrack(selection, e.target.value)}
        style={{
          width: "100%",
          padding: 6,
          border: "1px solid var(--glass-border)",
          borderRadius: 4,
          background: "var(--surface-0)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        {sameKindTracks.map((tr) => (
          <option key={tr.id} value={tr.id}>
            {tr.label}
          </option>
        ))}
      </select>
    </label>
  );
}
