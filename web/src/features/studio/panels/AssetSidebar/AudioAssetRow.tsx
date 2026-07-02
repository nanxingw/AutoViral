// A6 (PRD-0010) — AudioAssetRow: compact ~52px horizontal row for the AUDIO
// group. Replaces the one-size-fits-all 9:16 card with a waveform-forward
// strip: play/pause (single-instance audition) + mini waveform (shared
// PeaksSvg, same useWaveform peaks cache the timeline uses) + mono duration +
// filename. The existing ＋ / delete / drag affordances are preserved verbatim.
import { useMemo } from "react";
import type { AssetItem } from "@/queries/assets";
import { useT } from "@/i18n/useT";
import { useWaveform } from "../../hooks/useWaveform";
import { useAudioAudition } from "../../hooks/useAudioAudition";
import { PeaksSvg } from "../Timeline/PeaksSvg";
import { writeDragPayload } from "../Timeline/dnd";

interface Props {
  item: AssetItem;
  index: number;
  onOpen: () => void;
  // #78 — append this asset to the timeline (kept from the card).
  onAdd?: () => void;
  addLabel?: string;
  // I18 — open the delete confirm (kept from the card).
  onDelete?: () => void;
  deleteLabel?: string;
}

const WAVEFORM_W = 108;
const WAVEFORM_H = 26;
// Cap the row's bar count so a multi-minute source (up to 8192 cached peaks)
// doesn't render thousands of <rect>s into a 108px strip.
const MAX_ROW_BARS = 96;

function fmtDuration(sec: number): string {
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Fold peaks down to at most `target` bars (max within each bucket). */
function downsample(peaks: ArrayLike<number>, target: number): number[] {
  const len = peaks.length;
  if (len <= target) return Array.from(peaks as ArrayLike<number>);
  const out = new Array<number>(target).fill(0);
  const per = len / target;
  for (let i = 0; i < target; i++) {
    let max = 0;
    const start = Math.floor(i * per);
    const end = Math.min(len, Math.floor((i + 1) * per));
    for (let j = start; j < end; j++) {
      const v = peaks[j];
      if (v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}

export function AudioAssetRow({
  item,
  index,
  onOpen,
  onAdd,
  addLabel,
  onDelete,
  deleteLabel,
}: Props) {
  const t = useT();
  // item.url is already the server-routed /api/works/:id/assets/* path, so the
  // hook's `<src>.peaks.json` fast-path + WebAudio fallback both resolve.
  const { peaks, sourceDuration } = useWaveform(item.url);
  const { playing, toggle } = useAudioAudition(item.url);

  const bars = useMemo(
    () => (peaks ? downsample(peaks, MAX_ROW_BARS) : []),
    [peaks],
  );

  const draggable = onAdd !== undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Preview ${item.name}`}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              writeDragPayload(e.dataTransfer, {
                source: "asset",
                assetPath: item.path,
                assetKind: item.kind,
              });
              e.dataTransfer.effectAllowed = "copy";
            }
          : undefined
      }
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 52,
        padding: "0 10px",
        borderRadius: 10,
        border: "1px solid var(--glass-border)",
        background: "var(--surface-0)",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.boxShadow = "0 0 10px var(--accent-glow)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--glass-border)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Play / pause — single-instance audition. */}
      <button
        type="button"
        aria-label={playing ? t("studio.assetSidebar.pauseAudio") : t("studio.assetSidebar.playAudio")}
        title={playing ? t("studio.assetSidebar.pauseAudio") : t("studio.assetSidebar.playAudio")}
        data-bare
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          padding: 0,
          display: "grid",
          placeItems: "center",
          borderRadius: 999,
          border: `1px solid ${playing ? "var(--accent)" : "var(--glass-border)"}`,
          background: playing ? "var(--accent-glow)" : "var(--surface-1)",
          color: playing ? "var(--accent-hi)" : "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <polygon points="7 5 19 12 7 19 7 5" />
          </svg>
        )}
      </button>

      {/* Mini waveform — the visual signature. */}
      <div style={{ flexShrink: 0, width: WAVEFORM_W, height: WAVEFORM_H, display: "flex", alignItems: "center" }}>
        <PeaksSvg peaks={bars} width={WAVEFORM_W} height={WAVEFORM_H} opacity={0.7} />
      </div>

      {/* Filename + mono duration. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--text)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.name}
        </div>
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dimmer)",
            letterSpacing: "0.04em",
            display: "flex",
            gap: 6,
          }}
        >
          <span>{sourceDuration != null ? fmtDuration(sourceDuration) : "–:–"}</span>
          <span aria-hidden>·</span>
          <span>{item.ext.toUpperCase()}</span>
        </div>
      </div>

      {/* Actions — ＋ add-to-timeline + delete, unchanged behaviour. */}
      <div style={{ flexShrink: 0, display: "flex", gap: 4, alignItems: "center" }}>
        {onAdd && (
          <button
            type="button"
            aria-label={addLabel}
            title={addLabel}
            data-bare
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            style={{
              width: 24,
              height: 24,
              display: "grid",
              placeItems: "center",
              borderRadius: 6,
              border: "1px solid var(--glass-border)",
              background: "var(--surface-1)",
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 0,
              lineHeight: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label={deleteLabel}
            title={deleteLabel}
            data-bare
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={{
              width: 24,
              height: 24,
              display: "grid",
              placeItems: "center",
              borderRadius: 6,
              border: "1px solid var(--glass-border)",
              background: "var(--surface-1)",
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: 0,
              lineHeight: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
            </svg>
          </button>
        )}
      </div>

      {/* Index chip (screen-reader/debug parity with the card's numbering). */}
      <span aria-hidden style={{ display: "none" }}>
        {(index + 1).toString().padStart(2, "0")}
      </span>
    </div>
  );
}
