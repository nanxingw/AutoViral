// ─────────────────────────────────────────────────────────────────────────────
// Structured generation requests — Phase 2.4
// ─────────────────────────────────────────────────────────────────────────────
//
// This module is the bridge between the studio's generation UI (Phase 2.5
// Generation Dialog + future asset-panel "Create" / dive-canvas "Variant"
// buttons) and the agent's script-calling machinery. The viewer never calls
// providers directly — it gathers user intent in a rich form, then dispatches
// ONE structured chat notification for the agent to act on.
//
// The notification is dual-purpose:
//   1. A short human-readable top line that reads well in the chat log
//   2. A fenced JSON payload the agent parses to get the exact params
//   3. A brief instruction block telling the agent which script to run and
//      how to edit composition.yaml
//
// SKILL.md and modules/assets/capabilities/structured-generation.md (Phase 2.6)
// have the agent-facing handler spec. Don't duplicate that here.
//
// Ported from pandazki/pneuma-skills modes/clipcraft/viewer/generation
// /dispatchGeneration.ts. Protocol shape preserved; provider mapping adapted
// to AutoViral's stack (openrouter gpt-5.4-image-2 for image, dreamina/
// seedance-pro for video, edge-tts for TTS, lyria-3-pro for BGM).

export type AssetKind = "image" | "video" | "audio";
export type RequestMode = "create" | "variant";

