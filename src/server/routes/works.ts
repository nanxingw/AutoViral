// Works domain sub-router (I11): works CRUD, composition + carousel
// read/write/gc, chat / session / abort / invoke, checkpoints, text-rewrite,
// and the D3/rubric 410-gone stubs. Split verbatim from api.ts — no
// behaviour/path change.

import { Hono } from "hono";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import yaml from "js-yaml";
import { loadConfig, dataDir } from "../../infra/config.js";
import {
  listWorks, getWork, createWork as storeCreateWork,
  updateWork as storeUpdateWork, deleteWork as storeDeleteWork,
  listAssets,
} from "../../domain/work-store.js";
import { isWorkType } from "../../shared/content-types/registry.js";
import {
  type Composition,
  CompositionSchema,
  migrateLegacyTrackIds,
} from "../../shared/composition.js";
import { SAFE_ID, resolveAssetFile, UnsafePathError } from "../safe-paths.js";
import { uiEventBus } from "../bridge/ui-events.js";
import { listCheckpoints, restoreCheckpoint, createCheckpoint } from "../checkpoints.js";
import {
  getWsBridge,
  getRenderQueue,
  cancelInFlightRenders,
  synthesiseLegacyComposition,
  synthesiseLegacyAssetsAndProvenance,
  synthesiseLegacyCarousel,
} from "./_shared.js";
import { DEFAULT_CHAT_SESSION_ID } from "../../ws-bridge.js";

export const worksRouter = new Hono();

// ---------------------------------------------------------------------------
// Work API
// ---------------------------------------------------------------------------

// GET /api/works — list works with cover image from first asset
worksRouter.get("/api/works", async (c) => {
  try {
    const works = await listWorks();
    // Attach coverImage: prefer output image, then any image, then final video as last resort
    const enriched = await Promise.all(works.map(async (w) => {
      try {
        const assets = await listAssets(w.id);
        // 1. Output image (thumbnail/cover)
        const outputImage = assets.find((a: string) =>
          /\.(png|jpe?g|webp|gif)$/i.test(a) && a.startsWith("output/")
        );
        if (outputImage) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${outputImage.split("/").map(encodeURIComponent).join("/")}` };
        }
        // 2. Any asset image
        const firstImage = assets.find((a: string) =>
          /\.(png|jpe?g|webp|gif)$/i.test(a)
        );
        if (firstImage) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${firstImage.split("/").map(encodeURIComponent).join("/")}` };
        }
        // 3. Final video — fallback, rendered as <video> on frontend
        const finalVideo = assets.find((a: string) =>
          /\.(mp4|mov|webm)$/i.test(a) && /final/i.test(a)
        );
        if (finalVideo) {
          return { ...w, coverImage: `/api/works/${w.id}/assets/${finalVideo.split("/").map(encodeURIComponent).join("/")}`, coverIsVideo: true };
        }
      } catch {}
      return w;
    }));
    return c.json({ works: enriched });
  } catch {
    return c.json({ works: [] });
  }
});

// POST /api/works
worksRouter.post("/api/works", async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      type: string;
      contentCategory?: string;
      videoSource?: string;
      videoSearchQuery?: string;
      platforms: string[];
      topicHint?: string;
    }>();
    // #83 — title is optional: a blank work stores an EMPTY title and the
    // UI localizes the "未命名/Untitled" placeholder at render time (baking
    // the localized string in froze its language to creation-time locale).
    if (!body.type || !body.platforms) {
      return c.json({ error: "type and platforms are required", errorCode: "create_work_validation" }, 400);
    }
    // I06 / ADR-006 — validate the work type against the registry at the trust
    // boundary instead of an unchecked cast to the bare literal union.
    if (!isWorkType(body.type)) {
      return c.json({ error: "unknown work type", errorCode: "create_work_validation" }, 400);
    }
    const work = await storeCreateWork({
      title: body.title ?? "",
      type: body.type,
      contentCategory: body.contentCategory as any,
      videoSource: body.videoSource as any,
      videoSearchQuery: body.videoSearchQuery,
      platforms: body.platforms,
      topicHint: body.topicHint,
    });
    return c.json(work, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to create work", errorCode: "create_work_failed", detail: err instanceof Error ? err.message : undefined }, 400);
  }
});

