import type { AssetEntry } from "../../types";
import { useInViewport } from "../useInViewport";

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

type ThumbAsset = Pick<AssetEntry, "kind" | "uri" | "name" | "id">;

/**
 * The visual fill of a Dive node. Images load eagerly; videos are gated behind
 * an IntersectionObserver (B5) so off-screen clip nodes fire NO metadata
 * request until they scroll into view. On-screen we set preload="metadata" so
 * the first frame paints as a poster WITHOUT autoplaying (deliberately no
 * autoplay — a graph of N clips must not trigger the #37 concurrent-decode
 * deadlock).
 */
export function MediaThumb({ asset }: { asset: ThumbAsset }) {
  const label = asset.name ?? asset.id;
  const { ref, inView } = useInViewport<HTMLVideoElement>();

  if (isVideoAsset(asset)) {
    return (
      <video
        ref={ref}
        data-testid="dive-video"
        // Gate: no src + preload="none" until the node is in view → zero
        // metadata traffic for off-screen clips.
        src={inView ? asset.uri : undefined}
        preload={inView ? "metadata" : "none"}
        muted
        playsInline
        aria-label={label}
        style={mediaStyle}
      />
    );
  }
  return <img src={asset.uri} alt={label} loading="lazy" style={mediaStyle} />;
}
