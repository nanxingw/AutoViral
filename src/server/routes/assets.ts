// Assets domain sub-router (I11): per-work asset listing / CLIP semantic
// search / file serving (with Range support) / upload, the clip-index
// build/status endpoints, and the shared-assets library. Split verbatim from
// api.ts — no behaviour/path change.
//
// ORDER MATTERS: the exact-path routes (/assets, /assets/search) and the
// clip-index routes are registered BEFORE the /assets/* wildcard so Hono's
// registration-order matching keeps the specific routes winning. Do not
// reorder these handlers.

import { Hono } from "hono";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname } from "node:path";
import {
  listAssets,
  getWork,
} from "../../domain/work-store.js";
import {
  listSharedAssetsWithMeta,
  getSharedAssetPath,
  validateCategory,
  sanitizeFilename,
  saveSharedAsset,
  deleteSharedAsset,
  moveSharedAsset,
} from "../../shared-assets.js";
import { resolveAssetPath, resolveAssetSubpath, UnsafePathError, SAFE_ID } from "../safe-paths.js";
import {
  getMimeType,
  assetSecurityHeaders,
  ALLOWED_UPLOAD_EXTS,
  MAX_UPLOAD_BYTES,
  uploadBodyLimit,
} from "./_shared.js";

export const assetsRouter = new Hono();

// GET /api/works/:id/assets
assetsRouter.get("/api/works/:id/assets", async (c) => {
  const id = c.req.param("id");
  try {
    const assets = await listAssets(id);
    return c.json({ assets });
  } catch {
    return c.json({ assets: [] });
  }
});

// ── Phase 8.1.B: CLIP semantic search ────────────────────────────────────────
// Registered BEFORE the wildcard /api/works/:id/assets/* so this exact route
// wins precedence — Hono matches in registration order for static segments.

