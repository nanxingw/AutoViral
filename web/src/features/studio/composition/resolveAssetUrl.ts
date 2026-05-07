import type { Composition } from "../types";

const SCHEME = /^[a-z][a-z0-9+.\-]*:/i;

/**
 * composition.yaml stores `clip.src` as workspace-relative paths
 * ("assets/videos/test.mp4") so files are portable. Any browser-side
 * media element trying to load that string resolves it relative to
 * the page origin (vite dev server) and 404s. Map relative paths to
 * the local server's `/api/works/:id/assets/...` route, which is
 * already wired through vite's proxy. URLs with a scheme
 * (http://, https://, data:, blob:) pass through unchanged.
 *
 * Mirrors `rewriteClipSrcsToAbsolute` in src/server/render-pipeline.ts —
 * server side rewrites to an absolute URL with localhost:<port>; browser
 * side uses a relative URL so vite/the page origin handles it.
 */
export function resolveAssetUrl(src: string, workId: string): string {
  if (!src || SCHEME.test(src)) return src;
  const trimmed = src.startsWith("assets/") ? src.slice("assets/".length) : src;
  const segments = trimmed.split("/").map(encodeURIComponent).join("/");
  return `/api/works/${workId}/assets/${segments}`;
}

/** Walk a Composition and rewrite every clip.src that is a relative path. */
export function resolveCompositionAssets(comp: Composition): Composition {
  return {
    ...comp,
    tracks: comp.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (c.kind === "text") return c;
        const src = (c as { src?: string }).src;
        if (typeof src !== "string") return c;
        return { ...c, src: resolveAssetUrl(src, comp.workId) } as typeof c;
      }),
    })),
  };
}
