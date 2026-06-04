// Audio domain sub-router (I11): audio analysis, multi-track mixing, the
// retired beat endpoint, ASR caption generation, and TTS (both the legacy
// /api/audio/tts and the work-scoped dual-provider /api/works/:id/tts). Split
// verbatim from api.ts — no behaviour/path change.

import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../../infra/config.js";
import { analyzeAudio, mixAudioTracks } from "../../domain/audio-tools.js";
import { runAsrCaptions } from "../../domain/asr-captions.js";
import { generateWithFallback } from "../../providers/tts/registry.js";
import { uiEventBus } from "../bridge/ui-events.js";
import { resolveAssetPath, UnsafePathError, SAFE_ID } from "../safe-paths.js";

export const audioRouter = new Hono();

// POST /api/audio/analyze — detect audio properties of a clip
audioRouter.post("/api/audio/analyze", async (c) => {
  try {
    const body = await c.req.json();
    const { workId, assetPath } = body;
    if (!workId || !assetPath) {
      return c.json({ success: false, error: "Missing required fields (workId, assetPath)", code: "INVALID_PARAMS" }, 400);
    }
    if (!SAFE_ID.test(workId)) {
      return c.json({ success: false, error: "Invalid workId", code: "INVALID_PARAMS" }, 400);
    }
    // Resolve under workDir/assets/ or workDir/output/ — never raw workDir.
    // Path traversal hardening (Codex review 2026-04-27).
    let fullPath: string;
    try {
      const cleaned = String(assetPath).replace(/^\/+/, "");
      if (cleaned.startsWith("output/")) {
        fullPath = resolveAssetPath(workId, "output", cleaned.slice("output/".length));
      } else if (cleaned.startsWith("assets/")) {
        fullPath = resolveAssetPath(workId, "assets", cleaned.slice("assets/".length));
      } else {
        fullPath = resolveAssetPath(workId, "assets", cleaned);
      }
    } catch (err) {
      if (err instanceof UnsafePathError) {
        return c.json({ success: false, error: err.message, code: "INVALID_PATH" }, 400);
      }
      throw err;
    }
    const analysis = await analyzeAudio(fullPath);
    return c.json({ success: true, ...analysis });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/mix — multi-track audio mixing with ducking
audioRouter.post("/api/audio/mix", async (c) => {
  try {
    const body = await c.req.json();
    const { workId, videoPath, tracks, outputFilename } = body;

    // Validate required fields
    if (!workId || !videoPath || !tracks || !outputFilename) {
      return c.json(
        { success: false, error: "Missing required fields (workId, videoPath, tracks, outputFilename)", code: "INVALID_PARAMS" },
        400,
      );
    }
    if (!SAFE_ID.test(workId)) {
      return c.json({ success: false, error: "Invalid workId", code: "INVALID_PARAMS" }, 400);
    }
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return c.json(
        { success: false, error: "tracks must be a non-empty array", code: "INVALID_PARAMS" },
        400,
      );
    }

    // Path traversal hardening (Codex review 2026-04-27): resolve every user-supplied
    // path through resolveAssetPath. videoPath/track.source default to assets/ root;
    // outputFilename is restricted to a basename under output/.
    function resolveUnderWork(p: string): string {
      const cleaned = String(p).replace(/^\/+/, "");
      if (cleaned.startsWith("output/")) return resolveAssetPath(workId, "output", cleaned.slice(7));
      if (cleaned.startsWith("assets/")) return resolveAssetPath(workId, "assets", cleaned.slice(7));
      return resolveAssetPath(workId, "assets", cleaned);
    }

    let fullVideoPath: string;
    let fullOutputPath: string;
    let resolvedTracks: any[];
    let safeOutName: string;
    try {
      fullVideoPath = resolveUnderWork(videoPath);
      // outputFilename is a basename only — prevent traversal even if user passes "../foo"
      safeOutName = String(outputFilename).replace(/[/\\]/g, "_").replace(/^\.+/, "");
      if (!safeOutName) return c.json({ success: false, error: "Invalid outputFilename", code: "INVALID_PARAMS" }, 400);
      fullOutputPath = resolveAssetPath(workId, "output", safeOutName);
      resolvedTracks = tracks.map((t: any) => ({ ...t, source: resolveUnderWork(t.source) }));
    } catch (err) {
      if (err instanceof UnsafePathError) {
        return c.json({ success: false, error: err.message, code: "INVALID_PATH" }, 400);
      }
      throw err;
    }
    const { dirname: _dirname } = await import("node:path");
    await mkdir(_dirname(fullOutputPath), { recursive: true });

    await mixAudioTracks({
      videoPath: fullVideoPath,
      tracks: resolvedTracks,
      outputPath: fullOutputPath,
    });

    // Response uses the SANITIZED basename. Earlier version returned raw
    // outputFilename, which would break asset references AND leak the unsafe
    // input back to the client. (Codex round 2 finding #3)
    return c.json({
      success: true,
      assetPath: `output/${safeOutName}`,
      previewUrl: `/api/works/${workId}/assets/output/${encodeURIComponent(safeOutName)}`,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/beats — removed in agentic-terminal refactor (2026-05-14).
// Beat detection (detect_beats.py) was workstation infrastructure mis-placed
// in skills/. The script is preserved in git tag pre-skill-rewrite-snapshot;
// if anyone wants beat-snapping back, package it as a sibling skill and
// re-wire on a non-skills/ path.
audioRouter.all("/api/audio/beats", (c) =>
  c.json({
    success: false,
    error: "Endpoint removed in agentic-terminal refactor. Beat detection script lives in git tag pre-skill-rewrite-snapshot.",
    code: "beat_endpoint_removed",
  }, 410),
);

// POST /api/audio/captions — ASR caption generation (stable-ts/whisper).
// NOTE (S1止谎 2026-06-04): there is currently NO "caption import button" in
// Studio wired to this endpoint — the web client `fetchCaptions`
// (web/src/features/studio/services/captions.ts) has zero callers. This route
// exists for direct/agent use; do not document a UI surface that ships. Returns:
//   { success, captions: [{start, end, text}, ...] } when stable-ts works
//   503 with install hint when stable-ts/whisper not available
audioRouter.post("/api/audio/captions", async (c) => {
  try {
    const body = await c.req.json<{ workId?: string; assetPath?: string; language?: string }>();
    const { workId, assetPath, language } = body;
    if (!workId || !assetPath) return c.json({ success: false, error: "Missing workId/assetPath" }, 400);
    if (!SAFE_ID.test(workId)) return c.json({ success: false, error: "Invalid workId" }, 400);

    let fullPath: string;
    try {
      const cleaned = String(assetPath).replace(/^\/+/, "");
      const root = cleaned.startsWith("output/") ? "output" : "assets";
      const rest = cleaned.startsWith("output/") ? cleaned.slice(7)
                 : cleaned.startsWith("assets/") ? cleaned.slice(7)
                 : cleaned;
      fullPath = resolveAssetPath(workId, root, rest);
    } catch (err) {
      if (err instanceof UnsafePathError) return c.json({ success: false, error: err.message }, 400);
      throw err;
    }

    // S14 (US 20/21) — the ASR side-effect now lives in the shared
    // `runAsrCaptions` core (src/domain/asr-captions.ts) so the bridge
    // `POST /captions/generate` runs the EXACT same transcription path. This
    // route just maps the discriminated result onto its `success`/`code`
    // envelope (unchanged contract: 503 PYTHON_DEP_MISSING / 500 API_ERROR).
    const result = await runAsrCaptions(fullPath, language);
    if (!result.ok) {
      return c.json({ success: false, error: result.error, code: result.code }, result.status);
    }
    return c.json({ success: true, captions: result.captions });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});

// POST /api/audio/tts — TTS generation via the unified provider registry.
// PRD-0003 §2: this agent path used to call pickProvider().generate() directly,
// which was edge-only with NO fallback — asymmetric with the dialog endpoint
// below. It now goes through generateWithFallback so the agent shares the same
// Gemini(OpenRouter)→edge auto-fallback the dialog already had.
audioRouter.post("/api/audio/tts", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.text || !body.voice || !body.output_path) {
    return c.json(
      { error: "TTS request missing required fields", required: ["text", "voice", "output_path"] },
      400,
    );
  }
  const provider: "auto" | "gemini" | "edge-tts" =
    body.provider === "gemini" || body.provider === "edge-tts" ? body.provider : "auto";
  try {
    const r = await generateWithFallback(
      {
        text: String(body.text),
        voice: String(body.voice),
        language: typeof body.language === "string" ? body.language : undefined,
        style: typeof body.style === "string" ? body.style : undefined,
        outputPath: String(body.output_path),
      },
      { provider },
    );
    return c.json({
      ok: true,
      outputPath: r.outputPath,
      providerId: r.providerId,
      duration: r.duration,
      sampleRate: r.sampleRate,
      channels: r.channels,
    });
  } catch (e: any) {
    return c.json({ error: "TTS provider error", message: e?.message ?? String(e), errorCode: "tts_provider_error", detail: e?.message ?? String(e) }, 500);
  }
});

// POST /api/works/:id/tts — work-scoped dual-provider TTS (#3, PRD-0003 §2).
// Synthesizes narration into the work's assets/audio/ dir, broadcasts an
// "asset-added" UI event so the Studio library refreshes, then returns.
// Uses generateWithFallback: Gemini (OpenRouter) is tried first, edge-tts is
// the zero-key fallback.
audioRouter.post("/api/works/:id/tts", async (c) => {
  const id = c.req.param("id");
  // Guard the work id before it ever touches the filesystem — this endpoint
  // mkdir-creates + writes a file, so an unsanitized `../..` id would be a
  // write-side path traversal (strictly worse than a read). Same guard every
  // other works/:id write route in this file uses (Codex 2026-04-27 mandate).
  if (!SAFE_ID.test(id)) return c.json({ error: "Invalid workId" }, 400);
  const body = await c.req.json().catch(() => null);
  const text = body && typeof body.text === "string" ? body.text : "";
  const voice = body && typeof body.voice === "string" ? body.voice : "";
  if (!text || text.trim().length === 0) {
    return c.json({ error: "TTS request missing required field: text" }, 400);
  }
  if (!voice) {
    return c.json({ error: "TTS request missing required field: voice" }, 400);
  }
  const language = body && typeof body.language === "string" ? body.language : undefined;
  const provider: "auto" | "edge-tts" | "gemini" =
    body && (body.provider === "edge-tts" || body.provider === "gemini")
      ? body.provider
      : "auto";

  const { createHash } = await import("node:crypto");
  const workDir = join(dataDir, "works", id);
  const audioDir = join(workDir, "assets", "audio");
  await mkdir(audioDir, { recursive: true });
  const stem = createHash("sha1").update(`${voice}|${text}`).digest("hex").slice(0, 12);
  const filename = `tts_${stem}.mp3`;
  const outputPath = join(audioDir, filename);
  const relativeUri = `assets/audio/${filename}`;

  try {
    const result = await generateWithFallback({ text, voice, language, outputPath }, { provider });
    // Mirror broadcast() in bridge/routes.ts: same event shape + ts expression.
    uiEventBus.publish(id, {
      type: "asset-added",
      workId: id,
      ts: Date.now(),
      payload: { kind: "audio", uri: relativeUri, origin: "tts" },
    });
    return c.json({
      ok: true,
      relativeUri,
      providerId: result.providerId,
      durationSec: result.duration,
      voice,
    });
  } catch (e: any) {
    const detail = e?.message ?? String(e);
    return c.json({ error: "TTS provider error", errorCode: "tts_provider_error", detail }, 500);
  }
});
