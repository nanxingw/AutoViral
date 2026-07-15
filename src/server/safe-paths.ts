// Shared safe-path resolver for endpoints that take user-controlled path
// fragments. Anything that joins client input into a filesystem path MUST go
// through here. Codex review (2026-04-27) flagged path traversal in upload,
// audio/analyze, audio/mix, asset GET, and provider routes — this module
// replaces the ad-hoc joins.

import { resolve, sep, isAbsolute, dirname } from "node:path";
import { join } from "node:path";

// Read dataDir lazily so tests using AUTOVIRAL_DATA_DIR env see the right value
function getDataDir(): string {
  return process.env.AUTOVIRAL_DATA_DIR ?? `${process.env.HOME ?? ""}/.autoviral`;
}

/**
 * The directory that holds every work's folder, resolved the SAME way the asset
 * routes resolve paths (resolveAssetPath joins `resolve(getDataDir(), "works", …)`).
 * File watchers (composition-watcher / plan-watcher) MUST use this so they never
 * diverge from the REST routes on a non-default config.
 *
 * Priority: explicit AUTOVIRAL_WORKS_ROOT → <AUTOVIRAL_DATA_DIR>/works →
 * ~/.autoviral/works. In production all three collapse to ~/.autoviral/works;
 * the divergence only bit tests / custom-DATA_DIR setups (review 2026-06-09).
 */
export function getWorksRoot(): string {
  if (process.env.AUTOVIRAL_WORKS_ROOT) return process.env.AUTOVIRAL_WORKS_ROOT;
  return resolve(getDataDir(), "works");
}

export const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

// "plan" (PRD-0007 S5) holds the planning-layer markdown (剧本 plan/script.md).
// Same traversal guards as assets/output — only a safe single basename
// (script.md) is ever resolved under it.
export const ASSET_ROOTS = ["assets", "output", "plan"] as const;
export type AssetRoot = (typeof ASSET_ROOTS)[number];

