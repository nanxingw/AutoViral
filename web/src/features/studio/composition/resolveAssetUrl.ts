import type { Composition } from "../types";

const SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
// Match shared-asset filesystem paths, anywhere in the string. Matches
// both ~/.autoviral/shared-assets/<cat>/<file> and any custom data dir
// that ends in shared-assets/<cat>/<file>.
const SHARED_ASSETS_RE = /\/shared-assets\/([^/]+)\/(.+)$/;

/**
 * composition.yaml stores `clip.src` / `asset.uri` in three flavours:
 *   1. Workspace-relative path:  "assets/videos/test.mp4"
 *   2. Absolute shared-asset:    "/Users/.../shared-assets/characters/x.png"
 *   3. Already-served URL:       "http://...", "data:...", "blob:...",
 *                                "/api/works/<id>/assets/..." (server-rewritten)
 *
 * Browser-side media elements can only load (3). This helper translates
 * (1) → /api/works/:id/assets/* and (2) → /api/shared-assets/* so dive
 * graph thumbnails, Scene.tsx clip rendering, and any future consumer
 * stay on a single resolver.
 *
 * Mirrors `rewriteClipSrcsToAbsolute` in src/server/render-pipeline.ts —
 * server side rewrites to an absolute URL with localhost:<port>; browser
 * side uses a relative URL so vite/the page origin handles it.
 */
export function resolveAssetUrl(src: string, workId: string): string {
  if (!src) return src;
  // Scheme-prefixed (http, https, data, blob) → already loadable.
  if (SCHEME.test(src)) return src;

  // Page-absolute paths can be one of two things:
  //   a. Already-rewritten "/api/works/<id>/assets/…" — pass through to
  //      avoid double-wrapping ("/api/works/<id>/assets//api/works/…")
  //      which silently 404s in the video element. (2026-05-08)
  //   b. Filesystem-absolute shared-asset path — needs translation to
  //      /api/shared-assets/<category>/<file>.
  if (src.startsWith("/")) {
    const sharedMatch = src.match(SHARED_ASSETS_RE);
    if (sharedMatch) {
      const [, category, file] = sharedMatch;
      return `/api/shared-assets/${encodeURIComponent(category)}/${encodeURIComponent(file)}`;
    }
    // Not shared-assets → already a routable URL (the page-absolute
    // contract above). Pass through.
    return src;
  }

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
