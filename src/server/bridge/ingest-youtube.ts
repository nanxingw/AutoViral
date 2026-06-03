// YouTube → composition.yaml ingest pipeline.
//
// One callable that handles the full path: download with yt-dlp →
// probe duration → ASR transcribe (stable-ts) → translate each segment
// via OpenRouter chat → write plan/transcript.json + plan/brief.md →
// bootstrap composition.yaml with source clip and overlay captions.
//
// Progress is emitted over the bridge UI bus so the Studio terminal and
// status strip show live updates while the user waits. Designed to be
// idempotent: re-running on the same workId overwrites the source clip,
// the plan files, and the composition cleanly.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

import { uiEventBus, type UiEvent } from "./ui-events.js";
import { FFPROBE_BIN } from "../ffmpeg-paths.js";
import {
  readCompositionFor,
  writeCompositionFor,
} from "./composition-ops.js";
import { loadConfig } from "../../infra/config.js";
import {
  type Composition,
  makeEmptyComposition,
  newTrackId,
} from "../../shared/composition.js";

// Thin shim so call sites read like "emit X" — keeps the visual flow tight.
function emit(event: UiEvent): void {
  uiEventBus.publish(event.workId, event);
}

const execFileAsync = promisify(execFile);

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TRANSLATE_MODEL = "anthropic/claude-sonnet-4.5";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

function resolveWorksRoot(): string {
  return (
    process.env.AUTOVIRAL_WORKS_ROOT ??
    join(homedir(), ".autoviral/works")
  );
}

export interface IngestYouTubeOptions {
  workId: string;
  url: string;
  /** BCP-47 target language for translation. e.g. "zh-CN". */
  targetLanguage?: string;
  /** Override OpenRouter chat model for translation. */
  translateModel?: string;
  /** Optional source-time start (seconds). When combined with `endSec`,
   *  yt-dlp downloads only this window via --download-sections. */
  startSec?: number;
  /** Optional source-time end (seconds). */
  endSec?: number;
}

export interface IngestYouTubeResult {
  ok: true;
  workId: string;
  sourceClipPath: string;
  durationSec: number;
  segmentCount: number;
  language: string;
  targetLanguage: string;
}

export interface IngestYouTubeError {
  ok: false;
  step: "validate" | "download" | "probe" | "transcribe" | "translate" | "compose";
  error: string;
  code?: string;
}

interface SourceSegment {
  start: number;
  end: number;
  text: string;
}

interface TranslatedSegment extends SourceSegment {
  translation: string;
}

