// ─────────────────────────────────────────────────────────────────────────────
// Generation request shapes + direct-dispatch helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// History: this module used to build a "death-envelope" chat notification —
// `buildGenerationNotification` told the agent to `Run the script in
// modules/assets/scripts/*.py`. Those four scripts (openrouter_generate.py /
// seedance_generate.py / tts_generate.py / music_generate.py) do NOT exist on
// disk (server-side dead refs were retired in 6e3693c; the web copy was the
// last hold-out, shipped in web/dist), so the envelope commanded the agent to
// run nothing. PRD-0009 B3 retired the script-calling machinery entirely.
//
// The dialog now DIRECT-DISPATCHES to real HTTP endpoints — no chat envelope,
// no agent round-trip. This module is reduced to the pure request shapes
// (produced by GenerationDialog.formStateToRequest) plus two small helpers the
// dialog uses to build endpoint bodies:
//   - semanticFilename(): a stable, human-readable output name (the old
//     envelope made the agent pick one; direct-dispatch must supply it).
//   - fuseVariantPrompt(): folds the variant's `change_direction` into the
//     source's frozen `prompt` (the old envelope made the agent fuse them).
//
// Endpoint map (kind × mode → endpoint), wired in GenerationDialog.onGenerate:
//   image  create  → POST /api/generate/image            {workId,prompt,filename,...}
//   image  variant → POST /api/generate/image            + referenceImage=source.uri, fused prompt
//   video  create  → POST /api/providers/:id/generate-video  (already wired pre-B3)
//   video  variant → POST /api/providers/:id/generate-video  + firstFrameImage=source.uri
//   audio  tts     → POST /api/works/:id/tts             (create wired pre-B3; variant now too)
//   audio  bgm     → POST /api/generate/bgm              {workId,prompt,filename?,durationSeconds?}
//
// Provenance note: the death-envelope-era variant lineage (`derive` edge,
// fromAssetId=source.id) was always dead because the scripts it instructed
// never ran. Direct-dispatch endpoints register a plain `generate` edge
// (fromAssetId:null); restoring derive lineage is a server-side follow-up, out
// of scope for B3.

export type AssetKind = "image" | "video" | "audio";
export type RequestMode = "create" | "variant";

export interface ImageParams {
  kind: "image";
  /** For create: the full prompt. For variant: the source's ORIGINAL prompt
   *  — read-only, kept as lineage identity. The user-facing instruction for
   *  the variant lives on `changeDirection`. */
  prompt: string;
  /** Variant-mode only: user's modification direction, e.g. "make the
   *  character older". Fused with `prompt` by fuseVariantPrompt(). */
  changeDirection?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface VideoParams {
  kind: "video";
  prompt: string;
  changeDirection?: string;
  /** Seedance 2.0 accepts unit-less seconds; supported_durations = 4..15
   *  (integers; 3 is not a real value). Caller passes a string like "4" / "10". */
  duration: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "3:4" | "4:3" | "21:9" | "9:21";
  /** image-to-video first-frame anchor URL/path. The /generate-video endpoint
   *  maps this onto `firstFrameImage`. */
  imageUrl?: string;
}

export interface AudioParams {
  kind: "audio";
  /** Audio has two sub-modes discriminated by which field is set. */
  subKind: "tts" | "bgm";
  prompt: string;
  changeDirection?: string;
  voice?: string;
  durationSeconds?: number;
}

export type GenerationParams = ImageParams | VideoParams | AudioParams;

export interface GenerationRequest {
  mode: RequestMode;
  params: GenerationParams;
  /** Populated when mode === "variant". The source envelope is the *read-only
   *  identity* of the variant lineage: original prompt, model, format knobs,
   *  and the source asset's `uri` (used as the derive anchor — referenceImage
   *  for image, firstFrameImage for video). User feedback flows in as
   *  `params.changeDirection`, fused into the final prompt by the dialog. */
  source?: {
    id: string;
    /** Human label / semantic id, e.g. "asset-panda-sad-v2". */
    name: string;
    uri?: string | null;
    sourcePrompt?: string | null;
    sourceModel?: string | null;
    /** Image/video pixel dimensions from asset.metadata. Carried so the
     *  variant inherits exact size unless the change direction asks
     *  otherwise (critical for first/last-frame continuity). */
    sourceWidth?: number | null;
    sourceHeight?: number | null;
    sourceAspectRatio?: string | null;
    /** Duration for video/audio variants. Seconds. */
    sourceDuration?: number | null;
    /** TTS voice on the source (if audio/tts). */
    sourceVoice?: string | null;
  };
}

// ─── Direct-dispatch helpers ─────────────────────────────────────────────────

/**
 * Build a stable, human-readable output filename. The death envelope made the
 * agent pick a "semantic asset id (never a UUID)"; direct-dispatch must supply
 * the filename to the endpoint itself, so we derive one from the prompt and
 * stamp it with a short time suffix to avoid clobbering an earlier asset with
 * the same words.
 *
 * @param prompt   The (already-fused for variants) generation prompt.
 * @param ext      File extension WITHOUT the dot, e.g. "png", "mp3".
 * @param now      Injectable clock for deterministic tests.
 */
export function semanticFilename(
  prompt: string,
  ext: string,
  now: number = Date.now(),
): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "asset";
  return `${slug}-${now.toString(36)}.${ext}`;
}

/**
 * Fold a variant's `change_direction` into the source's frozen prompt. The
 * death envelope's instruction #2 ("Synthesize the final prompt by fusing
 * source.prompt with change_direction") was the agent's job; direct-dispatch
 * builds it in the frontend. We keep the source identity first, then append the
 * delta so the provider sees both.
 */
export function fuseVariantPrompt(
  sourcePrompt: string | null | undefined,
  changeDirection: string | undefined,
): string {
  const base = (sourcePrompt ?? "").trim();
  const delta = (changeDirection ?? "").trim();
  if (!base) return delta;
  if (!delta) return base;
  return `${base}\n\nChange: ${delta}`;
}

/**
 * Absolutize a derive-anchor image URI before it is sent to a generation
 * provider. The Studio surfaces asset URIs as SAME-ORIGIN relative paths
 * (e.g. `/api/works/w1/assets/images/x.png`). But the providers can't use a
 * relative path:
 *  - openrouter-image (referenceImage) only forwards a URL that starts with
 *    `data:` or `http`, silently DROPPING a relative one → variant edit loses
 *    its anchor and degrades to a no-reference generation.
 *  - seedance (firstFrameImage) hands the URL to OpenRouter's SERVER-SIDE
 *    fetch, which can't resolve a path relative to the browser's origin.
 * So a relative `/...` uri is rewritten to `<origin>/...`. `data:` and absolute
 * `http(s)://` uris pass through untouched; empty/undefined returns undefined.
 *
 * @param uri    The anchor uri (asset uri or user-typed Source-image-URL).
 * @param origin Injectable origin for deterministic tests (defaults to
 *               window.location.origin in the browser).
 */
export function absolutizeWorkspaceUri(
  uri: string | null | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string | undefined {
  const u = (uri ?? "").trim();
  if (!u) return undefined;
  if (/^(data:|https?:\/\/)/i.test(u)) return u;
  if (u.startsWith("/")) return `${origin}${u}`;
  // A bare relative path (no leading slash) — anchor it under origin/.
  return origin ? `${origin}/${u}` : u;
}
