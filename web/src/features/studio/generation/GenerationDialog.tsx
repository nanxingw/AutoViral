// ─────────────────────────────────────────────────────────────────────────────
// GenerationDialog — Phase 2.5 (B3: direct-dispatch, death-envelope retired)
// ─────────────────────────────────────────────────────────────────────────────
//
// Standalone Radix Dialog modal for users to fill out a generation request.
// On submit it DIRECT-DISPATCHES to the matching real HTTP endpoint (see the
// kind×mode endpoint map in dispatchGeneration.ts). It no longer builds a chat
// "death-envelope" that told the agent to run since-deleted *.py scripts
// (retired in PRD-0009 B3).
//
// The component is CONTROLLED (open / onOpenChange come from the parent) and
// supports two modes:
//   1. CREATE — kind tabs (image | video | audio); audio sub-tabs (bgm | tts)
//   2. VARIANT — when `source` is provided, kind is fixed by the source asset;
//      "prompt" textarea becomes "change direction" textarea. The source's uri
//      becomes the derive anchor (referenceImage for image / firstFrameImage
//      for video) and changeDirection is fused into the prompt.
//
// Pure mapping (formStateToRequest) is exported separately so unit tests can
// exercise the kind-discrimination logic without rendering React.

import * as Dialog from "@radix-ui/react-dialog";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  fuseVariantPrompt,
  semanticFilename,
  type GenerationRequest,
  type AssetKind,
} from "./dispatchGeneration";
import { useT } from "@/i18n/useT";
import { apiFetch } from "@/lib/api";

// ─── Provider listing (Phase 8.4) ────────────────────────────────────────────

export interface ProviderListing {
  id: string;
  displayName: string;
  available: boolean;
  stub: boolean;
}