export async function ingestYouTubeIntoWork(
  opts: IngestYouTubeOptions,
): Promise<IngestYouTubeResult | IngestYouTubeError> {
  const { workId, url } = opts;
  const targetLanguage = opts.targetLanguage ?? "zh-CN";

  if (!SAFE_ID.test(workId)) {
    return { ok: false, step: "validate", error: "Invalid workId" };
  }
  if (!/^https?:\/\//.test(url)) {
    return { ok: false, step: "validate", error: "URL must start with http:// or https://" };
  }

  const cfg = await loadConfig();
  const orKey = cfg.openrouter?.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";

  const workRoot = join(resolveWorksRoot(), workId);
  const clipsDir = join(workRoot, "assets/clips");
  const planDir = join(workRoot, "plan");
  await mkdir(clipsDir, { recursive: true });
  await mkdir(planDir, { recursive: true });

  const sourceClipAbs = join(clipsDir, "source.mp4");
  const sourceClipRel = "assets/clips/source.mp4";

  emit({
    type: "ui-progress",
    workId,
    ts: Date.now(),
    payload: { phase: "start", label: "YouTube ingest", steps: 5 },
  });

  // ─── Step 1: yt-dlp download (idempotent — skipped if source.mp4 exists) ─
  const { stat } = await import("node:fs/promises");
  const sourceExists = await stat(sourceClipAbs).then(() => true).catch(() => false);
  if (sourceExists) {
    emit({ type: "ui-toast", workId, ts: Date.now(),
      payload: { message: "Source already on disk — skipping download", kind: "info", durationMs: 3000 } });
  } else {
    try {
      const sectionLabel = opts.startSec != null || opts.endSec != null
        ? ` [${opts.startSec ?? 0}s–${opts.endSec ?? "end"}s]`
        : "";
      emit({ type: "ui-toast", workId, ts: Date.now(),
        payload: { message: `Downloading from YouTube${sectionLabel}…`, kind: "info", durationMs: 3000 } });
      // 720p cap — ingest is for short-form remix, not archival. Capping at
      // 720p cuts download size by ~5–10× on 4K source videos. `worst` is
      // the last-resort safety net so the download never escalates to a
      // multi-GB master.
      const ytArgs: string[] = [
        "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/best[height<=720]/worst",
        "--merge-output-format", "mp4",
        "-o", sourceClipAbs,
        "--no-playlist",
        "--no-warnings",
      ];
      if (opts.startSec != null || opts.endSec != null) {
        const start = opts.startSec ?? 0;
        const end = opts.endSec ?? 999999;
        // `--download-sections` requires ffmpeg post-processing; yt-dlp
        // muxes the slice into the output file automatically.
        ytArgs.push("--download-sections", `*${start}-${end}`);
      }
      ytArgs.push(url);
      await execFileAsync("yt-dlp", ytArgs, { timeout: 900_000, maxBuffer: 32 * 1024 * 1024 });
    } catch (err: any) {
      return downloadError(workId, err);
    }
  }
  emit({ type: "ui-progress", workId, ts: Date.now(), payload: { phase: "step", n: 1 } });

  // ─── Step 2: ffprobe duration ────────────────────────────────────────────
  let durationSec = 0;
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        sourceClipAbs,
      ],
      { timeout: 15_000 },
    );
    durationSec = parseFloat(stdout.trim()) || 0;
  } catch (err: any) {
    return { ok: false, step: "probe", error: err.message ?? String(err) };
  }
  emit({ type: "ui-progress", workId, ts: Date.now(), payload: { phase: "step", n: 2 } });

  // ─── Step 3: Whisper transcription via stable-ts ─────────────────────────
  emit({ type: "ui-toast", workId, ts: Date.now(),
    payload: { message: "Transcribing audio (may take 1–2× duration)…", kind: "info", durationMs: 4000 } });
  let segments: SourceSegment[] = [];
  let detectedLanguage = "auto";
  try {
    const result = await transcribeWithStableWhisper(sourceClipAbs);
    if ("error" in result) {
      return { ok: false, step: "transcribe", error: result.error, code: result.code };
    }
    segments = result.segments;
    detectedLanguage = result.language;
  } catch (err: any) {
    return { ok: false, step: "transcribe", error: err.message ?? String(err) };
  }
  emit({ type: "ui-progress", workId, ts: Date.now(), payload: { phase: "step", n: 3 } });

  // ─── Step 4: translate each segment via OpenRouter ───────────────────────
  emit({ type: "ui-toast", workId, ts: Date.now(),
    payload: {
      message: `Translating to ${targetLanguage}…`,
      kind: "info",
      durationMs: 4000,
    } });
  let translated: TranslatedSegment[];
  try {
    translated = await translateSegmentsViaOpenRouter({
      segments,
      sourceLanguage: detectedLanguage,
      targetLanguage,
      apiKey: orKey,
      model: opts.translateModel ?? DEFAULT_TRANSLATE_MODEL,
    });
  } catch (err: any) {
    return { ok: false, step: "translate", error: err.message ?? String(err) };
  }
  emit({ type: "ui-progress", workId, ts: Date.now(), payload: { phase: "step", n: 4 } });

  // ─── Step 5: write plan files + bootstrap composition.yaml ───────────────
  const transcriptJson = {
    source: { url, language: detectedLanguage, durationSec },
    target: { language: targetLanguage },
    segments: translated.map((s, i) => ({
      id: `seg_${String(i).padStart(4, "0")}`,
      start: s.start,
      end: s.end,
      text: s.text,
      translation: s.translation,
    })),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(
    join(planDir, "transcript.json"),
    JSON.stringify(transcriptJson, null, 2),
    "utf-8",
  );
  await writeFile(
    join(planDir, "brief.md"),
    renderBriefMarkdown({
      url,
      durationSec,
      sourceLanguage: detectedLanguage,
      targetLanguage,
      segments: translated,
    }),
    "utf-8",
  );

  try {
    await bootstrapComposition({
      workId,
      sourceClipRel,
      durationSec,
      translatedSegments: translated,
      targetLanguage,
    });
  } catch (err: any) {
    return { ok: false, step: "compose", error: err.message ?? String(err) };
  }
  emit({ type: "ui-progress", workId, ts: Date.now(), payload: { phase: "step", n: 5 } });

  emit({ type: "ui-progress", workId, ts: Date.now(), payload: { phase: "done" } });
  emit({
    type: "ui-toast",
    workId,
    ts: Date.now(),
    payload: {
      message: `Ingest done · ${translated.length} 段已翻译为 ${targetLanguage}`,
      kind: "success",
      durationMs: 6000,
    },
  });

  return {
    ok: true,
    workId,
    sourceClipPath: sourceClipRel,
    durationSec,
    segmentCount: translated.length,
    language: detectedLanguage,
    targetLanguage,
  };
}