export interface ImageParams {
  kind: "image";
  /** For create: the full prompt. For variant: the source's ORIGINAL prompt
   *  — read-only, kept as lineage identity. The user-facing instruction for
   *  the variant lives on `changeDirection`. */
  prompt: string;
  /** Variant-mode only: user's modification direction, e.g. "make the
   *  character older". Agent fuses this with `prompt`. */
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
  /** Dreamina/seedance-pro accepts integer-second strings; veo-style "4s"
   *  not supported. Use unit-less seconds: "4", "6", "8". */
  duration: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5" | "3:4" | "21:9" | "auto";
  resolution?: "720p" | "1080p";
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
  /** Populated when mode === "variant". The new asset's provenance edge will
   *  carry fromAssetId = source.id and operation.type = "derive".
   *
   *  The source envelope is the *read-only identity* of the variant lineage:
   *  original prompt, model, and format knobs. User feedback flows in as
   *  `params.changeDirection` (kept separate from the frozen source fields)
   *  — the agent is responsible for fusing the two per skill guidance. */
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

export interface ViewerNotification {
  type: string;
  severity: "info" | "warning";
  summary: string;
  message: string;
}

const TAG_CREATE = "autoviral:create-asset";
const TAG_VARIANT = "autoviral:generate-variant";

export function buildGenerationNotification(
  request: GenerationRequest,
): ViewerNotification {
  const tag = request.mode === "variant" ? TAG_VARIANT : TAG_CREATE;
  const summary = buildSummary(request);
  const payload = buildPayload(request);
  const instructions = buildInstructions(request);

  return {
    type: tag,
    severity: "warning",
    summary: `/${tag}`,
    message: `[${tag}] ${summary}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n${instructions}`,
  };
}

function buildSummary(req: GenerationRequest): string {
  const kind = req.params.kind;
  if (req.mode === "variant" && req.source) {
    const change = truncate(req.params.changeDirection ?? "", 80);
    return `Generate a variant of ${req.source.name} (${req.source.id}) — ${kind} — change: "${change}"`;
  }
  const promptPreview = truncate(req.params.prompt, 80);
  return `Create a new asset — ${kind} — "${promptPreview}"`;
}

interface JsonPayload {
  mode: RequestMode;
  kind: AssetKind;
  sub_kind?: "tts" | "bgm";
  prompt?: string;
  change_direction?: string;
  params: Record<string, unknown>;
  source?: {
    asset_id: string;
    asset_name: string;
    uri?: string | null;
    prompt?: string | null;
    model?: string | null;
    width?: number | null;
    height?: number | null;
    aspect_ratio?: string | null;
    duration?: number | null;
    voice?: string | null;
  };
  script: string;
  script_args: Record<string, string | number>;
  provenance_hint: {
    operation_type: "generate" | "derive";
    from_asset_id: string | null;
    agent_id: string;
    label: string;
    model: string;
  };
}

function buildPayload(req: GenerationRequest): JsonPayload {
  const isVariant = req.mode === "variant";
  const base: Omit<JsonPayload, "params" | "script" | "script_args" | "provenance_hint"> = {
    mode: req.mode,
    kind: req.params.kind,
  };
  if (isVariant) {
    base.change_direction = req.params.changeDirection ?? "";
  } else {
    base.prompt = req.params.prompt;
  }
  if (req.params.kind === "audio") {
    (base as JsonPayload).sub_kind = req.params.subKind;
  }
  if (req.source) {
    base.source = {
      asset_id: req.source.id,
      asset_name: req.source.name,
      uri: req.source.uri ?? null,
      prompt: req.source.sourcePrompt ?? null,
      model: req.source.sourceModel ?? null,
      width: req.source.sourceWidth ?? null,
      height: req.source.sourceHeight ?? null,
      aspect_ratio: req.source.sourceAspectRatio ?? null,
      duration: req.source.sourceDuration ?? null,
      voice: req.source.sourceVoice ?? null,
    };
  }
  const r = resolveScriptForRequest(req);
  return {
    ...base,
    params: r.params,
    script: r.script,
    script_args: r.scriptArgs,
    provenance_hint: r.provenance,
  };
}

interface Resolved {
  params: Record<string, unknown>;
  script: string;
  scriptArgs: Record<string, string | number>;
  provenance: JsonPayload["provenance_hint"];
}

function resolveScriptForRequest(req: GenerationRequest): Resolved {
  const operationType: "generate" | "derive" =
    req.mode === "variant" ? "derive" : "generate";
  const fromAssetId = req.mode === "variant" ? (req.source?.id ?? null) : null;
  const p = req.params;

  switch (p.kind) {
    case "image": {
      const aspectRatio = p.aspectRatio ?? "1:1";
      const args: Record<string, string | number> = { "--prompt": p.prompt };
      if (p.width && p.height) {
        args["--image-size"] = `${p.width}x${p.height}`;
      } else {
        args["--aspect-ratio"] = aspectRatio;
      }
      return {
        params: {
          prompt: p.prompt,
          aspect_ratio: aspectRatio,
          width: p.width ?? null,
          height: p.height ?? null,
          style: p.style ?? null,
        },
        script: "modules/assets/scripts/openrouter_generate.py",
        scriptArgs: args,
        provenance: {
          operation_type: operationType,
          from_asset_id: fromAssetId,
          agent_id: "autoviral-imagegen",
          label: "openai/gpt-5.4-image-2",
          model: "openai/gpt-5.4-image-2",
        },
      };
    }
    case "video": {
      const isVariant = req.mode === "variant";
      const autoImageUrl =
        isVariant && req.source?.uri ? req.source.uri : null;
      const resolvedImageUrl = p.imageUrl ?? autoImageUrl;
      const useFromImage = !!resolvedImageUrl;
      const args: Record<string, string | number> = {
        "--prompt": p.prompt,
        "--duration": p.duration,
      };
      if (p.aspectRatio) args["--aspect-ratio"] = p.aspectRatio;
      if (p.resolution) args["--resolution"] = p.resolution;
      if (useFromImage) args["--image-url"] = resolvedImageUrl as string;
      const modelId = useFromImage
        ? "dreamina/seedance-pro/image-to-video"
        : "dreamina/seedance-pro/text-to-video";
      return {
        params: {
          prompt: p.prompt,
          duration: p.duration,
          aspect_ratio: p.aspectRatio ?? "auto",
          resolution: p.resolution ?? "720p",
          image_url: resolvedImageUrl ?? null,
        },
        script: useFromImage
          ? "modules/assets/scripts/dreamina_generate.py from-image"
          : "modules/assets/scripts/dreamina_generate.py",
        scriptArgs: args,
        provenance: {
          operation_type: operationType,
          from_asset_id: fromAssetId,
          agent_id: "autoviral-videogen",
          label: modelId,
          model: modelId,
        },
      };
    }
    case "audio": {
      const isTts = p.subKind === "tts";
      const args: Record<string, string | number> = isTts
        ? { "--text": p.prompt }
        : { "--prompt": p.prompt };
      if (isTts && p.voice) args["--voice"] = p.voice;
      if (!isTts && p.durationSeconds) args["--duration"] = p.durationSeconds;
      return {
        params: {
          sub_kind: p.subKind,
          prompt: p.prompt,
          voice: p.voice ?? null,
          duration_seconds: p.durationSeconds ?? null,
        },
        script: isTts
          ? "modules/assets/scripts/tts_generate.py"
          : "modules/assets/scripts/music_generate.py",
        scriptArgs: args,
        provenance: {
          operation_type: operationType,
          from_asset_id: fromAssetId,
          agent_id: isTts ? "autoviral-tts" : "autoviral-bgm",
          label: isTts
            ? "edge-tts/multilingual"
            : "google/lyria-3-pro-preview",
          model: isTts
            ? "edge-tts/multilingual"
            : "google/lyria-3-pro-preview",
        },
      };
    }
  }
}

function buildInstructions(req: GenerationRequest): string {
  if (req.mode === "variant") {
    return [
      "Handling (variant):",
      "1. Parse the JSON block above. Note: `source` holds frozen identity (original prompt, model, dimensions, aspect, duration). `change_direction` is the user's delta — NOT a full prompt.",
      "2. Synthesize the final prompt by fusing `source.prompt` with `change_direction`. Keep subject, setting, lighting, palette identical unless the change direction explicitly demands otherwise.",
      "3. Honour source format: keep the same `--aspect-ratio` / `--duration` / `--image-size` as the source unless the change direction asks for a different size/length.",
      "4. For image variants of small deltas (text swap, grain, color tweak), prefer adding `--ref-image <source.uri>` to route through edit mode.",
      "5. Run the script in `script` with the flags in `script_args`. Append `--output <path>`.",
      "6. Edit `composition.yaml`: append the new asset to `assets[]` and a `derive` edge to `provenance[]` using `provenance_hint`. `fromAssetId` = source asset id.",
      "7. DO NOT add a clip to any track — leave timeline placement to the user.",
      "8. Emit a <viewer-locator/> card pointing to the new asset when you confirm.",
    ].join("\n");
  }
  return [
    "Handling (create):",
    "1. Parse the JSON block above.",
    "2. Pick a semantic asset id (e.g. `asset-panda-intro`) — never a UUID.",
    "3. Pick a relative output path under `assets/{kind}/`.",
    "4. Run the script in `script` with the flags in `script_args`. Append `--output <path>`.",
    "5. Edit `composition.yaml`: append the new asset to `assets[]` and a `generate` edge to `provenance[]` using `provenance_hint`. `fromAssetId` = null.",
    "6. DO NOT add a clip to any track.",
    "7. Emit a <viewer-locator/> card pointing to the new asset when you confirm.",
  ].join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