// GET /api/works/:id
worksRouter.get("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    return c.json(work);
  } catch {
    return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  }
});

// PUT /api/works/:id
worksRouter.put("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json();
    const work = await storeUpdateWork(id, body);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    return c.json(work);
  } catch {
    return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  }
});

// DELETE /api/works/:id — cascades: cancels in-flight render jobs, kills active
// CLI session (if creating), then rm -rf work dir.
// Order matters: BOTH concurrent writers into works/<id>/ must be stopped before
// storeDeleteWork rm -rf's it — the CLI subprocess (chat.jsonl) AND the render
// worker (output/ frames). Stopping writers first avoids ENOENT crashes and
// zombie output dirs re-created by a still-running render after deletion (#63).
worksRouter.delete("/api/works/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    // #63 — stop the render worker writing into this work dir before rm -rf.
    const renderQueue = getRenderQueue();
    if (renderQueue) {
      cancelInFlightRenders(renderQueue, id);
    }
    const wsBridge = getWsBridge();
    if (work.cliSessionId && wsBridge) {
      wsBridge.killSession(id);
    }
    const deleted = await storeDeleteWork(id);
    if (!deleted) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
    return c.json({ deleted: true });
  } catch {
    return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  }
});

// GET /api/works/:id/composition — returns composition.yaml as JSON.
// For legacy works (created before Plan 2's composition format), no
// composition.yaml exists yet but the work usually has assets/clips/ + assets/music/
// + output/final*.mp4. Synthesise a starter composition from those assets so the
// user sees their content immediately on first open. Persisted only when the
// client autosaves.
worksRouter.get("/api/works/:id/composition", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  // Return 404 only on ENOENT; corrupt YAML or read errors must not silently
  // become "no composition" — the client treats null as "fresh" and would
  // overwrite the broken file with an empty composition. (Codex review 2026-04-27)
  try {
    const raw = await readFile(
      join(dataDir, "works", id, "composition.yaml"),
      "utf-8",
    );
    // Phase D (issue #31) — migrate pre-Phase-D track ids (`video-0` etc.)
    // to `trk_<uuid>` + displayOrder before zod sees them. Schema is strict
    // post-Phase-D; the migration keeps legacy yaml round-trippable.
    const migrated = migrateLegacyTrackIds(yaml.load(raw));
    const parsed = CompositionSchema.parse(migrated);
    return c.json(synthesiseLegacyAssetsAndProvenance(parsed));
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      return c.json({ error: `Composition unreadable: ${err?.message ?? "unknown"}`, errorCode: "composition_unreadable", detail: err?.message }, 500);
    }
    // Legacy auto-build path
    const synthesised = await synthesiseLegacyComposition(id, w.type);
    if (synthesised) {
      const parsedSynth = CompositionSchema.parse(synthesised);
      return c.json(synthesiseLegacyAssetsAndProvenance(parsedSynth));
    }
    return c.json({ error: "Composition not found", errorCode: "composition_not_found" }, 404);
  }
});

// PUT /api/works/:id/composition — persists composition as yaml
worksRouter.put("/api/works/:id/composition", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const body = await c.req.json();
  const parsed = CompositionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Composition schema invalid", issues: parsed.error.issues },
      400,
    );
  }
  const wDir = join(dataDir, "works", id);
  await mkdir(wDir, { recursive: true });
  await writeFile(
    join(wDir, "composition.yaml"),
    yaml.dump(parsed.data, { lineWidth: -1 }),
    "utf-8",
  );
  return c.json({ ok: true });
});

