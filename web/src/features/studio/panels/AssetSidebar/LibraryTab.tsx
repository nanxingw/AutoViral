import { useMemo, useState } from "react";
import { useWorkAssets, type AssetItem } from "@/queries/assets";
import { GenerationDialog } from "@/features/studio/generation/GenerationDialog";
import { useGatedMediaSrc } from "@/features/studio/media/useGatedMediaSrc";
import { SearchBox } from "./SearchBox";
import { AssetPreviewModal } from "./AssetPreviewModal";

interface Props {
  workId: string;
}

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function LibraryTab({ workId }: Props) {
  const { data: groups = [], isLoading } = useWorkAssets(workId);
  const [active, setActive] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  // R43 — click any AssetTile to open large preview. null = closed.
  const [preview, setPreview] = useState<AssetItem | null>(null);

  const currentGroup = useMemo(() => {
    if (!groups.length) return null;
    return groups.find((g) => g.group === active) ?? groups[0];
  }, [groups, active]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--divider)", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-editorial)",
              fontSize: 18,
              fontStyle: "italic",
              letterSpacing: "-0.015em",
              color: "var(--text)",
            }}
          >
            Assets
          </div>
          <button
            type="button"
            aria-label="Upload"
            data-bare
            onClick={() => setGenOpen(true)}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "1px solid var(--glass-border)",
              background: "var(--surface-0)",
              color: "var(--text-dim)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
          {groups.length === 0 && !isLoading && (
            <span
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--text-dimmer)",
                letterSpacing: "0.06em",
              }}
            >
              NO ASSETS
            </span>
          )}
          {groups.map((g) => {
            const isActive = currentGroup?.group === g.group;
            return (
              <button
                key={g.group}
                type="button"
                data-bare
                onClick={() => setActive(g.group)}
                style={{
                  padding: "4px 10px",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.06em",
                  fontWeight: 500,
                  background: isActive ? "var(--accent-glow)" : "transparent",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--glass-border)"}`,
                  color: isActive ? "var(--accent-hi)" : "var(--text-dim)",
                  borderRadius: 999,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                {g.group} · {g.count}
              </button>
            );
          })}
        </div>
      </div>

      {/* Phase 8.1.C — CLIP semantic search */}
      <SearchBox workId={workId} />

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {isLoading && (
          <div
            style={{
              padding: 20,
              fontSize: 11,
              color: "var(--text-dimmer)",
              fontFamily: "var(--font-mono)",
              textAlign: "center",
            }}
          >
            LOADING…
          </div>
        )}
        {currentGroup && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {currentGroup.items.map((item, i) => (
              <AssetTile
                key={item.path}
                item={item}
                index={i}
                onOpen={() => setPreview(item)}
              />
            ))}
          </div>
        )}
      </div>

      <GenerationDialog
        workId={workId}
        open={genOpen}
        onOpenChange={setGenOpen}
      />
      <AssetPreviewModal asset={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function AssetTile({
  item,
  index,
  onOpen,
}: {
  item: AssetItem;
  index: number;
  onOpen: () => void;
}) {
  const hue = hueFromString(item.path);
  const fallbackBg = `linear-gradient(145deg, hsl(${hue}, 40%, 25%), hsl(${(hue + 30) % 360}, 30%, 12%))`;
  // Video tiles mount their <video> only on hover, then UNMOUNT on leave.
  // Why unmount: Chrome holds a hardware decoder context for every <video>
  // element with readyState=4. With ~7 thumbnails open at once we'd exceed
  // the per-tab decoder budget; the browser then LRU-evicts and re-decodes
  // an IDR frame, producing a ~3s playback hitch in the main preview. Pause
  // + currentTime=0 alone does NOT release the decoder — only unmount does.
  // (Diagnosed 2026-05-08; see commit msg.)
  const [hovered, setHovered] = useState(false);
  // R34: track media load failure. <video>.onerror fires for broken src
  // (404 / CORS / corrupt). Without it the tile silently shows fallback
  // gradient indistinguishable from "loading" state — user has no clue
  // their asset is broken.
  const [mediaFailed, setMediaFailed] = useState(false);
  // #37 — gate the poster <video> load behind the global media-load semaphore.
  // ~25 video tiles all mounting `preload="metadata"` at once helped saturate
  // Chrome's ~6/host connection pool and starve the preview. The gate defers
  // each poster's src until a slot frees; onSettled releases it once the
  // metadata frame is decoded so the next tile can load.
  const posterEnabled = item.kind === "video" && !hovered && !mediaFailed;
  const { src: posterSrc, onSettled: onPosterSettled } = useGatedMediaSrc(
    item.url,
    posterEnabled,
  );
  return (
    <div
      // R43 — tile is now an interactive control. role+tabIndex make it
      // keyboard-focusable; click + Enter both open the preview modal.
      // Pre-fix the tile had no onClick, so the only "preview" was hover-
      // autoplay (video) or nothing (image / audio).
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
        position: "relative",
        aspectRatio: "9/16",
        borderRadius: 8,
        background: fallbackBg,
        border: "1px solid var(--glass-border)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.boxShadow = "0 0 12px var(--accent-glow)";
        if (item.kind === "video") setHovered(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--glass-border)";
        e.currentTarget.style.boxShadow = "none";
        if (item.kind === "video") setHovered(false);
      }}
    >
      {item.kind === "video" && hovered && !mediaFailed && (
        <video
          src={item.url}
          muted
          playsInline
          autoPlay
          loop
          preload="auto"
          onError={() => setMediaFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {item.kind === "video" && !hovered && !mediaFailed && (
        <>
          {/* Poster frame: <video preload=metadata> + seek to 0.1s renders the
              first decoded frame WITHOUT holding a hardware decoder slot.
              Unlike autoPlay/loop which keep readyState=4 (decoder pinned),
              metadata-only + one-time seek lets the browser paint a single
              frame and release the decode pipeline. #37 — the load is now
              gated: posterSrc is undefined until the media-load semaphore
              grants a slot, so the tiles load a few at a time instead of all
              at once. Until then the ▶ glyph over the gradient is the
              placeholder. */}
          {posterSrc && (
            <video
              src={posterSrc}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                try {
                  v.currentTime = Math.min(0.1, (v.duration || 1) * 0.05);
                } catch {
                  /* some browsers throw if duration is unknown — ignore */
                }
                // Metadata frame is in hand — free the gate slot for the next
                // queued tile (the frame stays painted; we don't unmount).
                onPosterSettled();
              }}
              onError={() => {
                setMediaFailed(true);
                onPosterSettled();
              }}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Centered ▶ glyph as visual hint that hover plays the clip */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "rgba(255,255,255,0.85)",
              fontFamily: "var(--font-mono)",
              fontSize: 22,
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
              pointerEvents: "none",
            }}
          >
            ▶
          </div>
        </>
      )}
      {item.kind === "image" && !mediaFailed && (
        <img
          src={item.url}
          alt={item.name}
          loading="lazy"
          onError={() => setMediaFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {/* R34: shared failure indicator for image/video kinds. Red dashed
          border + ⚠ glyph centered over the fallback gradient. Audio is
          unaffected — its SVG glyph is always visible regardless of url. */}
      {(item.kind === "image" || item.kind === "video") && mediaFailed && (
        <div
          aria-label="Asset failed to load"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            border: "2px dashed var(--status-error, #d4756c)",
            background: "rgba(212, 117, 108, 0.06)",
            color: "var(--status-error, #d4756c)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            pointerEvents: "none",
          }}
        >
          ⚠
        </div>
      )}
      {item.kind === "audio" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <polygon points="12 6 7 11 3 11 3 13 7 13 12 18 12 6" fill="currentColor" />
            <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" />
          </svg>
        </div>
      )}

      {/* Top-left index chip */}
      <div
        style={{
          position: "absolute",
          top: 6,
          left: 6,
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          color: "rgba(255,255,255,0.9)",
          background: "rgba(0,0,0,0.4)",
          padding: "1px 5px",
          borderRadius: 3,
        }}
      >
        {(index + 1).toString().padStart(2, "0")}
      </div>

      {/* Bottom label */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: 6,
          background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.85))",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "white",
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
            fontSize: 8,
            color: "rgba(255,255,255,0.7)",
            fontFamily: "var(--font-mono)",
            marginTop: 1,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {item.ext}
        </div>
      </div>
    </div>
  );
}
