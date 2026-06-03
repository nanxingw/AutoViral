import type { NodeProps } from "@xyflow/react";
import { NodeShell, type DiveNode } from "./NodeShell";
import type { AssetEntry } from "../../types";

// #84 — a video extension on the asset URI (mirrors Chat's media detection).
const VIDEO_URI = /\.(mp4|mov|webm|m4v|mkv)(?:[?#]|$)/i;

/** True when an asset should render as <video> rather than <img>. `kind` is
 *  the schema-authoritative signal; the URI extension is a defensive fallback
 *  for assets whose kind wasn't set (older works). */
export function isVideoAsset(asset: Pick<AssetEntry, "kind" | "uri">): boolean {
  return asset.kind === "video" || VIDEO_URI.test(asset.uri);
}

const mediaStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

export function VisualNode({ data }: NodeProps<DiveNode>) {
  const label = data.asset.name ?? data.asset.id;
  return (
    <NodeShell assetId={data.asset.id} isCurrent={data.isCurrent} onUse={data.onUse}>
      {isVideoAsset(data.asset) ? (
        // #84 — clip assets in a video work are .mp4; an <img> can't
        // decode them (complete:true, naturalWidth:0 → blank gray card).
        // Render a <video> instead. preload="metadata" paints the first
        // frame as a poster WITHOUT autoplaying — deliberately no autoplay
        // so a graph of N clip nodes doesn't trigger the concurrent-decode
        // deadlock seen in #37.
        <video
          src={data.asset.uri}
          muted
          playsInline
          preload="metadata"
          aria-label={label}
          style={mediaStyle}
        />
      ) : (
        <img src={data.asset.uri} alt={label} loading="lazy" style={mediaStyle} />
      )}
    </NodeShell>
  );
}