// GET /api/works/:id/plan/script.md — returns the narrative-outline 剧本
// (plan/script.md) as raw markdown text.
//
// S5 (PRD-0007 §4.5). The 剧本 is the planning-layer PRD: a first-class,
// read/write, watch-refreshable artifact twinning composition.yaml. When the
// file does NOT exist yet we return an EMPTY string (200) — we MUST NOT
// synthesise a starter template in any language: baking a localized template
// into stored data freezes its language to write-time locale (#73/#83
// i18n-string-as-data鐵律). The frontend renders its own empty-state copy
// from an empty body.
worksRouter.get("/api/works/:id/plan/script.md", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId", errorCode: "work_not_found" }, 404);
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  let target: string;
  try {
    // Single safe basename under the per-work plan/ root — traversal-guarded.
    target = resolveAssetFile(id, "plan", "script.md");
  } catch (err) {
    if (err instanceof UnsafePathError) return c.json({ error: "Invalid path", errorCode: "work_not_found" }, 404);
    throw err;
  }
  try {
    const raw = await readFile(target, "utf-8");
    return c.body(raw, 200, { "content-type": "text/markdown; charset=utf-8" });
  } catch (err: any) {
    // ENOENT → no script.md written yet → empty body, NOT a template.
    if (err?.code === "ENOENT") {
      return c.body("", 200, { "content-type": "text/markdown; charset=utf-8" });
    }
    return c.json({ error: `Script unreadable: ${err?.message ?? "unknown"}`, errorCode: "script_unreadable", detail: err?.message }, 500);
  }
});

// PUT /api/works/:id/plan/script.md — persists the body (raw markdown) to
// plan/script.md (mkdir -p plan/) and broadcasts "plan-changed" on the
// uiEventBus so Studio refetches WITHOUT a reload. The broadcast mirrors the
// composition write-path signal (the explicit "disk changed" event that
// supplements the fs.watch path which can miss atomic renames on macOS).
worksRouter.put("/api/works/:id/plan/script.md", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId", errorCode: "work_not_found" }, 404);
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  // Body is raw markdown text — read it as text, not JSON.
  const md = await c.req.text();
  let target: string;
  try {
    target = resolveAssetFile(id, "plan", "script.md");
  } catch (err) {
    if (err instanceof UnsafePathError) return c.json({ error: "Invalid path", errorCode: "work_not_found" }, 404);
    throw err;
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, md, "utf-8");
  // Mirror composition's write-path broadcast: announce the on-disk change so
  // the Studio script editor refetches live (twin of composition-changed).
  uiEventBus.publish(id, { type: "plan-changed", workId: id, ts: Date.now(), payload: null });
  return c.json({ ok: true });
});