export class UnsafePathError extends Error {
  constructor(message: string, public readonly attempted: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

/**
 * Resolve a user-supplied subpath against a per-work asset root.
 * Throws UnsafePathError if the resolved path escapes the allowed root.
 *
 * @param workId  Caller-validated work id (must already pass SAFE_ID)
 * @param root    Either "assets" or "output" — anything else is rejected
 * @param userPath  Slash-or-backslash separated subpath (may contain "../" — rejected)
 */
export function resolveAssetPath(workId: string, root: AssetRoot, userPath: string): string {
  if (!SAFE_ID.test(workId)) {
    throw new UnsafePathError(`workId failed SAFE_ID check`, workId);
  }
  if (!ASSET_ROOTS.includes(root)) {
    throw new UnsafePathError(`root must be one of ${ASSET_ROOTS.join("|")}`, root);
  }

  // Reject absolute paths BEFORE any normalisation
  if (isAbsolute(userPath) || userPath.startsWith("/") || userPath.startsWith("\\")) {
    throw new UnsafePathError(`absolute paths are not allowed`, userPath);
  }

  // Normalise + reject traversal markers
  const cleaned = userPath.replace(/\\/g, "/");
  if (cleaned.split("/").some((seg) => seg === "..")) {
    throw new UnsafePathError(`path contains traversal segments`, userPath);
  }

  const rootDir = resolve(getDataDir(), "works", workId, root);
  const target = resolve(rootDir, cleaned);

  // resolve() collapses any sneaky ../; verify final path stays under root
  if (target !== rootDir && !target.startsWith(rootDir + sep)) {
    throw new UnsafePathError(`resolved path escapes ${root} root`, userPath);
  }
  return target;
}

/**
 * Same as resolveAssetPath but returns the directory that holds the file
 * (creating it on disk is the caller's responsibility).
 */
export function resolveAssetSubdir(workId: string, root: AssetRoot, subdir: string): string {
  return resolveAssetPath(workId, root, subdir);
}

/**
 * Pick a file path under workDir/<root>/ given a basename only.
 * Rejects any "/" or "\" in the basename.
 */
export function resolveAssetFile(workId: string, root: AssetRoot, basename: string): string {
  if (basename.includes("/") || basename.includes("\\") || basename === "..") {
    throw new UnsafePathError(`basename must not contain path separators`, basename);
  }
  return resolveAssetPath(workId, root, basename);
}

/**
 * Resolve a stored `AssetEntry.uri` to its on-disk path — the SINGLE source of
 * truth for uri→disk, mirroring the GET /api/works/:id/assets/* serve route's
 * URL→physical-root mapping (routes/assets.ts:106-135). Accepts BOTH shapes an
 * AssetEntry.uri takes:
 *   - absolute API URL:  /api/works/<id>/assets/output/final.mp4
 *   - work-relative:     assets/images/cover.png
 * and reduces them to the same nested path before applying the root rule
 * (`output/…` → workDir/output/… ; everything else → workDir/assets/…).
 *
 * Replaces the ad-hoc `uri.replace(/^\/api\/works\/[^/]+\/assets\//,'') +
 * join(wDir,'assets',rel)` that post-process/reframe/lip-sync used, which
 * double-counted `assets/` for work-relative uris and mis-routed output/ files
 * (PRD-0010 AE E2E — broke super-resolve / frame-interpolate / lip-sync).
 */
export function resolveAssetUriToPath(workId: string, uri: string): string {
  const afterApi = uri.replace(/^\/?api\/works\/[^/]+\//, "").replace(/^\/+/, "");
  // Drop the leading `assets/` segment to get the nested path the serve route
  // sees (its `nestedPath` is everything after the first `/assets/`).
  const nested = afterApi.startsWith("assets/")
    ? afterApi.slice("assets/".length)
    : afterApi;
  let root: AssetRoot;
  let rest: string;
  if (nested.startsWith("output/")) {
    root = "output";
    rest = nested.slice("output/".length);
  } else if (nested.startsWith("assets/")) {
    // legacy /assets/assets/<x> double form
    root = "assets";
    rest = nested.slice("assets/".length);
  } else {
    root = "assets";
    rest = nested;
  }
  return resolveAssetPath(workId, root, rest);
}

/**
 * Resolve a composition clip's `src` to an ABSOLUTE filesystem path for the
 * pre-Remotion ffmpeg pre-passes (speed-ramp / time-warp / crop-flip). Those
 * passes run in render-pipeline Stage 0/0.4/0.5 — BEFORE
 * rewriteClipSrcsToAbsolute (render-pipeline.ts) — so they see the RAW
 * work-relative src straight out of composition.yaml (e.g.
 * "assets/clips/s01.mp4"). Handing that relative string to ffprobe/ffmpeg
 * resolves it against the DAEMON's cwd (the repo root in production, NOT the
 * work dir) → "No such file or directory" (PRD-0014 S18 finding A — the whole
 * class of "变速导出渲染前即挂" bugs the recon E2E D3 caught).
 *
 * `outDir` is the render output directory the pipeline already threads through,
 * i.e. "<workRoot>/output"; clip srcs are work-relative to the work ROOT, so the
 * resolution base is `dirname(outDir)`. Deriving the base from outDir (NOT from
 * getWorksRoot()/env) keeps this in lock-step with where the pre-pass CACHE is
 * written — sidestepping the AUTOVIRAL_WORKS_ROOT vs AUTOVIRAL_DATA_DIR
 * divergence that resolveAssetUriToPath would reintroduce here.
 *
 * Pass-through (returned unchanged):
 *   - URL-scheme srcs: data: / http: / https: / blob: / file:
 *   - already-absolute filesystem paths — a prior pre-pass's cache output that a
 *     chained pass reads (the speed→timewarp→cropflip order can hand one pass's
 *     absolute cache path to the next)
 * Rewritten to `<workRoot>/<rel>`:
 *   - page-absolute API uris (/api/works/<id>/assets/foo → <workRoot>/assets/foo)
 *   - plain work-relative paths ("assets/…" / "output/…")
 */
export function resolvePrePassSourcePath(src: string, outDir: string): string {
  if (!src) return src;
  // A URL scheme (data:, blob:, http:, https:, file:) is handed to ffmpeg / the
  // caller verbatim — never a local join. Mirrors rewriteClipSrcsToAbsolute's
  // SCHEME guard so the two path handlers agree on what "already absolute" means.
  if (/^[a-z][a-z0-9+.\-]*:/i.test(src)) return src;
  const workRoot = dirname(outDir);
  // Page-absolute API uri form (/api/works/<id>/assets/… or api/works/…) — the
  // "some comps store clip.src already page-absolute" case rewriteClipSrcs guards.
  const apiStripped = src.replace(/^\/?api\/works\/[^/]+\//, "");
  if (apiStripped !== src) {
    return join(workRoot, apiStripped.replace(/^\/+/, ""));
  }
  // A genuine absolute filesystem path (prior pre-pass cache) is already usable.
  if (isAbsolute(src)) return src;
  // Work-relative ("assets/…" / "output/…") → resolve under the work root.
  return join(workRoot, src);
}

/**
 * For routes that accept BOTH a subdir AND a basename and need to combine them.
 * Rejects traversal in either piece.
 */
export function resolveAssetSubpath(workId: string, root: AssetRoot, subdir: string, basename: string): string {
  if (basename.includes("/") || basename.includes("\\") || basename === "..") {
    throw new UnsafePathError(`basename must not contain path separators`, basename);
  }
  // subdir may have nested directories ("frames/2026") — resolveAssetPath rejects ".."
  return resolveAssetPath(workId, root, join(subdir, basename));
}
