// I21 — `autoviral snapshot`: capture the CURRENT frame / slide as a PNG so the
// agent can Read it and visually self-check before declaring done (invariant #6
// — E2E = what's actually visible, not the backend artifact the agent assumed).
//
// Two work types, two capture paths:
//   • short-video (composition.yaml)  → Remotion renderStill at the current
//     playhead (or --at <seconds>). Same serveUrl/inputProps/browserExecutable
//     as the full mp4 render, so the still is faithful to the deliverable.
//   • image-text (carousel.yaml)      → the current slide's on-disk visual.
//     The carousel is composited by the browser's Konva canvas, NOT by a
//     server-side renderer — there is no headless way to bake text layers over
//     the bg here. So we return the most faithful artifact the server CAN see:
//     an already-exported output/*.png for that slide if one exists, else the
//     slide's background image on disk. We NEVER fabricate a blank PNG; if
//     neither exists we throw an actionable error (export first / add a bg).
//
// HONESTY: when a carousel snapshot can only return the slide BACKGROUND (the
// common case — no browser/Konva renderer server-side), the text/shape/sticker
// layers are NOT in the PNG. We flag that with `textLayersComposited: false` so
// the bridge response and the CLI can warn the agent NOT to infer text layout /
// overflow from a base-only image. The video path is always faithful (overlays
// are in the Remotion render) ⇒ true.
//
// Resolution roots mirror the bridge composition/carousel ops
// (AUTOVIRAL_WORKS_ROOT ?? ~/.autoviral/works) so a snapshot reads exactly the
// files the rest of the bridge writes.

import { mkdir, access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readCompositionFor } from "./bridge/composition-ops.js";
import { readCarouselFor } from "./bridge/carousel-ops.js";
import { renderCompositionStill } from "./remotion-still.js";
import { rewriteClipSrcsToAbsolute } from "./render-pipeline.js";
import { read as readFocus } from "../focus/index.js";
import type { Carousel, Slide } from "../shared/carousel.js";

export interface SnapshotContext {
  workId: string;
  /** video: seconds into the timeline. Omitted ⇒ current playhead (focus). */
  at?: number;
  /** carousel: slide id. Omitted ⇒ first slide. */
  slide?: string;
  /** Override for tests / non-default work roots. Defaults to ~/.autoviral/works. */
  worksRoot?: string;
}

export interface SnapshotResult {
  /** Absolute path of the PNG the agent should Read. */
  path: string;
  /** Which capture path produced it — lets callers/tests/UX disambiguate. */
  kind: "video-still" | "carousel-slide";
  /**
   * Whether the PNG actually contains the text/shape/sticker layers composited
   * over the base. true for a faithful render (video renderStill, or a real
   * exported carousel page). false for the carousel background-only fallback —
   * the agent must NOT infer text layout/overflow from such an image. Callers
   * (bridge/CLI) surface this so the agent knows what it's looking at.
   */
  textLayersComposited: boolean;
}