// POST /api/works/:id/composition/gc-orphans — garbage-collect AssetEntries
// whose physical files no longer exist on disk. After commit ad67b9b some
// works ended up with stale gen_* AssetEntries pointing at non-existent mp4s
// (e.g., the renderer would 404 every time). This endpoint:
//   1. Scans assets[] for video/image/audio kinds whose uri is a relative
//      work path (skips http/api/absolute uris — those are out of scope).
//   2. For each, tries both <wDir>/<uri> and <wDir>/assets/<uri> (uri shapes
//      vary across the codebase: some are "clips/foo.mp4", some are
//      "assets/clips/foo.mp4"). Marks asset status="failed" if both miss.
//   3. Removes any timeline clip referencing the orphan asset's uri.
//   4. Removes provenance edges whose toAssetId == an orphan id (orphan
//      edges break the dive view).
// Idempotent: re-running on the same composition produces the same result
// (status==="failed" is left as-is, clips already removed stay removed).
worksRouter.post("/api/works/:id/composition/gc-orphans", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const wDir = join(dataDir, "works", id);
  const compYamlPath = join(wDir, "composition.yaml");
  let raw: string;
  try {
    raw = await readFile(compYamlPath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return c.json({ error: "Composition not found", errorCode: "composition_not_found" }, 404);
    return c.json({ error: `Composition unreadable: ${err?.message ?? "unknown"}`, errorCode: "composition_unreadable", detail: err?.message }, 500);
  }
  let comp: Composition;
  try {
    comp = yaml.load(raw) as Composition;
  } catch (err: any) {
    return c.json({ error: `Composition YAML invalid: ${err?.message ?? "unknown"}`, errorCode: "composition_yaml_invalid", detail: err?.message }, 500);
  }

  const { existsSync } = await import("node:fs");

  // Skip uris that are absolute, http, or backed by /api/ — only
  // work-relative paths can be GC'd here (anything else is unverifiable).
  const isLocalRelativeUri = (uri: string): boolean => {
    if (!uri) return false;
    if (uri.startsWith("http://") || uri.startsWith("https://")) return false;
    if (uri.startsWith("/api/")) return false;
    if (uri.startsWith("/")) return false;
    return true;
  };

  const fileExistsForUri = (uri: string): boolean => {
    // Try BOTH <wDir>/<uri> and <wDir>/assets/<uri> (existing AssetEntry.uri
    // shapes vary). Either match → asset is considered live.
    const direct = join(wDir, uri);
    if (existsSync(direct)) return true;
    if (!uri.startsWith("assets/")) {
      const underAssets = join(wDir, "assets", uri);
      if (existsSync(underAssets)) return true;
    }
    return false;
  };

  const orphans: string[] = [];
  let marked = 0;
  const orphanUris = new Set<string>();
  const assets = comp.assets ?? [];
  for (const a of assets) {
    if (!(a.kind === "video" || a.kind === "image" || a.kind === "audio")) continue;
    if (!isLocalRelativeUri(a.uri)) continue;
    if (fileExistsForUri(a.uri)) continue;
    orphans.push(a.id);
    orphanUris.add(a.uri);
    if (a.status !== "failed") {
      a.status = "failed";
      marked += 1;
    }
  }

  // Remove clips referencing orphan uris. We match by clip.src equality
  // against orphan asset uris — both raw work-relative and the
  // /api/works/:id/assets/<uri> URL shape are checked because the legacy
  // synthesiser writes the URL form into clip.src.
  const orphanClipSrcs = new Set<string>();
  for (const u of orphanUris) {
    orphanClipSrcs.add(u);
    orphanClipSrcs.add(`/api/works/${id}/assets/${u}`);
    if (u.startsWith("assets/")) {
      const stripped = u.slice("assets/".length);
      orphanClipSrcs.add(stripped);
      orphanClipSrcs.add(`/api/works/${id}/assets/${stripped}`);
    }
  }
  let removed = 0;
  for (const track of comp.tracks ?? []) {
    const before = track.clips.length;
    track.clips = track.clips.filter((clip) => {
      if (clip.kind === "text") return true;
      const src = (clip as { src?: string }).src;
      if (!src) return true;
      return !orphanClipSrcs.has(src);
    });
    removed += before - track.clips.length;
  }

  // Drop provenance edges whose toAssetId points at an orphan — the dive
  // view treats these as broken nodes.
  const orphanIdSet = new Set(orphans);
  if (comp.provenance) {
    comp.provenance = comp.provenance.filter((edge) => !orphanIdSet.has(edge.toAssetId));
  }

  await writeFile(compYamlPath, yaml.dump(comp, { lineWidth: -1 }), "utf-8");

  return c.json({ removed, marked, orphans });
});

// GET /api/works/:id/carousel — returns carousel.yaml as JSON
worksRouter.get("/api/works/:id/carousel", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  try {
    const raw = await readFile(
      join(dataDir, "works", id, "carousel.yaml"),
      "utf-8",
    );
    return c.json(yaml.load(raw));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // No persisted carousel — try to synthesise one from output/*.png
      // (the user's already-finished carousel images). Mirrors the legacy
      // composition fallback on the video deliverable path.
      const synthesised = await synthesiseLegacyCarousel(id, w.type);
      if (synthesised) return c.json(synthesised);
      return c.json({ error: "Carousel not found", errorCode: "carousel_not_found" }, 404);
    }
    return c.json({ error: `Carousel unreadable: ${err?.message ?? "unknown"}`, errorCode: "carousel_unreadable", detail: err?.message }, 500);
  }
});