async function fetchProviders(): Promise<ProviderListing[]> {
  // R24: switched from raw fetch to apiFetch so non-2xx surfaces as a thrown
  // ApiError (useQuery sets isError=true) instead of silently degrading to
  // an empty providers list — empty was previously indistinguishable from
  // "endpoint failed".
  const body = await apiFetch<{ providers?: ProviderListing[] } | ProviderListing[]>(
    "/api/providers",
  );
  if (Array.isArray(body)) return body;
  return body.providers ?? [];
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type AudioSubKind = "bgm" | "tts";

/**
 * Flat record of every field the dialog can carry. Per-kind fields are
 * optional/ignored when the active `kind` doesn't apply. Keeping a flat shape
 * (rather than a discriminated union) means React state stays a single
 * `useState` hook with simple field-level setters.
 */
export interface FormState {
  kind: AssetKind;
  // Prompt-style fields (image/video share `prompt`; audio uses `prompt` for
  // BGM description or TTS script).
  prompt: string;
  // Image
  aspectRatio?: string;
  width?: number;
  height?: number;
  style?: string;
  // Video
  duration: string;
  // image-to-video first-frame anchor (maps to firstFrameImage on dispatch).
  imageUrl?: string;
  // Audio
  audioSubKind: AudioSubKind;
  voice?: string;
  durationSeconds?: number;
  /** TTS provider routing — "auto" tries edge-tts then OpenAI as fallback. */
  ttsProvider?: "auto" | "edge-tts" | "openai";
  // Variant mode
  changeDirection: string;
}

const TTS_VOICES: { value: string; label: string }[] = [
  { value: "zh-CN-XiaoxiaoNeural", label: "中性女声 (zh-CN-Xiaoxiao)" },
  { value: "zh-CN-YunjianNeural", label: "沉稳男声 (zh-CN-Yunjian)" },
  { value: "en-US-AriaNeural", label: "英文女声 (en-US-Aria)" },
  { value: "en-US-GuyNeural", label: "英文男声 (en-US-Guy)" },
];

const IMAGE_ASPECTS = ["1:1", "9:16", "16:9", "4:5"] as const;
const VIDEO_ASPECTS = ["9:16", "16:9", "1:1"] as const;
// Seedance 2.0's authoritative create-videos schema (GET /api/v1/videos/models)
// lists supported_durations = 4,5,…,15 (integer seconds; 3 does NOT exist). The
// earlier F155 lock to {3,5,10} mirrored a stale spec note — `3` round-trips to
// a silent server rejection now that the provider passes duration through. Keep
// the select to a small in-range subset; every value MUST be ∈ 4..15.
const VIDEO_DURATIONS = ["4", "5", "8", "10", "15"] as const;

export const INITIAL_FORM_STATE: FormState = {
  kind: "image",
  prompt: "",
  aspectRatio: "1:1",
  width: undefined,
  height: undefined,
  style: undefined,
  duration: "5",
  imageUrl: undefined,
  audioSubKind: "bgm",
  voice: "zh-CN-XiaoxiaoNeural",
  durationSeconds: 30,
  ttsProvider: "auto",
  changeDirection: "",
};

// ─── Pure mapping (the testable core) ────────────────────────────────────────

/**
 * Map a flat FormState into a properly-shaped GenerationRequest. Pure — no
 * IO, no validation; it trusts that the caller (or the form's HTML
 * validation) ensured required fields are non-empty.
 *
 * If `source` is provided, the result is in `variant` mode. The `kind` of the
 * variant comes from `state.kind` (the dialog locks the kind tab in variant
 * mode so it always matches the source).
 */
export function formStateToRequest(
  state: FormState,
  source: GenerationRequest["source"] | undefined,
): GenerationRequest {
  const mode: GenerationRequest["mode"] = source ? "variant" : "create";

  switch (state.kind) {
    case "image": {
      // In variant mode, the read-only "prompt" carries the source's original
      // prompt as lineage identity; the user's delta lives on changeDirection.
      const prompt =
        mode === "variant" ? (source?.sourcePrompt ?? "") : state.prompt;
      return {
        mode,
        params: {
          kind: "image",
          prompt,
          changeDirection:
            mode === "variant" ? state.changeDirection : undefined,
          aspectRatio: state.aspectRatio,
          width: state.width,
          height: state.height,
          style: state.style,
        },
        source,
      };
    }
    case "video": {
      const prompt =
        mode === "variant" ? (source?.sourcePrompt ?? "") : state.prompt;
      const aspectRatio = state.aspectRatio as
        | "16:9"
        | "9:16"
        | "1:1"
        | "3:4"
        | "4:3"
        | "21:9"
        | "9:21"
        | undefined;
      return {
        mode,
        params: {
          kind: "video",
          prompt,
          changeDirection:
            mode === "variant" ? state.changeDirection : undefined,
          duration: state.duration || "5",
          aspectRatio,
          imageUrl: state.imageUrl,
        },
        source,
      };
    }
    case "audio": {
      const prompt =
        mode === "variant" ? (source?.sourcePrompt ?? "") : state.prompt;
      return {
        mode,
        params: {
          kind: "audio",
          subKind: state.audioSubKind,
          prompt,
          changeDirection:
            mode === "variant" ? state.changeDirection : undefined,
          voice: state.audioSubKind === "tts" ? state.voice : undefined,
          durationSeconds:
            state.audioSubKind === "bgm" ? state.durationSeconds : undefined,
        },
        source,
      };
    }
  }
}

/** Whether the form has the minimum content required to dispatch. */
function isFormReady(
  state: FormState,
  source: GenerationRequest["source"] | undefined,
): boolean {
  if (source) return state.changeDirection.trim().length > 0;
  if (state.kind === "image" || state.kind === "video") {
    return state.prompt.trim().length >= 10;
  }
  // audio
  if (state.audioSubKind === "tts") return state.prompt.trim().length > 0;
  return state.prompt.trim().length > 0;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface GenerationDialogProps {
  workId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Populated when this is a variant request (right-click "create variant"
   * on an asset in the dive canvas). Pre-fills the form in variant mode.
   */
  source?: GenerationRequest["source"];
}

export function GenerationDialog(props: GenerationDialogProps) {
  const { workId, open, onOpenChange, source } = props;
  const isVariant = !!source;

  // Variant mode: lock kind to whatever the source's MIME implies. If the
  // caller can't infer a kind from the source, we default to "image"; the
  // parent should usually pass an enriched source.
  const lockedKind: AssetKind | null = useMemo(() => {
    if (!isVariant) return null;
    // Heuristic: video sources have a numeric duration; audio sources have a
    // voice OR a duration with no aspect; otherwise image. The parent is
    // responsible for picking the right `kind` via the form state — here we
    // just make a best-guess seed.
    if (source?.sourceVoice) return "audio";
    if (source?.sourceDuration && !source.sourceAspectRatio) return "audio";
    if (source?.sourceDuration) return "video";
    return "image";
  }, [isVariant, source]);

  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL_FORM_STATE,
    kind: lockedKind ?? INITIAL_FORM_STATE.kind,
    // B3 — an audio variant carrying a voice is a TTS variant; seed the audio
    // sub-kind so onGenerate routes it to /api/works/:id/tts (not /generate/bgm).
    audioSubKind: source?.sourceVoice ? "tts" : INITIAL_FORM_STATE.audioSubKind,
    aspectRatio: source?.sourceAspectRatio ?? INITIAL_FORM_STATE.aspectRatio,
    duration: source?.sourceDuration
      ? String(source.sourceDuration)
      : INITIAL_FORM_STATE.duration,
    voice: source?.sourceVoice ?? INITIAL_FORM_STATE.voice,
  }));

  const queryClient = useQueryClient();
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const t = useT();
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Tick a per-second counter while a video provider dispatch is in flight so
  // the user gets visible feedback during the 70-180s Seedance round-trip.
  useEffect(() => {
    if (!isGenerating) {
      setElapsedSec(0);
      return;
    }
    setElapsedSec(0);
    const interval = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  // ── Provider dropdown (Phase 8.4) ─────────────────────────────────────────
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
    staleTime: 60_000,
  });
  const providers = providersQuery.data ?? [];
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  // Default selection: first non-stub provider, fallback to first.
  useEffect(() => {
    if (selectedProviderId !== null) return;
    if (providers.length === 0) return;
    const firstReal = providers.find((p) => !p.stub);
    setSelectedProviderId((firstReal ?? providers[0]).id);
  }, [providers, selectedProviderId]);

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  // B3 — every kind×mode direct-dispatches to a real endpoint now. The video
  // provider dropdown applies to BOTH create and variant (variant adds the
  // source.uri as the i2v first-frame anchor). When there's no real provider
  // selected yet we can't dispatch a video at all.
  const shouldDispatchProvider =
    form.kind === "video" && !!selectedProviderId;

  // TTS direct-dispatch (create + variant) → POST /api/works/:id/tts. The old
  // buildGenerationNotification route pointed at a since-deleted python script.
  const shouldDispatchTts =
    form.kind === "audio" && form.audioSubKind === "tts";

  // B3 — image (create + variant) → POST /api/generate/image. Variant adds the
  // source.uri as referenceImage and fuses changeDirection into the prompt.
  async function dispatchImageGenerate(req: GenerationRequest): Promise<void> {
    const p = req.params;
    if (p.kind !== "image") return;
    const isVar = req.mode === "variant";
    // For variants the form's `prompt` carries the source's frozen prompt; fuse
    // it with the user's changeDirection (the old envelope made the agent do
    // this in step #2).
    const prompt = isVar
      ? fuseVariantPrompt(p.prompt, p.changeDirection)
      : p.prompt;
    // The endpoint REQUIRES a filename (it does a raw join + collision-prone
    // write). The old envelope made the agent pick a semantic id; we derive one
    // here so two prompts can't clobber the same file.
    const filename = semanticFilename(prompt, "png");
    const res = await fetch("/api/generate/image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workId,
        prompt,
        filename,
        ...(p.aspectRatio ? { aspectRatio: p.aspectRatio } : {}),
        ...(p.width ? { width: p.width } : {}),
        ...(p.height ? { height: p.height } : {}),
        // Variant anchor: route the source asset through the provider's edit
        // mode so small deltas (text swap, color tweak) preserve the source.
        ...(isVar && req.source?.uri ? { referenceImage: req.source.uri } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`image dispatch failed (${res.status}) ${text}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["assets", workId] });
  }

  // B3 — BGM (create + variant) → POST /api/generate/bgm. The endpoint
  // validates durationSeconds (5-180) server-side; we forward it when set.
  async function dispatchBgmGenerate(req: GenerationRequest): Promise<void> {
    const p = req.params;
    if (p.kind !== "audio" || p.subKind !== "bgm") return;
    const isVar = req.mode === "variant";
    const prompt = isVar
      ? fuseVariantPrompt(p.prompt, p.changeDirection)
      : p.prompt;
    const filename = semanticFilename(prompt, "mp3");
    const res = await fetch("/api/generate/bgm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workId,
        prompt,
        filename,
        ...(p.durationSeconds ? { durationSeconds: p.durationSeconds } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`bgm dispatch failed (${res.status}) ${text}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["assets", workId] });
  }

  async function dispatchTtsGenerate(req: GenerationRequest): Promise<void> {
    const p = req.params;
    if (p.kind !== "audio" || p.subKind !== "tts") return;
    const isVar = req.mode === "variant";
    // For TTS variants the frozen `prompt` holds the source narration; fold the
    // changeDirection in so the user can tweak wording. Voice comes from the
    // source if present, else the form field.
    const text = isVar
      ? fuseVariantPrompt(p.prompt, p.changeDirection)
      : p.prompt;
    const voice = (isVar ? req.source?.sourceVoice : undefined) || form.voice;
    const res = await fetch(`/api/works/${workId}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        voice,
        provider: form.ttsProvider ?? "auto",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`tts dispatch failed (${res.status}) ${text}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["assets", workId] });
  }

  async function dispatchProviderGenerate(req: GenerationRequest): Promise<void> {
    if (!selectedProviderId) return;
    const p = req.params;
    if (p.kind !== "video") return;
    const isVar = req.mode === "variant";
    const prompt = isVar
      ? fuseVariantPrompt(p.prompt, p.changeDirection)
      : p.prompt;
    // Only forward aspectRatio when the user picked a real video ratio. A stale
    // image-tab value (e.g. 4:5, which the video <select> can't display) would
    // otherwise reach the seedance gateway as an off-enum value. Omitting it
    // lets the server canvas-follow the work's composition aspect — same default
    // as the agent /api/generate/video path.
    const aspectRatio = (VIDEO_ASPECTS as readonly string[]).includes(
      form.aspectRatio ?? "",
    )
      ? form.aspectRatio
      : undefined;
    const durationSec = Number(form.duration) || 5;
    // Variant anchor: the source clip's uri becomes the i2v first frame. An
    // explicit imageUrl field (create-mode i2v) takes precedence.
    const firstFrameImage =
      p.imageUrl || (isVar ? (req.source?.uri ?? undefined) : undefined);
    const res = await fetch(
      `/api/providers/${selectedProviderId}/generate-video`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workId,
          prompt,
          durationSec,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(firstFrameImage ? { firstFrameImage } : {}),
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`provider dispatch failed (${res.status}) ${text}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["assets", workId] });
  }

  async function onGenerate() {
    if (!isFormReady(form, source)) return;
    setDispatchError(null);
    const request = formStateToRequest(form, source);
    setIsGenerating(true);
    try {
      // B3 — every path direct-dispatches; no chat death-envelope.
      if (shouldDispatchProvider) {
        await dispatchProviderGenerate(request);
      } else if (shouldDispatchTts) {
        await dispatchTtsGenerate(request);
      } else if (form.kind === "image") {
        await dispatchImageGenerate(request);
      } else if (form.kind === "audio" && form.audioSubKind === "bgm") {
        await dispatchBgmGenerate(request);
      } else {
        // Reachable only when kind===video but no real provider is selected
        // (the dropdown is empty / errored). Surface a clear error instead of
        // silently doing nothing.
        throw new Error("no video provider selected");
      }
    } catch (err) {
      // The thrown message is raw English server text — show the localized
      // fallback and keep the technical detail in the console for debugging.
      console.warn("[generation] dispatch failed:", err);
      setDispatchError(
        shouldDispatchTts
          ? t("studio.generationDialog.ttsErrFallback")
          : t("studio.generationDialog.errFallback"),
      );
      setIsGenerating(false);
      return; // keep dialog open so user sees the error
    }
    setIsGenerating(false);
    onOpenChange(false);
  }

  const ready = isFormReady(form, source);
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount key="generation-dialog-portal">
            <Dialog.Overlay asChild forceMount>
              <motion.div
                style={overlayStyle}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                style={contentStyle}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              >
          <header style={headerStyle}>
            <Dialog.Title style={titleStyle}>
              {isVariant ? t("studio.generationDialog.headerCreateVariant") : t("studio.generationDialog.headerCreateAsset")}
            </Dialog.Title>
            <Dialog.Description style={subtitleStyle}>
              {isVariant
                ? t("studio.generationDialog.subtitleVariant", {
                    name: source?.name ?? "source",
                  })
                : t("studio.generationDialog.subtitleCreate")}
            </Dialog.Description>
          </header>

          {!isVariant && (
            <div style={tabsStyle}>
              {(["image", "video", "audio"] as AssetKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => patch("kind", k)}
                  style={tabBtnStyle(form.kind === k)}
                >
                  {k}
                </button>
              ))}
            </div>
          )}

          <div style={bodyStyle}>
            {isVariant && (
              <Field label={t("studio.generationDialog.fieldSource")}>
                <div style={sourceCardStyle}>
                  <div style={{ fontWeight: 600 }}>{source?.name}</div>
                  <div style={{ color: "var(--text-dimmer)", fontSize: 11 }}>
                    {source?.id} · {source?.sourceModel ?? "unknown model"}
                  </div>
                  {source?.sourcePrompt && (
                    <div
                      style={{
                        marginTop: 6,
                        color: "var(--text-soft)",
                        fontStyle: "italic",
                        fontFamily: "var(--font-serif-italic)",
                      }}
                    >
                      “{source.sourcePrompt}”
                    </div>
                  )}
                </div>
              </Field>
            )}

            {/* #92 — the provider list is video-only (all entries are t2v/i2v
                models; hint literally reads "用于视频生成的服务方"). image/audio
                generation ignores selectedProviderId entirely — they
                direct-dispatch to /api/generate/image and /api/generate/bgm,
                which pick their own provider server-side — so showing this
                select on those tabs would be a misleading dead control that
                defaults to a *video* model. Gate it to the VIDEO tab. Stub
                providers are also disabled so they can't be picked. */}
            {form.kind === "video" && providers.length > 0 && (
              <Field label={t("studio.generationDialog.fieldProvider")} hint={t("studio.generationDialog.fieldProviderHint")}>
                <select
                  aria-label="Provider"
                  value={selectedProviderId ?? ""}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                  style={inputStyle}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.stub}>
                      {p.displayName}
                      {p.stub ? " (stub)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {/* R24: surface providers fetch error. Previously fetchProviders
                degraded silently to [], indistinguishable from "no providers
                configured" — user saw the dialog with no provider field and
                no clue why. Now apiFetch throws on non-2xx → providersQuery
                .isError flips → render inline alert.
                #92 — providers only matter for the VIDEO tab, so a fetch
                error is irrelevant noise on image/audio; gate it too. */}
            {form.kind === "video" && providersQuery.isError && (
              <div
                role="alert"
                style={{
                  padding: "8px 10px",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--status-error, #d4756c)",
                  background: "rgba(212, 117, 108, 0.08)",
                  border: "1px solid var(--status-error, #d4756c)",
                  borderRadius: 6,
                  lineHeight: 1.5,
                }}
              >
                {t("studio.generationDialog.providersLoadFailed", {
                  msg:
                    providersQuery.error instanceof Error
                      ? providersQuery.error.message
                      : String(providersQuery.error),
                })}
              </div>
            )}

            {isVariant ? (
              <Field
                label={t("studio.generationDialog.fieldChangeDirection")}
                hint="What should differ from the source? Keep subject/setting unless you say otherwise."
              >
                <textarea
                  value={form.changeDirection}
                  onChange={(e) => patch("changeDirection", e.target.value)}
                  rows={3}
                  placeholder="e.g. slower droop, warmer color grade, swap text to '我也想躺平'"
                  style={inputStyle}
                />
              </Field>
            ) : (
              <Field
                label={form.kind === "audio" && form.audioSubKind === "tts" ? t("studio.generationDialog.fieldScript") : t("studio.generationDialog.fieldPrompt")}
                hint={
                  form.kind === "audio" && form.audioSubKind === "tts"
                    ? t("studio.generationDialog.fieldScriptHint")
                    : t("studio.generationDialog.fieldPromptHint")
                }
              >
                <textarea
                  value={form.prompt}
                  onChange={(e) => patch("prompt", e.target.value)}
                  rows={3}
                  placeholder={promptPlaceholder(form)}
                  style={inputStyle}
                />
              </Field>
            )}

            {form.kind === "image" && (
              <ImageFields form={form} patch={patch} />
            )}
            {form.kind === "video" && (
              <VideoFields form={form} patch={patch} />
            )}
            {form.kind === "audio" && (
              <AudioFields form={form} patch={patch} disableSubKindToggle={isVariant} />
            )}
          </div>

          {isGenerating && (
            <div
              role="status"
              aria-live="polite"
              data-testid="generation-progress"
              style={progressStyle}
            >
              <span style={pulseDotStyle} aria-hidden="true" />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={progressLabelStyle}>
                  {shouldDispatchProvider ? (
                    <>
                      Generating via {selectedProvider?.displayName ?? "provider"}
                      {" · "}
                      typically 70-180s for Seedance
                    </>
                  ) : shouldDispatchTts ? (
                    t("studio.generationDialog.ttsGenerating")
                  ) : (
                    t("studio.generationDialog.generatingGeneric")
                  )}
                </span>
                <span style={progressTimerStyle}>
                  {t("studio.generationDialog.progressElapsed", { time: formatElapsed(elapsedSec) })}
                </span>
              </div>
            </div>
          )}
          {dispatchError && (
            <div role="alert" style={errorStyle}>
              {dispatchError}
            </div>
          )}
          <footer style={footerStyle}>
            <button
              type="button"
              style={cancelBtnStyle}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              style={generateBtnStyle(ready && !isGenerating)}
              disabled={!ready || isGenerating}
              onClick={() => {
                void onGenerate();
              }}
            >
              {isGenerating ? t("studio.generationDialog.btnGenerating") : t("studio.generationDialog.btnGenerate")}
            </button>
          </footer>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

// ─── Field sub-components ────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint && <span style={hintStyle}>{hint}</span>}
    </label>
  );
}

function ImageFields({
  form,
  patch,
}: {
  form: FormState;
  patch: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const t = useT();
  return (
    <>
      <Row>
        <Field label={t("studio.generationDialog.fieldAspectRatio")}>
          <select
            value={form.aspectRatio ?? "1:1"}
            onChange={(e) => patch("aspectRatio", e.target.value)}
            style={inputStyle}
          >
            {IMAGE_ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Style (optional)">
          <input
            type="text"
            value={form.style ?? ""}
            onChange={(e) => patch("style", e.target.value || undefined)}
            placeholder="editorial cool glass"
            style={inputStyle}
          />
        </Field>
      </Row>
      <Row>
        <Field label="Width (optional)">
          <input
            type="number"
            value={form.width ?? ""}
            onChange={(e) =>
              patch("width", clampNumericInput(e.target.value, { min: 1 }))
            }
            placeholder="1080"
            min={1}
            style={inputStyle}
          />
        </Field>
        <Field label="Height (optional)">
          <input
            type="number"
            value={form.height ?? ""}
            onChange={(e) =>
              patch("height", clampNumericInput(e.target.value, { min: 1 }))
            }
            placeholder="1920"
            min={1}
            style={inputStyle}
          />
        </Field>
      </Row>
    </>
  );
}

function VideoFields({
  form,
  patch,
}: {
  form: FormState;
  patch: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const t = useT();
  return (
    <>
      <Row>
        <Field label="Duration (s)">
          <select
            value={form.duration}
            onChange={(e) => patch("duration", e.target.value)}
            style={inputStyle}
          >
            {VIDEO_DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </select>
        </Field>
        {/* B3 — the resolution <select> was a dead control: the dispatch
            endpoint (/api/providers/:id/generate-video) has no `resolution`
            parameter (only durationSec / aspectRatio / firstFrameImage), so the
            value was always silently dropped. Removed rather than left dangling
            — output dimensions follow the work's canvas + chosen aspectRatio. */}
        <Field label={t("studio.generationDialog.fieldAspectRatio")}>
          <select
            value={form.aspectRatio ?? "9:16"}
            onChange={(e) => patch("aspectRatio", e.target.value)}
            style={inputStyle}
          >
            {VIDEO_ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
      </Row>
      <Field label="Source image URL (optional)" hint="Routes via image-to-video">
        <input
          type="text"
          value={form.imageUrl ?? ""}
          onChange={(e) => patch("imageUrl", e.target.value || undefined)}
          placeholder="/api/works/.../assets/images/foo.png"
          style={inputStyle}
        />
      </Field>
    </>
  );
}

function AudioFields({
  form,
  patch,
  disableSubKindToggle,
}: {
  form: FormState;
  patch: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  disableSubKindToggle: boolean;
}) {
  const t = useT();
  return (
    <>
      {!disableSubKindToggle && (
        <div style={subTabsStyle}>
          {(["bgm", "tts"] as AudioSubKind[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => patch("audioSubKind", s)}
              style={subTabBtnStyle(form.audioSubKind === s)}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {form.audioSubKind === "tts" ? (
        <>
          <Field label={t("studio.generationDialog.fieldVoice")}>
            <select
              value={form.voice ?? TTS_VOICES[0].value}
              onChange={(e) => patch("voice", e.target.value)}
              style={inputStyle}
            >
              {TTS_VOICES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("studio.generationDialog.ttsProviderLabel")}>
            <select
              aria-label={t("studio.generationDialog.ttsProviderLabel")}
              value={form.ttsProvider ?? "auto"}
              onChange={(e) =>
                patch(
                  "ttsProvider",
                  e.target.value as "auto" | "edge-tts" | "openai",
                )
              }
              style={inputStyle}
            >
              <option value="auto">
                {t("studio.generationDialog.ttsProviderAuto")}
              </option>
              <option value="edge-tts">
                {t("studio.generationDialog.ttsProviderEdge")}
              </option>
              <option value="openai">
                {t("studio.generationDialog.ttsProviderOpenai")}
              </option>
            </select>
          </Field>
        </>
      ) : (
        <Field label="Duration (seconds)">
          <input
            type="number"
            value={form.durationSeconds ?? 30}
            onChange={(e) =>
              patch(
                "durationSeconds",
                clampNumericInput(e.target.value, { min: 5, max: 180 }),
              )
            }
            min={5}
            max={180}
            style={inputStyle}
          />
        </Field>
      )}
    </>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{children}</div>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * #75 — parse + clamp a number-input value at the edit site.
 *
 * HTML `min`/`max` only gate the spinner buttons and the `:invalid` pseudo
 * -class; a typed value (`-5`, `9999`, `7.5`) sails straight through onChange.
 * In this dialog those values become `--duration` / `--image-size` args for a
 * *paid, long-running* generation script (dispatchGeneration.ts:228,293), so
 * "the browser will catch it" is doubly false here. F155 already learned this
 * for the VIDEO duration (locked to a `<select>`) but the BGM/image siblings
 * were left as bare inputs — this helper is the shared clamp they all route
 * through so the next numeric field can't forget (same lesson as the
 * StaticPropsPanel/#56 + TextClipPanel/#58 edit-site clamps).
 *
 * Semantics: empty string → `undefined` (caller falls back to its default);
 * NaN → `undefined`; otherwise round-to-int (these fields are all integral —
 * seconds, pixels) and clamp into [min, max] when provided.
 */
export function clampNumericInput(
  raw: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  if (raw === "") return undefined;
  let v = Number(raw);
  if (!Number.isFinite(v)) return undefined;
  v = Math.round(v);
  if (typeof opts.min === "number") v = Math.max(opts.min, v);
  if (typeof opts.max === "number") v = Math.min(opts.max, v);
  return v;
}

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function promptPlaceholder(form: FormState): string {
  if (form.kind === "image") return "panda eating bamboo, editorial color grade";
  if (form.kind === "video")
    return "panda lazily blinking, slow camera push-in, golden hour";
  if (form.audioSubKind === "tts") return "你好，欢迎来到 AutoViral";
  return "warm cinematic ambient pad, 80 BPM, sparse";
}

// ─── Styles (inline — matches Tweaks panel idiom) ────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(10, 11, 15, 0.55)",
  backdropFilter: "blur(8px) saturate(120%)",
  WebkitBackdropFilter: "blur(8px) saturate(120%)",
  zIndex: 1000,
};

const contentStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(560px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 64px)",
  overflowY: "auto",
  background: "var(--surface-1)",
  border: "1px solid var(--glass-border)",
  borderRadius: 16,
  padding: 0,
  zIndex: 1001,
  backdropFilter: "blur(24px) saturate(140%)",
  WebkitBackdropFilter: "blur(24px) saturate(140%)",
  boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
};

const headerStyle: React.CSSProperties = {
  padding: "20px 22px 12px",
  borderBottom: "1px solid var(--glass-border)",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-serif-italic)",
  fontStyle: "italic",
  fontSize: 24,
  margin: 0,
  letterSpacing: "-0.01em",
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.04em",
  color: "var(--text-dimmer)",
  marginTop: 4,
};

const tabsStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  padding: "0 22px",
  borderBottom: "1px solid var(--glass-border)",
};

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    background: "transparent",
    color: active ? "var(--accent)" : "var(--text-dimmer)",
    border: "none",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    padding: "10px 14px",
    cursor: "pointer",
  };
}

const subTabsStyle: React.CSSProperties = {
  display: "flex",
  gap: 0,
  marginBottom: 8,
};

function subTabBtnStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.16em",
    background: active ? "rgba(168, 197, 214, 0.12)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-dimmer)",
    border: "1px solid var(--glass-border)",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
    marginRight: 6,
  };
}

const bodyStyle: React.CSSProperties = {
  padding: "16px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: "1 1 0",
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--text-dimmer)",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dimmer)",
  marginTop: 2,
};

const inputStyle: React.CSSProperties = {
  background: "rgba(168, 197, 214, 0.05)",
  border: "1px solid var(--glass-border)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const sourceCardStyle: React.CSSProperties = {
  background: "rgba(168, 197, 214, 0.05)",
  border: "1px solid var(--glass-border)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 12,
};

const progressStyle: React.CSSProperties = {
  margin: "0 22px 12px",
  padding: "10px 12px",
  background: "rgba(168, 197, 214, 0.08)",
  border: "1px solid var(--glass-border)",
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const pulseDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--accent)",
  boxShadow: "0 0 12px var(--accent-glow)",
  animation: "pulse-dot 1.4s ease-in-out infinite",
  flexShrink: 0,
};

const progressLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.04em",
  color: "var(--text-soft)",
};

const progressTimerStyle: React.CSSProperties = {
  fontFamily: "var(--font-serif-italic)",
  fontStyle: "italic",
  fontSize: 13,
  color: "var(--accent)",
};

const errorStyle: React.CSSProperties = {
  margin: "0 22px 12px",
  padding: "8px 12px",
  background: "rgba(220, 80, 80, 0.08)",
  border: "1px solid rgba(220, 80, 80, 0.4)",
  borderRadius: 8,
  color: "#e08080",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
};

const footerStyle: React.CSSProperties = {
  padding: "12px 22px 18px",
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  borderTop: "1px solid var(--glass-border)",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--glass-border)",
  color: "var(--text-soft)",
  borderRadius: 8,
  padding: "8px 16px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
};

function generateBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    background: enabled
      ? "linear-gradient(135deg, var(--accent), var(--accent-hi))"
      : "rgba(168, 197, 214, 0.15)",
    color: enabled ? "var(--bg)" : "var(--text-dimmer)",
    border: "none",
    borderRadius: 8,
    padding: "8px 18px",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 600,
    cursor: enabled ? "pointer" : "not-allowed",
    boxShadow: enabled ? "0 0 24px var(--accent-glow)" : undefined,
  };
}
