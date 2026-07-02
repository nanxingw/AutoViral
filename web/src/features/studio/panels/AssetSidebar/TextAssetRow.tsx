// A7 (PRD-0010) — TextAssetRow: a content snippet card for the TEXT group.
//
// The one-size-fits-all 9:16 tile turned every text asset into an anonymous
// gradient rectangle — a creator couldn't tell a subtitle track from a caption
// draft without opening each one. This card fetches the first ~200 chars
// (useAssetText) and renders them mono, clamped to 3 lines, with an extension
// badge. When the content can't be fetched it degrades to a filename-only card
// (no broken body). Text assets have no timeline representation, so — unlike
// the video/audio/image tiles — there is no ＋ / drag affordance; click opens
// the full-text preview modal and the trash affordance is preserved.
import type { AssetItem } from "@/queries/assets";
import { useT } from "@/i18n/useT";
import { useAssetText } from "../../hooks/useAssetText";

interface Props {
  item: AssetItem;
  index: number;
  onOpen: () => void;
  // I18 — open the delete confirm (kept from the card).
  onDelete?: () => void;
  deleteLabel?: string;
}

export function TextAssetRow({ item, index, onOpen, onDelete, deleteLabel }: Props) {
  const t = useT();
  const { text, failed, loading } = useAssetText(item.url);
  const showSnippet = !failed && text != null && text.trim().length > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Preview ${item.name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
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
      {/* Header: filename + ext badge + delete. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: "var(--text)",
            fontWeight: 500,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={item.name}
        >
          {item.name}
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.06em",
            color: "var(--text-dim)",
            background: "var(--surface-1)",
            border: "1px solid var(--glass-border)",
            borderRadius: 4,
            padding: "1px 5px",
          }}
        >
          {item.ext.toUpperCase()}
        </span>
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
              flexShrink: 0,
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

      {/* Body: mono snippet clamped to 3 lines, or a graceful degrade line. */}
      {showSnippet ? (
        <div
          data-testid="text-snippet"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--text-dim)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {text}
        </div>
      ) : (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.04em",
            color: "var(--text-dimmer)",
          }}
        >
          {loading ? "…" : t("studio.assetSidebar.textPreviewFailed")}
        </div>
      )}

      {/* Index chip (screen-reader/debug parity with the tile numbering). */}
      <span aria-hidden style={{ display: "none" }}>
        {(index + 1).toString().padStart(2, "0")}
      </span>
    </div>
  );
}