// PUT /api/works/:id/carousel — persists carousel as yaml
worksRouter.put("/api/works/:id/carousel", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id);
  if (!w) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);
  const body = await c.req.json();
  const wDir = join(dataDir, "works", id);
  await mkdir(wDir, { recursive: true });
  await writeFile(
    join(wDir, "carousel.yaml"),
    yaml.dump(body, { lineWidth: -1 }),
    "utf-8",
  );
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Work Chat API (WsBridge)
// ---------------------------------------------------------------------------

// POST /api/works/:id/abort — abort running task for a work
worksRouter.post("/api/works/:id/abort", async (c) => {
  const id = c.req.param("id");
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);
  const killed = wsBridge.killSession(id);
  return c.json({ aborted: killed });
});

// POST /api/works/:id/session
worksRouter.post("/api/works/:id/session", async (c) => {
  const id = c.req.param("id");
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const session = wsBridge.getSession(id);
    if (session?.cliProcess) {
      return c.json({ status: "already_running", workId: id });
    }

    const work = await getWork(id);
    if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);

    const prompt = [
      `你是一个内容创作助手。你正在帮助用户创作："${work.title}"（类型：${work.type}）。`,
      `目标平台：${work.platforms.map((p: any) => typeof p === "string" ? p : p.platform).join(", ")}。`,
      work.topicHint ? `选题方向：${work.topicHint}` : "",
      ``,
      `先和用户简短打个招呼，问一句他想从哪开始（趋势调研 / 直接做素材 / 已经有 brief / 想拼成片）。`,
      `不要预设流程，按用户意图直接动手。`,
    ].filter(Boolean).join("\n");

    const config = await loadConfig();
    await wsBridge.createSession(id, prompt, config.model);
    return c.json({ status: "started", workId: id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Session start error" }, 500);
  }
});

// POST /api/agent/model — switch the creative agent's model TIER.
//
// We persist the short ALIAS (opus/sonnet/haiku), never a pinned version. The
// Claude Code CLI resolves the alias to the latest member of that family at
// spawn time (`--model opus` → whatever the current Opus is), so the user picks
// a tier and the version auto-follows — they never choose "4.7 vs 4.8".
//
// The model is bound when the CLI session spawns (--model), so a LIVE session
// keeps whatever tier it started with. When a workId is supplied we kill that
// work's session so the next message respawns on the new tier; the badge in the
// UI updates immediately and the switch takes effect on the user's next turn.
const AGENT_MODEL_ALIASES = ["opus", "sonnet", "haiku"] as const;
worksRouter.post("/api/agent/model", async (c) => {
  const body = await c.req.json().catch(() => null);
  const model = body && typeof body.model === "string" ? body.model : "";
  if (!(AGENT_MODEL_ALIASES as readonly string[]).includes(model)) {
    return c.json(
      { error: "Invalid model alias", errorCode: "invalid_model_alias", allowed: AGENT_MODEL_ALIASES },
      400,
    );
  }
  const config = await loadConfig();
  config.model = model;
  const { saveConfig } = await import("../../infra/config.js");
  await saveConfig(config);
  // Respawn the work's session (if any) so the new tier takes effect next turn.
  const workId = body && typeof body.workId === "string" ? body.workId : null;
  let respawned = false;
  const wsBridge = getWsBridge();
  if (workId && SAFE_ID.test(workId) && wsBridge) {
    respawned = wsBridge.killSession(workId);
  }
  return c.json({ ok: true, model, respawned });
});

