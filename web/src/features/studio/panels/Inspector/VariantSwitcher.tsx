import { useComposition } from "../../store";
import { findAssetByUri, walkProvenance } from "../../dive/walkProvenance";
import type { AssetEntry, Clip } from "../../types";

/**
 * VariantSwitcher — sibling-variant browser for the selected clip's bound
 * asset. Maps clip.src → AssetEntry via findAssetByUri, then surfaces siblings
 * from walkProvenance(). Clicking USE THIS dispatches rebindClip(clipId,
 * siblingAssetId).
 *
 * Empty states:
 *   - no selection                  → "No clip selected"
 *   - selection but no bound asset  → "No variants"  (URI lookup miss)
 *   - bound asset has 0 siblings    → "No variants"
 */
export function VariantSwitcher() {
  const comp = useComposition((s) => s.comp);
  const selection = useComposition((s) => s.selection);
  const rebindClip = useComposition((s) => s.rebindClip);

  if (!comp || !selection) {
    return <EmptyState message="No clip selected — pick one in the timeline" />;
  }

  // Find the selected clip across all tracks.
  let selectedClip: Clip | null = null;
  for (const t of comp.tracks) {
    const c = (t.clips as Clip[]).find((c) => c.id === selection);
    if (c) {
      selectedClip = c;
      break;
    }
  }
  if (!selectedClip || !("src" in selectedClip)) {
    return <EmptyState message="Selected clip has no media binding" />;
  }

  const bound = findAssetByUri(comp, selectedClip.src);
  if (!bound) {
    return <EmptyState message="No variants — clip is not bound to a known asset" />;
  }

  const { siblings } = walkProvenance(comp, bound.id);
  if (siblings.length === 0) {
    return <EmptyState message="No variants — this asset has no sibling derivations" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <CurrentBadge asset={bound} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {siblings.map((s) => (
          <VariantTile
            key={s.id}
            asset={s}
            onUse={() => rebindClip(selection, s.id)}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 20,
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        color: "var(--text-dimmer)",
        letterSpacing: "0.04em",
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}

function CurrentBadge({ asset }: { asset: AssetEntry }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid var(--accent)",
        background: "var(--accent-glow)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        color: "var(--accent-hi)",
      }}
    >
      <span style={{ opacity: 0.7 }}>CURRENT · </span>
      {asset.id}
    </div>
  );
}

function VariantTile({
  asset,
  onUse,
}: {
  asset: AssetEntry;
  onUse: () => void;
}) {
  return (
    <div
      data-testid={`variant-tile-${asset.id}`}
      style={{
        position: "relative",
        aspectRatio: "9/16",
        borderRadius: 8,
        border: "1px solid var(--glass-border)",
        overflow: "hidden",
        background: "var(--surface-0)",
      }}
    >
      {(asset.kind === "image" || asset.kind === "video") && (
        <img
          src={asset.uri}
          alt={asset.name ?? asset.id}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
          loading="lazy"
        />
      )}
      <button
        type="button"
        data-testid={`use-variant-${asset.id}`}
        onClick={onUse}
        style={{
          position: "absolute",
          bottom: 6,
          left: 6,
          right: 6,
          padding: "4px 8px",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          border: "1px solid var(--accent)",
          background: "rgba(0,0,0,0.55)",
          color: "var(--accent-hi)",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        USE THIS · {asset.id}
      </button>
    </div>
  );
}