// GET /api/works/:id/assets/search?q=<text>&topK=<n>  (CLIP semantic search)
assetsRouter.get("/api/works/:id/assets/search", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ error: "q required" }, 400);
  const rawK = parseInt(c.req.query("topK") ?? "20", 10);
  const topK = Number.isFinite(rawK)
    ? Math.max(1, Math.min(100, rawK))
    : 20;
  try {
    const { searchClipIndex } = await import("../clip-index.js");
    return c.json(await searchClipIndex(id, q, topK));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/clip-index/build — build/refresh the per-work CLIP index
assetsRouter.post("/api/clip-index/build", async (c) => {
  let body: { workId?: string };
  try {
    body = await c.req.json<{ workId: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const workId = body?.workId;
  if (!workId || !SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId" }, 400);
  }
  try {
    const { buildClipIndex } = await import("../clip-index.js");
    return c.json(await buildClipIndex(workId));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/clip-index/status?workId=<id>
assetsRouter.get("/api/clip-index/status", async (c) => {
  const workId = c.req.query("workId");
  if (!workId || !SAFE_ID.test(workId)) {
    return c.json({ error: "Invalid workId" }, 400);
  }
  try {
    const { getClipIndexStatus } = await import("../clip-index.js");
    return c.json(await getClipIndexStatus(workId));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/works/:id/assets/* — serve asset files (supports nested paths like images/scene-01.png or output/final.mp4)
assetsRouter.get("/api/works/:id/assets/*", async (c) => {
  const id = c.req.param("id");
  // Extract the nested path after /assets/
  const url = new URL(c.req.url);
  const prefix = `/api/works/${id}/assets/`;
  const nestedPath = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!nestedPath) return c.json({ error: "Asset path required" }, 400);

  try {
    // Map URL → physical asset root. Only assets/ and output/ are reachable —
    // work.yaml / chat.json / eval-*.json are NEVER served. (Codex review 2026-04-27)
    //
    // URL forms:
    //   /assets/output/<path>  → workDir/output/<path>
    //   /assets/assets/<path>  → workDir/assets/<path>
    //   /assets/<path>         → workDir/assets/<path>  (legacy, default to assets/)
    let root: "assets" | "output";
    let rest: string;
    if (nestedPath.startsWith("output/")) {
      root = "output";
      rest = nestedPath.slice("output/".length);
    } else if (nestedPath.startsWith("assets/")) {
      root = "assets";
      rest = nestedPath.slice("assets/".length);
    } else {
      root = "assets";
      rest = nestedPath;
    }
    if (!rest) return c.json({ error: "Asset path required" }, 400);
    const filePath = resolveAssetPath(id, root, rest);
    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
    const mimeType = getMimeType(filePath);
    const rangeHeader = c.req.header("range");

    // Support HTTP Range requests (required for browser video/audio playback)
    if (rangeHeader && (mimeType.startsWith("video/") || mimeType.startsWith("audio/"))) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const fullContent = await readFile(filePath);
        const slice = fullContent.subarray(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            "Content-Type": mimeType,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Content-Length": String(chunkSize),
            "Accept-Ranges": "bytes",
            ...assetSecurityHeaders(mimeType),
          },
        });
      }
    }

    const content = await readFile(filePath);
    return new Response(content, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        ...assetSecurityHeaders(mimeType),
      },
    });
  } catch {
    return c.json({ error: "Asset not found", errorCode: "asset_not_found" }, 404);
  }
});

// POST /api/works/:id/assets/upload — upload file to work assets
// #67 — uploadBodyLimit (Content-Length-aware) rejects oversized requests before
// parseBody buffers them into heap. The in-handler file.size check below is the
// secondary guard (friendly errorCode; covers the no-Content-Length path).
assetsRouter.post("/api/works/:id/assets/upload", uploadBodyLimit, async (c) => {
  const workId = c.req.param("id");
  if (!SAFE_ID.test(workId)) return c.json({ error: "Invalid workId" }, 400);

  const work = await getWork(workId);
  if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);

  const body = await c.req.parseBody();
  const file = body.file;
  const subdir = (body.subdir as string) ?? "images";

  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  // #67 — align with the shared-assets sibling: reject oversized files with a
  // friendly, localizable code. (Defense-in-depth behind uploadBodyLimit.)
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      { error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit`, errorCode: "asset_too_large" },
      413,
    );
  }

  // Sanitize basename to prevent path traversal (Codex review 2026-04-27)
  const safeBasename = file.name.replace(/[/\\]/g, "_").replace(/^\.+/, "");
  if (!safeBasename) return c.json({ error: "Invalid filename" }, 400);

  // #52 — reject non-media types at the door (defense-in-depth first gate;
  // the serve endpoint's nosniff + SVG CSP is the second). Markup / script /
  // arbitrary extensions never reach disk.
  const uploadExt = extname(safeBasename).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.has(uploadExt)) {
    return c.json(
      {
        error: `Unsupported file type "${uploadExt || "(none)"}". Allowed: images, video, audio.`,
        errorCode: "unsupported_asset_type",
      },
      415,
    );
  }

  let filePath: string;
  try {
    filePath = resolveAssetSubpath(workId, "assets", subdir, safeBasename);
  } catch (err) {
    if (err instanceof UnsafePathError) return c.json({ error: err.message }, 400);
    throw err;
  }

  // Ensure parent directory exists
  const { dirname } = await import("node:path");
  await mkdir(dirname(filePath), { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  // Audio uploads: fire-and-forget peaks generation so the frontend can
  // fetch <file>.peaks.json instead of decoding the whole mp3 in WebAudio.
  // Failure is logged but never blocks the upload response — frontend
  // falls back to client-side decoding when peaks JSON is missing.
  // See docs/archive/plans/2026-05-25-multi-track-stacking.md.
  void import("../audio/peaks.js").then(({ generatePeaks, isAudioAsset }) => {
    if (isAudioAsset(filePath)) {
      generatePeaks(filePath).catch((err) =>
        console.warn(`[peaks] gen failed for ${filePath}:`, err),
      );
    }
  });

  // Clean URL — GET defaults to workDir/assets/ when no explicit root prefix
  return c.json({
    success: true,
    path: `assets/${subdir}/${safeBasename}`,
    url: `/api/works/${workId}/assets/${subdir}/${encodeURIComponent(safeBasename)}`,
  });
});

// ---------------------------------------------------------------------------
// Shared Assets
// ---------------------------------------------------------------------------

assetsRouter.get("/api/shared-assets", async (c) => {
  const assets = await listSharedAssetsWithMeta();
  return c.json(assets);
});

assetsRouter.get("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    validateCategory(category);
    const filePath = getSharedAssetPath(category, file);
    const data = await readFile(filePath);
    const mime = getMimeType(filePath);
    const isMedia = mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/");
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": isMedia ? "inline" : `attachment; filename="${encodeURIComponent(sanitizeFilename(file))}"`,
      },
    });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Failed to read file" }, 500);
  }
});

assetsRouter.post("/api/shared-assets/move", async (c) => {
  try {
    const { from, to, file } = await c.req.json<{ from: string; to: string; file: string }>();
    if (!from || !to || !file) return c.json({ error: "from, to, and file are required" }, 400);
    await moveSharedAsset(from, to, file);
    return c.json({ moved: true, from, to, file });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    if (e.message?.includes("already exists")) return c.json({ error: e.message }, 409);
    return c.json({ error: e.message ?? "Move failed" }, 500);
  }
});

assetsRouter.post("/api/shared-assets/:category", uploadBodyLimit, async (c) => {
  const category = c.req.param("category");
  try {
    validateCategory(category);
  } catch {
    return c.json({ error: `Invalid category: ${category}` }, 400);
  }
  try {
    const body = await c.req.parseBody({ all: true });
    const files = Array.isArray(body["file"]) ? body["file"] : body["file"] ? [body["file"]] : [];
    const uploaded = [];
    for (const f of files) {
      if (!(f instanceof File)) continue;
      // #67 — use the shared MAX_UPLOAD_BYTES so this and the per-work endpoint
      // can't drift. (uploadBodyLimit already rejects via Content-Length first.)
      if (f.size > MAX_UPLOAD_BYTES) return c.json({ error: `File ${f.name} exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit`, errorCode: "asset_too_large" }, 413);
      const buf = Buffer.from(await f.arrayBuffer());
      const asset = await saveSharedAsset(category, f.name, buf);
      uploaded.push({ ...asset, url: `/api/shared-assets/${category}/${encodeURIComponent(asset.name)}` });
    }
    if (uploaded.length === 0) return c.json({ error: "No files provided" }, 400);
    return c.json({ uploaded });
  } catch (e: any) {
    return c.json({ error: e.message ?? "Upload failed" }, 500);
  }
});

assetsRouter.delete("/api/shared-assets/:category/:file", async (c) => {
  const category = c.req.param("category");
  const file = c.req.param("file");
  try {
    await deleteSharedAsset(category, file);
    return c.json({ deleted: true });
  } catch (e: any) {
    if (e.code === "ENOENT") return c.json({ error: "File not found" }, 404);
    if (e.message?.includes("Invalid")) return c.json({ error: e.message }, 400);
    return c.json({ error: "Delete failed" }, 500);
  }
});