// POST /api/works/:id/chat
worksRouter.post("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<{ text: string }>();
    if (!body.text) return c.json({ error: "text is required" }, 400);

    let session = wsBridge.getSession(id);
    if (!session) {
      const config = await loadConfig();
      session = await wsBridge.createSession(id, body.text, config.model);
      // Record the first user message in chat history — createSession only sends
      // the prompt to the CLI; it does NOT append a user block to messageHistory
      // or chat.jsonl. Without this, persisted chat starts at the agent's first
      // turn, missing the user's opening line. (Codex review 2026-04-27)
      wsBridge.recordUserMessage(id, body.text);
      return c.json({ sent: true, sessionCreated: true, workId: id });
    }

    const sent = await wsBridge.sendMessage(id, body.text);
    if (!sent) return c.json({ error: "Failed to send message" }, 500);
    return c.json({ sent: true, workId: id });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Chat error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Multi-session API (ADR-008 §5 / I24) — list / create / delete chat sessions.
//
// I23 landed the WsBridge session model (nested Map<workId, Map<sessionId>>,
// `.sessions.jsonl` sidecar, /ws/browser/{workId}/{sessionId} routing) plus the
// public listSessions / createNewSession / deleteSession methods, but with NO
// HTTP surface — the frontend session strip (I24) needs one to drive them. These
// three routes are that surface. They reuse the SAME WsBridge singleton the
// server constructs (getWsBridge) so live in-memory sessions and the sidecar
// stay consistent; they never `new WsBridge()`.
// ---------------------------------------------------------------------------

// GET /api/works/:id/sessions — list the work's chat sessions (active, not
// archived/deleted). On a legacy single-session work the bridge lazily migrates
// the old cliSessionId/chat.jsonl into an `s_1` record before returning.
worksRouter.get("/api/works/:id/sessions", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId", errorCode: "invalid_work_id" }, 400);
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);
  const sessions = await wsBridge.listSessions(id);
  return c.json({ sessions });
});

// POST /api/works/:id/sessions — mint a brand-new chat session (next s_N) and
// persist its sidecar record. Returns the new record so the client can switch
// to it immediately. Does NOT spawn a CLI — the first message on that session
// does. 503 if the bridge isn't wired (no sidecar dir → null record).
worksRouter.post("/api/works/:id/sessions", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId", errorCode: "invalid_work_id" }, 400);
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);
  const session = await wsBridge.createNewSession(id);
  if (!session) return c.json({ error: "Failed to create session", errorCode: "session_create_failed" }, 503);
  return c.json({ session }, 201);
});

// DELETE /api/works/:id/sessions/:sessionId — hard-delete a chat session: dispose
// its in-memory WsSession + CLI, tombstone the sidecar record, and remove its
// chat log. ANY session is deletable (incl. the default s_1) as long as one
// would remain — we only refuse to delete the LAST session so the work always
// keeps at least one conversation.
worksRouter.delete("/api/works/:id/sessions/:sessionId", async (c) => {
  const id = c.req.param("id");
  const sessionId = c.req.param("sessionId");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId", errorCode: "invalid_work_id" }, 400);
  if (!SAFE_ID.test(sessionId)) return c.json({ error: "Invalid sessionId", errorCode: "invalid_session_id" }, 400);
  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);
  // Last-session guard: count active sessions (listSessions lazily migrates the
  // legacy s_1 record on first call) and refuse the delete if removing this one
  // would leave zero conversations.
  const sessions = await wsBridge.listSessions(id);
  if (sessions.some((s) => s.id === sessionId) && sessions.length <= 1) {
    return c.json(
      { error: "Cannot delete the last remaining session", errorCode: "session_delete_last" },
      400,
    );
  }
  const deleted = await wsBridge.deleteSession(id, sessionId);
  if (!deleted) return c.json({ error: "Session not found", errorCode: "session_not_found" }, 404);
  return c.json({ deleted: true });
});

// ── Module-as-capability invocation ─────────────────────────────────────────

const KNOWN_MODULES = ["research", "planning", "assets", "assembly"] as const;
type ModuleName = (typeof KNOWN_MODULES)[number];