function resolveWorksRoot(ctx: SnapshotContext): string {
  return (
    ctx.worksRoot ??
    process.env.AUTOVIRAL_WORKS_ROOT ??
    join(homedir(), ".autoviral/works")
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the work type by which deliverable exists on disk. composition.yaml ⇒
 * video, carousel.yaml ⇒ carousel. (We probe rather than read a work.yaml type
 * field so a snapshot works the moment the deliverable lands, same as the rest
 * of the bridge which is purely deliverable-driven.)
 */
async function detectKind(
  root: string,
  workId: string,
): Promise<"video" | "carousel"> {
  const dir = join(root, workId);
  if (await exists(join(dir, "composition.yaml"))) return "video";
  if (await exists(join(dir, "carousel.yaml"))) return "carousel";
  throw new Error(
    `no composition.yaml or carousel.yaml found for work ${workId} — create the deliverable before snapshotting`,
  );
}

/**
 * Parse a slide background `bg.value` that points at a per-work asset and
 * return the asset-relative subpath (e.g. "assets/images/s1.png"), or null if
 * the value isn't a same-work asset URL (gradient/solid/external are not files).
 *
 * Accepts both the API form (`/api/works/<id>/assets/<rel>`) and a bare
 * relative path (`assets/images/x.png`), matching what the agent writes via the
 * carousel CLI (see ws-bridge buildSystemPrompt — assets/* relative paths).
 */
export function bgImageAssetRel(
  workId: string,
  bg: Slide["bg"],
): string | null {
  if (bg.type !== "image") return null;
  const value = bg.value;
  const apiPrefix = `/api/works/${workId}/assets/`;
  if (value.startsWith(apiPrefix)) {
    // Each path segment is encodeURIComponent'd by the legacy carousel writer.
    return value
      .slice(apiPrefix.length)
      .split("/")
      .map((s) => decodeURIComponent(s))
      .join("/");
  }
  // A data: URL or remote http(s) bg has no on-disk file we can hand to Read.
  if (/^(data:|https?:)/i.test(value)) return null;
  // Otherwise treat it as already work-relative ("assets/images/x.png").
  return value.replace(/^\/+/, "");
}

function pickSlide(carousel: Carousel, slideId?: string): Slide {
  if (!slideId) return carousel.slides[0];
  const found = carousel.slides.find((s) => s.id === slideId);
  if (!found) {
    throw new Error(
      `slide "${slideId}" not found in carousel (have: ${carousel.slides
        .map((s) => s.id)
        .join(", ")})`,
    );
  }
  return found;
}

/**
 * Best-effort: find an already-exported page image for the slide at 1-based,
 * zero-padded `page` ("01", "02", ...). The frontend exporter normally
 * downloads pages to the user's Downloads (not workDir/output), so this only
 * matches when a real export-to-disk set is present. We glob
 * output/*.{png,jpg,webp} sorted by name (mirroring routes/_shared.ts) and pick
 * the file whose name ends with the page suffix, so any naming scheme the
 * exporter lands on (<id>-NN / page-NN / slide-NN) resolves. Returns the
 * absolute path or null.
 */
async function firstExportedPage(
  workDir: string,
  page: string,
): Promise<string | null> {
  const outDir = join(workDir, "output");
  let names: string[];
  try {
    names = (await readdir(outDir))
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort();
  } catch {
    return null; // no output/ dir yet
  }
  const match = names.find((f) => {
    const base = f.replace(/\.[^.]+$/, "");
    return base.endsWith(page) || base.endsWith(`-${page}`);
  });
  return match ? join(outDir, match) : null;
}

async function snapshotCarousel(
  root: string,
  ctx: SnapshotContext,
): Promise<SnapshotResult> {
  const carousel = await readCarouselFor({
    workId: ctx.workId,
    worksRoot: root,
  });
  const slide = pickSlide(carousel, ctx.slide);
  const index = carousel.slides.indexOf(slide); // 0-based
  const workDir = join(root, ctx.workId);

  // 1) Prefer an already-exported composited page for this slide, if one
  //    happens to exist in output/ — that IS a faithful deliverable with text
  //    layers baked in. NOTE: the current frontend exporter downloads pages to
  //    the user's Downloads, NOT workDir/output, so this is best-effort and
  //    rare; we only match when a real export-to-disk set is present. The
  //    browser exporter names pages 1-based, zero-padded, so we glob
  //    output/*.{png,jpg,webp} sorted by name and index by slide position.
  const page = String(index + 1).padStart(2, "0");
  const exported = await firstExportedPage(workDir, page);
  if (exported) {
    return { path: exported, kind: "carousel-slide", textLayersComposited: true };
  }

  // 2) Fall back to the slide's background image on disk (the visual base
  //    ONLY — text/shape/sticker layers are composited by the browser's Konva
  //    canvas, never server-side, so they are NOT in this PNG). We flag this as
  //    base-only so the agent doesn't infer text layout/overflow from it.
  const rel = bgImageAssetRel(ctx.workId, slide.bg);
  if (rel) {
    // rel already includes its root segment ("assets/..." or "output/...").
    const abs = join(workDir, rel);
    if (await exists(abs)) {
      return { path: abs, kind: "carousel-slide", textLayersComposited: false };
    }
  }

  throw new Error(
    `no snapshot artifact for slide "${slide.id}" — its background isn't an on-disk image and no exported page exists yet. Export the carousel (or set an image background) before snapshotting.`,
  );
}

async function snapshotVideo(
  root: string,
  ctx: SnapshotContext,
): Promise<SnapshotResult> {
  const comp = await readCompositionFor({
    workId: ctx.workId,
    worksRoot: root,
  });
  // CRITICAL (E2E 2026-06-04): rewrite relative clip srcs to absolute
  // http://localhost:<port>/api/works/... URLs, EXACTLY as the mp4 export path
  // does before rendering (render-pipeline.ts). Headless Chromium has no page
  // origin to resolve a relative "/api/works/..."/"assets/..." src against, so
  // without this the still hangs forever loading <Html5Video> and times out.
  // This is what makes "snapshot ≡ the deliverable frame" actually hold.
  const compForRender = rewriteClipSrcsToAbsolute(comp);
  // Current playhead unless an explicit --at was given. focus.playheadSec is
  // process-local and mirrors the user's literal viewport.
  const atSec = ctx.at ?? readFocus(ctx.workId).playheadSec ?? 0;
  const frame = Math.round(Math.max(0, atSec) * comp.fps);

  const outDir = join(root, ctx.workId, "output");
  await mkdir(outDir, { recursive: true });
  // Deterministic, overwritten name — a snapshot is a transient self-check, not
  // a versioned deliverable; we don't want N stale snapshot-*.png piling up.
  const outFile = join(outDir, `snapshot-frame-${frame}.png`);
  await renderCompositionStill(
    compForRender as unknown as {
      duration: number;
      fps: number;
      width: number;
      height: number;
      title?: string;
    },
    { outFile, frame },
  );
  // Faithful by construction: the Remotion still is the same Scene as the mp4
  // render, so every overlay/text layer is composited into the PNG.
  return { path: outFile, kind: "video-still", textLayersComposited: true };
}

/**
 * Capture the current frame (video) or slide (carousel) as a PNG and return its
 * absolute path. The caller (bridge POST /snapshot) hands the path back to the
 * CLI, which prints it so the agent can Read it.
 */
export async function renderSnapshot(
  ctx: SnapshotContext,
): Promise<SnapshotResult> {
  const root = resolveWorksRoot(ctx);
  const kind = await detectKind(root, ctx.workId);
  return kind === "video"
    ? snapshotVideo(root, ctx)
    : snapshotCarousel(root, ctx);
}
