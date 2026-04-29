import { useMemo, useState } from "react";
import { useWorkAssets, type AssetItem } from "@/queries/assets";
import { GenerationDialog } from "@/features/studio/generation/GenerationDialog";

interface Props {
  workId: string;
}

function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function AssetSidebar({ workId }: Props) {
  const { data: groups = [], isLoading } = useWorkAssets(workId);
  const [active, setActive] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);

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
              <AssetTile key={item.path} item={item} index={i} />
            ))}
          </div>
        )}
      </div>

      <GenerationDialog
        workId={workId}
        open={genOpen}
        onOpenChange={setGenOpen}
      />
    </div>
  );
}

function AssetTile({ item, index }: { item: AssetItem; index: number }) {
  const hue = hueFromString(item.path);
  const fallbackBg = `linear-gradient(145deg, hsl(${hue}, 40%, 25%), hsl(${(hue + 30) % 360}, 30%, 12%))`;
  return (
    <div
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
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--glass-border)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {item.kind === "video" && (
        <video
          src={item.url}
          muted
          playsInline
          preload="metadata"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
      )}
      {item.kind === "image" && (
        <img
          src={item.url}
          alt={item.name}
          loading="lazy"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
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