// POST /api/works/:id/invoke — module-as-capability dispatcher (no ordering)
worksRouter.post("/api/works/:id/invoke", async (c) => {
  const id = c.req.param("id");
  let body: { module?: string; input?: unknown } = {};
  try {
    body = await c.req.json<{ module?: string; input?: unknown }>();
  } catch {
    // empty body — fall through to validation below
  }
  const mod = body.module as ModuleName | undefined;
  if (!mod || !KNOWN_MODULES.includes(mod)) {
    return c.json({ error: `module must be one of ${KNOWN_MODULES.join("|")}` }, 400);
  }

  const work = await getWork(id);
  if (!work) return c.json({ error: "Work not found", errorCode: "work_not_found" }, 404);

  const wsBridge = getWsBridge();
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 500);

  const userBrief = typeof body.input === "string"
    ? body.input
    : body.input != null ? JSON.stringify(body.input) : "(no extra brief)";
  const message = [
    `请使用 \`${mod}\` 模块的能力处理当前作品。`,
    `用户附带的输入：${userBrief}`,
    `这是一次能力调用，按你判断完成本次工作即可。`,
  ].join("\n");

  const config = await loadConfig();
  let session = wsBridge.getSession(id);
  if (!session) {
    await wsBridge.createSession(id, message, config.model);
  } else {
    await wsBridge.sendMessage(id, message);
  }

  return c.json({ triggered: true, workId: id, module: mod }, 202);
});

// GET /api/works/:id/rubric/:module — read-only rubric tool (agent self-eval).
// Returns the generic taste rubric concatenated with module-specific criteria
// (if a file exists). The agent decides whether/how to apply scores; this
// endpoint never writes state and never blocks.
//
// Removed in agentic-terminal refactor (2026-05-14). Editorial taste rubrics
// are no longer part of AutoViral the workstation — they're commodity sibling-
// skill content. The pre-skill-rewrite-snapshot git tag preserves the original
// rubric markdown if anyone wants to package them as a separate skill.
worksRouter.all("/api/works/:id/rubric/:module", (c) =>
  c.json({
    error: "Endpoint removed in agentic-terminal refactor. Editorial taste rubrics moved out of AutoViral. See git tag pre-skill-rewrite-snapshot.",
    errorCode: "rubric_endpoint_removed",
  }, 410),
);

// ── Legacy stage-coupled routes — removed in D3 cleanup. Always 410 Gone. ──
// Migration target: POST /api/works/:id/invoke {module, input}
const D3_GONE_BODY = {
  error: "This endpoint was removed (D3). Use POST /api/works/:id/invoke {module, input} instead.",
};

worksRouter.all("/api/works/:id/step/:step", (c) => c.json(D3_GONE_BODY, 410));
worksRouter.all("/api/works/:id/pipeline/advance", (c) => c.json(D3_GONE_BODY, 410)); // D3-OK: 410 stub path
worksRouter.all("/api/works/:id/evaluation-mode", (c) => c.json(D3_GONE_BODY, 410));
worksRouter.all("/api/works/:id/eval/toggle", (c) => c.json(D3_GONE_BODY, 410));
worksRouter.all("/api/works/:id/eval/force-pass", (c) => c.json(D3_GONE_BODY, 410));
worksRouter.all("/api/works/:id/eval/retry", (c) => c.json(D3_GONE_BODY, 410));
worksRouter.all("/api/works/:id/eval/results/:step", (c) => c.json(D3_GONE_BODY, 410));
worksRouter.all("/api/works/:id/steps/:step/history", (c) => c.json(D3_GONE_BODY, 410));

// GET /api/works/:id/chat — load full conversation for ONE chat session.
// The optional `?sessionId=` selects which session's log to read (ADR-008 §4 /
// I24). Defaults to the legacy default session so single-session callers are
// unchanged. Making this session-aware keeps the HTTP seed in agreement with
// the WS `message_history` reseed — without it, a reload of a work whose
// active session is non-default would briefly show the default session's
// bubbles (last-writer-wins race between the two seed paths).
worksRouter.get("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  const sessionParam = c.req.query("sessionId");
  const sessionId =
    sessionParam && SAFE_ID.test(sessionParam) ? sessionParam : DEFAULT_CHAT_SESSION_ID;
  try {
    const { loadWorkChat } = await import("../../domain/work-store.js");
    const chat = await loadWorkChat(id, sessionId);
    // An empty non-default session has no log yet — return [] (not 404) so the
    // client seed clears any stale blocks and the WS reseed stays authoritative.
    if (!chat) {
      return sessionId === DEFAULT_CHAT_SESSION_ID
        ? c.json({ error: "No chat history" }, 404)
        : c.json({ blocks: [] });
    }
    return c.json(chat);
  } catch {
    return c.json({ error: "No chat history" }, 404);
  }
});