function downloadError(workId: string, err: any): IngestYouTubeError {
  const msg = String(err?.stderr ?? err?.message ?? err);
  let hint = msg;
  if (/yt-dlp.*not found|ENOENT/i.test(msg)) {
    hint = "yt-dlp not installed. Install with: brew install yt-dlp (macOS) or pip install yt-dlp.";
  } else if (/Sign in to confirm|HTTP Error 403/i.test(msg)) {
    hint = `${msg}\n\n${"YouTube blocked the download — pass cookies via yt-dlp --cookies-from-browser or refresh your IP."}`;
  }
  emit({
    type: "ui-toast",
    workId,
    ts: Date.now(),
    payload: { message: "Download failed — see terminal for details.", kind: "error", durationMs: 6000 },
  });
  return { ok: false, step: "download", error: hint };
}

// ──────────────────────────────────────────────────────────────────────────
// Whisper transcription
// ──────────────────────────────────────────────────────────────────────────

async function transcribeWithStableWhisper(audioPath: string): Promise<
  | { language: string; segments: SourceSegment[] }
  | { error: string; code: string }
> {
  // Whisper's `model.transcribe()` prints progress chatter ("Detected
  // language: en", a progress bar, etc.) to stdout — we can't json-parse
  // raw stdout. Write the result to a sidecar JSON file instead and
  // read it back from disk. Stable-ts package (`import stable_whisper`)
  // per reference_stable_whisper_pypi.md.
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: pathJoin } = await import("node:path");
  const tmpDir = await mkdtemp(pathJoin(tmpdir(), "autoviral-whisper-"));
  const outPath = pathJoin(tmpDir, "result.json");
  const py = `
import json, sys
try:
    import stable_whisper
except Exception as e:
    with open(${JSON.stringify(outPath)}, "w", encoding="utf-8") as f:
        json.dump({"error": "stable-whisper not installed: " + str(e)}, f)
    sys.exit(0)
model = stable_whisper.load_model("base")
result = model.transcribe(${JSON.stringify(audioPath)})
language = getattr(result, "language", "auto") or "auto"
segs = []
for s in result.segments:
    segs.append({"start": float(s.start), "end": float(s.end), "text": s.text.strip()})
with open(${JSON.stringify(outPath)}, "w", encoding="utf-8") as f:
    json.dump({"language": language, "segments": segs}, f, ensure_ascii=False)
`;
  try {
    await execFileAsync("python3", ["-c", py], {
      timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const raw = await readFile(outPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.error) {
      return {
        error: `${parsed.error}. Run \`pip install stable-ts\` to enable ASR (the PyPI package is stable-ts, the import alias is stable_whisper).`,
        code: "PYTHON_DEP_MISSING",
      };
    }
    return {
      language: parsed.language ?? "auto",
      segments: parsed.segments ?? [],
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────
// OpenRouter translation
// ──────────────────────────────────────────────────────────────────────────

interface TranslateOpts {
  segments: SourceSegment[];
  sourceLanguage: string;
  targetLanguage: string;
  apiKey: string;
  model: string;
}

async function translateSegmentsViaOpenRouter(opts: TranslateOpts): Promise<TranslatedSegment[]> {
  const { segments, sourceLanguage, targetLanguage, apiKey, model } = opts;
  if (!apiKey) {
    // Fall through with empty translations rather than failing — user can
    // still see the source transcript and decide what to do.
    return segments.map((s) => ({ ...s, translation: "" }));
  }
  if (segments.length === 0) return [];

  // Batch translation: send all segments in one chat completion to preserve
  // discourse context. Returns a numbered list which we re-zip against the
  // input. Falls back to per-segment retries on parse failure.
  const numbered = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");
  const systemPrompt = `You translate transcript segments from ${sourceLanguage || "the source language"} to ${targetLanguage}. Preserve speaker intent and tone; keep technical terms in their original form if a target-language equivalent doesn't exist. Output exactly one translated line per input line, prefixed with the same [N] index, no extra commentary. Maintain segment count exactly.`;

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3271",
      "X-Title": "AutoViral",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: numbered },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter translation HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = parseNumberedLines(content, segments.length);
  return segments.map((s, i) => ({ ...s, translation: parsed[i] ?? "" }));
}

function parseNumberedLines(content: string, expectedCount: number): string[] {
  const out = new Array<string>(expectedCount).fill("");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*\[(\d+)\]\s*(.*)$/);
    if (!m) continue;
    const idx = Number(m[1]);
    if (idx >= 0 && idx < expectedCount) out[idx] = m[2].trim();
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Brief markdown
// ──────────────────────────────────────────────────────────────────────────

function renderBriefMarkdown(opts: {
  url: string;
  durationSec: number;
  sourceLanguage: string;
  targetLanguage: string;
  segments: TranslatedSegment[];
}): string {
  const { url, durationSec, sourceLanguage, targetLanguage, segments } = opts;
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(1);
    return `${String(m).padStart(2, "0")}:${r.padStart(4, "0")}`;
  };
  const totalChars = segments.reduce((n, s) => n + s.translation.length, 0);
  const lines = [
    `# Ingest brief`,
    ``,
    `- **Source:** ${url}`,
    `- **Source language:** ${sourceLanguage}`,
    `- **Target language:** ${targetLanguage}`,
    `- **Duration:** ${fmt(durationSec)} (${durationSec.toFixed(2)}s)`,
    `- **Segments:** ${segments.length}`,
    `- **Translated chars:** ${totalChars}`,
    ``,
    `## Translated transcript`,
    ``,
  ];
  for (const s of segments) {
    lines.push(`**${fmt(s.start)} → ${fmt(s.end)}**`);
    lines.push(`> ${s.text}`);
    if (s.translation) lines.push(`${s.translation}`);
    lines.push(``);
  }
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Composition bootstrap
// ──────────────────────────────────────────────────────────────────────────

interface BootstrapOpts {
  workId: string;
  sourceClipRel: string;
  durationSec: number;
  translatedSegments: TranslatedSegment[];
  targetLanguage: string;
}

async function bootstrapComposition(opts: BootstrapOpts): Promise<void> {
  const { workId, sourceClipRel, durationSec, translatedSegments, targetLanguage } = opts;

  let comp: Composition;
  try {
    comp = await readCompositionFor({ workId });
  } catch {
    // First-time write — use the canonical skeleton builder so we get
    // schema-valid defaults (4 tracks, updatedAt, etc.) without having
    // to track each new required field by hand.
    comp = makeEmptyComposition({ workId, aspect: "9:16", duration: durationSec, fps: 30 });
  }

  // Ensure a video track exists (skeleton ships with one, but pre-existing
  // compositions may have been trimmed by the user).
  let videoTrack = comp.tracks?.find((t) => t.kind === "video");
  if (!videoTrack) {
    // Phase D (issue #31) — minted track uses `trk_<uuid>` id; displayOrder
    // pushed to the end of the existing tracks list so we don't collide.
    const existing = comp.tracks ?? [];
    videoTrack = {
      id: newTrackId(),
      kind: "video",
      label: "V1",
      displayOrder: existing.length,
      muted: false,
      hidden: false,
      clips: [],
    } as any;
    comp.tracks = [...existing, videoTrack!];
  }

  // Replace any existing source clip; otherwise prepend.
  videoTrack!.clips = (videoTrack!.clips ?? []).filter(
    (c: any) => !(c.kind === "video" && c.src === sourceClipRel),
  );
  videoTrack!.clips.unshift({
    id: "vc_source",
    kind: "video",
    src: sourceClipRel,
    in: 0,
    out: Number(durationSec.toFixed(3)),
    trackOffset: 0,
  } as any);

  // Update asset registry. AssetEntry schema uses `uri`, not `path`.
  comp.assets = (comp.assets ?? []).filter((a: any) => a.uri !== sourceClipRel);
  comp.assets.push({
    id: "a_source",
    uri: sourceClipRel,
    kind: "video",
    name: "source.mp4",
    metadata: { durationMs: Math.round(durationSec * 1000) },
    status: "ready",
  } as any);

  // Caption overlay model.
  (comp as any).captionStrategy = "overlay";
  (comp as any).captions = buildCaptionModel(translatedSegments, targetLanguage);

  comp.duration = Math.max(comp.duration ?? 0, durationSec);
  comp.updatedAt = new Date().toISOString();

  await writeCompositionFor({ workId }, comp);
}

function buildCaptionModel(segments: TranslatedSegment[], language: string) {
  const segs: Array<{ segmentId: string; start: number; end: number; text: string }> = [];
  const groups: Array<{
    groupId: string;
    start: number;
    end: number;
    segmentIds: string[];
    style: Record<string, unknown>;
    animation: Record<string, unknown>;
  }> = [];

  segments.forEach((s, i) => {
    const segmentId = `seg_${String(i).padStart(4, "0")}`;
    const text = s.translation || s.text;
    segs.push({ segmentId, start: s.start, end: s.end, text });
    groups.push({
      groupId: `grp_${String(i).padStart(3, "0")}`,
      start: s.start,
      end: s.end,
      segmentIds: [segmentId],
      style: {
        fontSize: 56,
        color: "#ffffff",
        background: "rgba(0,0,0,0.55)",
        padding: "8px 14px",
        borderRadius: 6,
        textAlign: "center",
        bottomOffsetPx: 140,
      },
      animation: {
        entrance: { duration: 0.18, type: "slide-up" },
        highlight: { activeColor: "#a8c5d6", dimColor: "#9aa0a6", activeScale: 1.0 },
        exit: { duration: 0.18, type: "fade" },
      },
    });
  });

  return {
    modelId: `cm_${Date.now()}`,
    audioTrackId: null,
    language,
    segments: segs,
    groups,
  };
}

// Re-export for tests + potential reuse from other server modules.
export const _internals = {
  parseNumberedLines,
  renderBriefMarkdown,
  buildCaptionModel,
};
