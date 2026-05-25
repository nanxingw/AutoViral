import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useComposition } from "../../store";
import type { Track } from "../../types";
import { useT } from "@/i18n/useT";
import styles from "./LaneGapAdd.module.css";

/* ─── Phase F (issue #33) — lane-gap hover-plus button ────────────────────
   24x24 "+" button living in the 4px gap between two adjacent lane rows.

   Dwell timer (150ms) is the load-bearing detail: a CSS transition-delay
   can't be cancelled mid-flight, so when the user scrolls / sweeps the
   cursor past a gap the button still appears 150ms later. We use a
   useRef<number | null> setTimeout that clears on mouseleave — the timer
   actually disarms.

   Same-kind gap → click inserts directly (no picker). Heterogeneous gap
   → click opens a tiny kind picker centred on the button; the picker is
   the same glass-card visual language as the header menu. */

const DWELL_MS = 150;

const KIND_ORDER: Track["kind"][] = ["video", "audio", "text", "overlay"];

interface Props {
  /** Track immediately above this gap. Undefined when no upper neighbour. */
  upperTrackId?: string;
  /** Track immediately below this gap. Undefined when no lower neighbour. */
  lowerTrackId?: string;
}

export function LaneGapAdd({ upperTrackId, lowerTrackId }: Props) {
  const t = useT();
  const addTrack = useComposition((s) => s.addTrack);
  // Read both tracks fresh — kind comparison drives same vs. heterogeneous.
  const upper = useComposition((s) =>
    upperTrackId ? s.comp?.tracks.find((x) => x.id === upperTrackId) : null,
  );
  const lower = useComposition((s) =>
    lowerTrackId ? s.comp?.tracks.find((x) => x.id === lowerTrackId) : null,
  );

  const [visible, setVisible] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);

  const dwellTimer = useRef<number | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ── dwell timer machinery ──────────────────────────────────────────────
  const armDwell = useCallback(() => {
    if (dwellTimer.current != null) return; // already armed
    dwellTimer.current = window.setTimeout(() => {
      setVisible(true);
      dwellTimer.current = null;
    }, DWELL_MS);
  }, []);

  const disarmDwell = useCallback(() => {
    if (dwellTimer.current != null) {
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
    // Only hide if the picker isn't open — keep the affordance up so the
    // user can navigate from button → picker without losing their target.
    if (!pickerPos) setVisible(false);
  }, [pickerPos]);

  useEffect(() => {
    return () => {
      if (dwellTimer.current != null) window.clearTimeout(dwellTimer.current);
    };
  }, []);

  // ── click-outside / Escape for the kind picker ─────────────────────────
  useEffect(() => {
    if (!pickerPos) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerPos(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (pickerRef.current && pickerRef.current.contains(e.target as Node)) return;
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      setPickerPos(null);
      setVisible(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [pickerPos]);

  // ── click handler ──────────────────────────────────────────────────────
  const handleClick = useCallback(() => {
    // Same-kind gap → straight insert.
    if (upper && lower && upper.kind === lower.kind) {
      addTrack(upper.kind, { afterTrackId: upper.id });
      setVisible(false);
      return;
    }
    // Single neighbour (top gap above tracks[0], or bottom gap below last)
    // → just clone the existing neighbour's kind.
    if (upper && !lower) {
      addTrack(upper.kind, { afterTrackId: upper.id });
      setVisible(false);
      return;
    }
    if (lower && !upper) {
      // No anchor — addTrack falls through to tail-of-kind which lands the
      // new lane at the same-kind block tail. For a top-of-stack new-row
      // request that's an acceptable approximation.
      addTrack(lower.kind);
      setVisible(false);
      return;
    }
    // Heterogeneous gap → open kind picker.
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPickerPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [addTrack, upper, lower]);

  const handlePickKind = useCallback((kind: Track["kind"]) => {
    // Anchor on upper if it exists; otherwise insert at tail of kind.
    if (upper) {
      addTrack(kind, { afterTrackId: upper.id });
    } else {
      addTrack(kind);
    }
    setPickerPos(null);
    setVisible(false);
  }, [addTrack, upper]);

  const btnStyle: CSSProperties | undefined = undefined;
  const pickerStyle: CSSProperties | undefined = pickerPos
    ? { top: pickerPos.top, left: pickerPos.left }
    : undefined;

  return (
    <>
      <div
        ref={rootRef}
        className={styles.gap}
        onMouseEnter={armDwell}
        onMouseLeave={disarmDwell}
        data-testid="lane-gap"
        data-upper={upperTrackId ?? ""}
        data-lower={lowerTrackId ?? ""}
      >
        <button
          ref={btnRef}
          type="button"
          className={`${styles.btn}${visible ? ` ${styles.btnVisible}` : ""}`}
          style={btnStyle}
          aria-label={t("studio.timeline.trackHeader.addLaneAria")}
          data-visible={visible ? "true" : "false"}
          data-testid="lane-gap-btn"
          tabIndex={visible ? 0 : -1}
          onClick={handleClick}
          onFocus={() => setVisible(true)}
          onBlur={() => {
            if (!pickerPos) setVisible(false);
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {pickerPos && createPortal(
        <div
          ref={pickerRef}
          className={styles.picker}
          style={pickerStyle}
          role="menu"
          aria-label={t("studio.timeline.trackHeader.pickKindTitle")}
        >
          <div className={styles.pickerHeading}>
            {t("studio.timeline.trackHeader.pickKindTitle")}
          </div>
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className={styles.pickerItem}
              data-kind={kind}
              onClick={() => handlePickKind(kind)}
            >
              {kind === "video" && t("studio.timeline.trackHeader.pickKindVideo")}
              {kind === "audio" && t("studio.timeline.trackHeader.pickKindAudio")}
              {kind === "text" && t("studio.timeline.trackHeader.pickKindText")}
              {kind === "overlay" && t("studio.timeline.trackHeader.pickKindOverlay")}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