// PUT /api/works/:id/chat — save full conversation
worksRouter.put("/api/works/:id/chat", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  try {
    const { saveWorkChat } = await import("../../domain/work-store.js");
    await saveWorkChat(id, body);
    return c.json({ saved: true });
  } catch {
    return c.json({ error: "Save failed" }, 500);
  }
});

/**
 * POST /api/works/:id/text-rewrite — synchronous text rewrite via OpenRouter.
 *
 * The Inspector's Copy tab needs an immediate { text } response so it can
 * splice the new copy back into the layer. The agent-based /invoke route
 * is async (202 + chat-stream), which doesn't fit that UX. This endpoint
 * is a thin pass-through to OpenRouter chat-completions; falls back to
 * 503 if no openrouter.apiKey is configured.
 */
worksRouter.post("/api/works/:id/text-rewrite", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);

  const body = await c.req
    .json<{ current?: string; intent?: string }>()
    .catch(() => ({} as { current?: string; intent?: string }));
  const current = (body.current ?? "").trim();
  if (!current) return c.json({ error: "Missing 'current' text to rewrite" }, 400);

  const config = await loadConfig();
  const apiKey = config.openrouter?.apiKey;
  if (!apiKey) return c.json({ error: "openrouter.apiKey not configured" }, 503);

  const intent = body.intent ?? "rewrite";
  const sys =
    "You rewrite Chinese social-media headlines/captions for editorial small-red-book style. " +
    "Return ONLY the rewritten text — no preamble, no quotes, no labels. " +
    "Keep length close to the original (±20%). Preserve tone unless told otherwise.";
  const usr = intent === "rewrite-copy"
    ? `请重写下面这段文案，保持原意但更有节奏感：\n\n${current}`
    : `请基于「${intent}」改写：\n\n${current}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3271",
    },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    return c.json({ error: `OpenRouter ${res.status}: ${errBody.slice(0, 300)}` }, 502);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) return c.json({ error: "OpenRouter returned no text" }, 502);
  return c.json({ text });
});

// GET /api/works/:id/checkpoints — list yaml snapshots for a work, newest first.
// Snapshots are taken automatically on every agent turn_complete; this is the
// read side of that. UI uses it to render a "history" dropdown for rollback.
worksRouter.get("/api/works/:id/checkpoints", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const items = await listCheckpoints(id);
  return c.json({ items });
});

// POST /api/works/:id/checkpoints/restore — overwrite the live deliverable
// with a previously-snapshotted yaml. Body: { file: "<filename>" }. The
// filename is what GET returned in `items[].file`.
worksRouter.post("/api/works/:id/checkpoints/restore", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const body = await c.req
    .json<{ file?: string }>()
    .catch(() => ({} as { file?: string }));
  const file = ((body.file as string | undefined) ?? "").trim();
  if (!file) return c.json({ error: "Missing 'file'" }, 400);
  const out = await restoreCheckpoint(id, file);
  if (!out) return c.json({ error: "Checkpoint not found or invalid name" }, 404);
  // #68 — preRestoreSnapshot lets the client confirm the restore is reversible
  // (current state was auto-snapshotted before the overwrite).
  return c.json({ ok: true, deliverable: out.deliverable, preRestoreSnapshot: out.preRestoreSnapshot });
});

// POST /api/works/:id/checkpoints — manual snapshot trigger. Useful before
// the user is about to ask the agent for a risky change. Idempotent: if the
// yaml hasn't changed since the latest snapshot, returns an empty list.
worksRouter.post("/api/works/:id/checkpoints", async (c) => {
  const id = c.req.param("id");
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  // #90 — optional user-supplied label. createCheckpoint trims/caps it and
  // treats empty as unlabelled, so passing through whatever the body holds
  // (or nothing) is safe.
  const body = await c.req
    .json<{ label?: string }>()
    .catch(() => ({} as { label?: string }));
  const written = await createCheckpoint(id, body.label);
  return c.json({ written });
});
