import {
  Sequence,
  Video,
  OffthreadVideo,
  useVideoConfig,
  useCurrentFrame,
  Easing,
  getRemotionEnvironment,
} from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { groupChains } from "../transitions/groupChains";
import { presentationFor } from "../transitions/presentations";
import type { Transition } from "@shared/composition";
import { resolveSourceAudio } from "@shared/composition";
import type { VideoClip, Track } from "../../types";

/** Map a transition's `easing` field to a Remotion timing function. Phase 1
 *  persisted easing/alignment but the renderer hardcoded linearTiming, so the
 *  field was dead data; this wires it: spring → springTiming, ease-in-out →
 *  eased linearTiming, linear → straight linearTiming. */
function timingFor(easing: Transition["easing"], durationInFrames: number) {
  switch (easing) {
    case "spring":
      return springTiming({ durationInFrames, config: { damping: 200 } });
    case "ease-in-out":
      return linearTiming({ durationInFrames, easing: Easing.inOut(Easing.ease) });
    case "linear":
    default:
      return linearTiming({ durationInFrames });
  }
}
import { effectsToCssFilter, effectOverlayLayers, blendModeToCss } from "../filters/cssFilters";
import { resolveClipEffects } from "@shared/composition";
import { interpolateProperty } from "@shared/keyframes";
import {
  computeVideoSpeedForFrame,
  effectiveClipDuration,
} from "@shared/speed-ramp";

/**
 * Pure helper for testability: returns the effective transform for a video
 * clip at a given clip-local frame. Each transform component falls back to
 * `clip.transforms.<prop>` when no keyframe exists for that property (D9).
 *
 * Volume keyframes are intentionally ignored on VideoClip in v1 (D5) — the
 * underlying MP4's audio track is not routed through Remotion's volume prop
 * yet. AudioClip is the only renderer that consumes volume keyframes.
 *
 * "speed" keyframes feed Remotion's playbackRate via computeVideoSpeedForFrame
 * below; they are NOT routed through the CSS transform string (D8).
 */
export function computeVideoTransformForFrame(
  clip: VideoClip,
  localFrame: number,
  fps: number,
): { scale: number; x: number; y: number; rotation: number } {
  const localSec = localFrame / fps;
  const t = clip.transforms;
  const kfs = clip.keyframes;
  return {
    scale: interpolateProperty(kfs, "scale", localSec) ?? t.scale,
    x: interpolateProperty(kfs, "x", localSec) ?? t.x,
    y: interpolateProperty(kfs, "y", localSec) ?? t.y,
    rotation: interpolateProperty(kfs, "rotation", localSec) ?? t.rotation,
  };
}

// Crossfade fix — read opacity keyframes from a video clip. Mirrors the
// OverlayTrackRenderer behavior so neighbouring video clips that overlap by a
// fade window get real CSS alpha-compositing instead of a hard cut. Default 1
// (fully visible) when no opacity keyframe is defined.
export function computeVideoOpacityForFrame(
  clip: VideoClip,
  localFrame: number,
  fps: number,
): number {
  return interpolateProperty(clip.keyframes, "opacity", localFrame / fps) ?? 1;
}

function VideoClipRenderer({ clip }: { clip: VideoClip }) {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  // S14 (PRD-0014) — the clip's ordered effect stack drives the CSS filter chain
  // (grade + blur) + the vignette/grain overlay layers. resolveClipEffects reads
  // `clip.effects` when present, else projects the legacy flat `filters` on the
  // fly — so a pre-S14 work still grades correctly (WYSIWYG by construction: the
  // SAME filter string in preview and export).
  const clipEffects = resolveClipEffects(clip);
  const filter = effectsToCssFilter(clipEffects);
  const overlays = effectOverlayLayers(clipEffects);
  const { scale, x, y, rotation } = computeVideoTransformForFrame(clip, frame, fps);
  // Phase 8.3.C — read speed keyframes (D3 fallback 1.0, D4 clamp). Routed
  // through Remotion's playbackRate prop, NOT the CSS transform (D8).
  const speed = computeVideoSpeedForFrame(clip, frame, fps);
  const opacity = computeVideoOpacityForFrame(clip, frame, fps);
  // S16 (US 25) — fit-fill mode. The renderer used to hardcode objectFit:"cover"
  // (always crop). `fitMode` (default "cover" — back-compat for pre-S16 works
  // with no field) now drives the fill:
  //   cover   → objectFit cover (crop-to-fill, legacy),
  //   contain → objectFit contain (letterbox, no crop),
  //   blur    → a blurred enlarged COVER background behind a CONTAIN foreground,
  //            so the letterbox bars become a soft blurred fill of the frame.
  const fitMode = clip.fitMode ?? "cover";
  // S18 (US 27/28) — crop + flip CONSUMPTION. flipH/flipV append a mirroring
  // scaleX(-1)/scaleY(-1) onto the existing transform chain. crop is a
  // CROP-AND-ZOOM (not a mask): the export crops the source to a SMALLER MP4
  // then Remotion objectFit:cover RESCALES it to fill the canvas, so the
  // preview must likewise ZOOM the {x,y,w,h} sub-region to fill the box. We do
  // that with an overflow:hidden wrapper window + an inner <Video> enlarged by
  // 1/w × 1/h and shifted by -x/w × -y/h (sprite-sheet crop-zoom). Absent =
  // no-op (back-compat for every pre-S18 work). This mirrors the export
  // filtergraph in src/server/transforms-ffmpeg.ts (WYSIWYG by construction —
  // both sides show the SAME zoomed-to-fill sub-region, see cropFlip test).
  const flip = cssFlipSuffix(clip.transforms);
  const zoom = cssCropZoom(clip.transforms.crop);
  const transform =
    `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})` + flip;
  // S2 (PRD-0012 / issue 026) — render-environment branch. This SAME
  // component tree is used by BOTH the browser preview AND server-side
  // export (headless Chromium runs renderMedia/renderFrames against the
  // exact <Scene>/<VideoTrackRenderer> the player uses — there is no
  // separate "server render path"). Each side needs a different <video>
  // primitive:
  //   - Browser preview (isRendering=false): <Video> (single native
  //     <video> element, browser-native decode/seek). Kept because
  //     <OffthreadVideo> in the player spawns a chunk pool of ~16 hidden
  //     <video> tags that exhaust Chrome's hardware decoder budget,
  //     producing periodic ~3s playback hitches as the browser LRU-evicts
  //     and re-decodes IDR frames. (2026-05-08 decision — do not revert.)
  //   - Server render (isRendering=true): <OffthreadVideo> (ffmpeg frame
  //     extraction). Native <video>.currentTime seeks are NOT frame-exact —
  //     they snap to the nearest keyframe of the source's GOP — which is
  //     exactly what baked periodic backward-jump jitter into every export
  //     (docs/issues/026-export-backward-frame-jitter.md). OffthreadVideo
  //     extracts the requested frame directly via ffmpeg, so it is exact.
  // `isRendering` has no decoder-budget concern in headless render (no
  // player UI, no "~16 hidden video tags" competing for hardware decoders),
  // so OffthreadVideo is safe there and is Remotion's own recommendation for
  // server rendering.
  const { isRendering } = getRemotionEnvironment();
  const VideoEl = isRendering ? OffthreadVideo : Video;
  // S19 (US 29/30) — freeze a single source frame. When freezeAtSec is set the
  // preview HOLDS one frame: startFrom = round(freezeAtSec*fps), endAt = that+1
  // (a one-frame span the <Sequence> repeats for the clip duration). This is
  // the WYSIWYG half — preview freezes on the SAME frame the ffmpeg trim+tpad
  // pass bakes into the export (transforms-ffmpeg.timeWarpVideoFilterChain).
  const freezeStart =
    clip.freezeAtSec != null ? Math.round(clip.freezeAtSec * fps) : null;
  // S5 (PRD-0014) — source-audio gate. enabled:false → muted (detachAudio pulled
  // the clip's own audio out to a first-class AudioClip; the source must NOT
  // double-play). When enabled, `volume` scales the embedded audio (default 1).
  // Consumed identically in preview (<Video>) and export (<OffthreadVideo>) — so
  // muting the source on export is WYSIWYG by construction (single renderer).
  const srcAudio = resolveSourceAudio(clip);
  // Shared across BOTH branches — src/trim/speed are identical for preview
  // and export (WYSIWYG by construction).
  const baseProps = {
    src: clip.src,
    startFrom: freezeStart != null ? freezeStart : Math.round(clip.in * fps),
    endAt: freezeStart != null ? freezeStart + 1 : Math.round(clip.out * fps),
    playbackRate: speed,
    muted: !srcAudio.enabled,
    volume: srcAudio.volume,
  } as const;
  // Preview-ONLY props. <Video>'s native <video> element does discrete
  // browser seeks under decoder/main-thread pressure, which the user
  // perceives as a "rewind"; these two props smooth that out. They are
  // meaningless (and unsupported) on <OffthreadVideo> — ffmpeg frame
  // extraction has no buffering/seek-drift concept — so they must NOT be
  // forwarded on the render branch (S2 fix; previously always-on, which let
  // the export silently tolerate up to 1.2s of uncorrected seek drift).
  //
  // R47-fix5 (Codex pick 2) — widen Remotion's hard-seek drift tolerance
  // from the default 0.45s. Below the threshold Remotion just nudges
  // currentTime; above it does a discrete seek (which the user perceives as
  // a "rewind"). The default trips on every long main-thread commit /
  // decoder hiccup; 1.2s lets normal drift settle on its own. Pairs with
  // `pauseWhenBuffering` so we don't seek during load events either.
  const previewOnlyProps = isRendering
    ? {}
    : ({
        acceptableTimeShiftInSeconds: 1.2,
        pauseWhenBuffering: true,
      } as const);

  // S18 review fix (critical/medium) — the crop-zoom geometry lives on the
  // inner <Video> (position:absolute width/height/left/top from `zoom`); the
  // overflow:hidden window that clips the enlarged frame to the box is the
  // wrapper. When there's no crop, zoom is null and the inner layer keeps the
  // legacy 100%-fill sizing inside a plain (overflow:visible) wrapper, so a
  // pre-S18 clip renders byte-identically.
  const innerSizing = zoom
    ? { position: "absolute" as const, ...zoom }
    : { width: "100%", height: "100%" };

  // blur → two stacked layers: a blurred cover fill behind a contained frame.
  // BOTH layers must consume the same crop-zoom + flip so the blurred backdrop
  // is the SAME (cropped, mirrored) frame the export bakes into its single
  // source MP4 (review fix medium — blur background used to show the un-cropped
  // un-flipped original, diverging from export).
  let body: React.ReactNode;
  if (fitMode === "blur") {
    body = (
      <div style={{ position: "absolute", inset: 0, opacity, overflow: "hidden" }}>
        <VideoEl
          {...baseProps}
          {...previewOnlyProps}
          // S5 — the blur backdrop is a SECOND stacked <video> of the same source;
          // it must stay silent so a source-audio-enabled clip doesn't double-play
          // (only the foreground contained layer carries baseProps' muted/volume).
          muted
          style={{
            ...innerSizing,
            objectFit: "cover",
            // The blurred background scales slightly past the frame so the blur
            // has no hard edges, and stacks the clip's own filter chain on top.
            filter: `blur(48px) ${filter || ""}`.trim(),
            transform: `${transform} scale(1.1)`,
          }}
        />
        <VideoEl
          {...baseProps}
          {...previewOnlyProps}
          style={{
            ...innerSizing,
            objectFit: "contain",
            filter: filter || undefined,
            transform,
          }}
        />
      </div>
    );
  } else {
    // cover / contain → a single layer, objectFit driven by fitMode. When crop is
    // present the layer is zoomed (innerSizing) and must be clipped by an
    // overflow:hidden window; otherwise it's the legacy bare <Video>/<OffthreadVideo>.
    const layer = (
      <VideoEl
        {...baseProps}
        {...previewOnlyProps}
        style={{
          ...innerSizing,
          objectFit: fitMode === "contain" ? "contain" : "cover",
          filter: filter || undefined,
          transform,
          opacity: zoom ? undefined : opacity,
        }}
      />
    );
    body = !zoom ? (
      layer
    ) : (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity }}>
        {layer}
      </div>
    );
  }

  // S13 (PRD-0014) — rect/ellipse MASK. Wrap the clip body in an element carrying
  // a CSS `mask-image` (an inline SVG shape + optional gaussian-blur feather),
  // consumed IDENTICALLY by the browser preview and the headless export
  // (renderMedia runs this SAME component tree in Chromium) — WYSIWYG by
  // construction, no ffmpeg dual (S13 单渲染器原则). Absent = no wrapper
  // (back-compat for every pre-S13 work). The badge below stays OUTSIDE the mask.
  // S14 (PRD-0014) — vignette / grain effect overlays stack OVER the clip body
  // (inside the mask so they are clipped to the shape too). Absent = unchanged.
  const bodyWithOverlays =
    overlays.length === 0 ? (
      body
    ) : (
      <>
        {body}
        {overlays.map((o) => (
          <div key={o.key} data-test={o.testId} style={o.style} />
        ))}
      </>
    );

  const maskDef = buildClipMask(clip.mask, { width, height });
  const masked = maskDef ? (
    <div
      data-test="clip-mask"
      style={{
        position: "absolute",
        inset: 0,
        maskImage: maskDef.maskImage,
        WebkitMaskImage: maskDef.maskImage,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    >
      {bodyWithOverlays}
    </div>
  ) : (
    bodyWithOverlays
  );

  // S14 (PRD-0014) — blendMode composites the WHOLE clip (masked body + overlays)
  // against the z-lower tracks via CSS `mix-blend-mode`. Absent / normal → no
  // wrapper (back-compat). Consumed identically in preview + export.
  const blend = blendModeToCss(clip.blendMode);
  const composited = blend ? (
    <div
      data-test="clip-blend"
      style={{ position: "absolute", inset: 0, mixBlendMode: blend as React.CSSProperties["mixBlendMode"] }}
    >
      {masked}
    </div>
  ) : (
    masked
  );

  // S19 (US 29/30) — reverse is EXPORT-ONLY. A browser <video> can't play
  // backwards, so we do NOT fake WYSIWYG: the preview plays forward but stamps
  // an EXPLICIT placeholder badge over the clip telling the user the reverse
  // only takes effect on export (the real `reverse`/`areverse` ffmpeg pass).
  // freeze, by contrast, IS WYSIWYG (handled above via the 1-frame baseProps).
  //
  // S19 review fix — the badge MUST NOT lie. The export's
  // timeWarpVideoFilterChain gives `freezeAtSec` PRECEDENCE over `reverse`: when
  // BOTH are set the export FREEZES one frame (forward-frozen) and does NOT
  // reverse. So a "倒放 · 仅导出生效" badge would promise a reverse the export
  // never performs — a dishonest preview. When freeze is also set, suppress the
  // reverse badge (freeze is already WYSIWYG; there is no export-only reverse to
  // warn about, and definitely no phantom reverse to advertise).
  if (!clip.reverse || clip.freezeAtSec != null) return composited;
  return (
    <>
      {composited}
      <div
        data-test="reverse-export-only"
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 2,
          padding: "4px 10px",
          borderRadius: 8,
          background: "rgba(10,11,15,0.72)",
          color: "#fafaf7",
          font: "600 13px/1.3 system-ui, sans-serif",
          letterSpacing: 0.2,
          backdropFilter: "blur(8px)",
          pointerEvents: "none",
        }}
      >
        倒放 · 仅导出生效
      </div>
    </>
  );
}

/**
 * S18 — build the trailing CSS transform mirror suffix for a clip's transforms.
 * flipH → " scaleX(-1)", flipV → " scaleY(-1)", both → both. No flip → "".
 * Pure + exported so the consumption test can assert the exact string the
 * preview + the ffmpeg `hflip`/`vflip` export agree on.
 */
export function cssFlipSuffix(t: {
  flipH?: boolean;
  flipV?: boolean;
}): string {
  let suffix = "";
  if (t.flipH) suffix += " scaleX(-1)";
  if (t.flipV) suffix += " scaleY(-1)";
  return suffix;
}

/**
 * S18 (review fix critical) — map a NORMALISED crop {x,y,w,h} (fractions of the
 * source frame) to the CROP-AND-ZOOM CSS geometry for the inner <Video>, so the
 * sub-region ZOOMS to fill its box — matching the export, which crops the source
 * to a smaller MP4 then Remotion objectFit:cover rescales it to fill the canvas.
 *
 * (The OLD cssCropInset used clip-path: inset() — a MASK that kept the sub-region
 * in its original position with the rest transparent. That is a different visual
 * operation from the export's crop-then-rescale, so preview ≠ export. This helper
 * replaces it.)
 *
 * Geometry (sprite-sheet crop-zoom), with `transform-origin` left at default
 * because we size+position rather than scale:
 *   width  = 100/w %   (enlarge so the w-wide sub-region spans the full box)
 *   height = 100/h %
 *   left   = -x/w*100 %  (shift the sub-region's origin to the box origin)
 *   top    = -y/h*100 %
 * The caller renders this inside an overflow:hidden window so the enlarged frame
 * is clipped to the box. Returns undefined when crop is absent (back-compat —
 * the inner <Video> keeps its legacy 100%-fill sizing). Mirrors the export math
 * in src/server/transforms-ffmpeg.ts.
 */
export function cssCropZoom(crop?: {
  x: number;
  y: number;
  w: number;
  h: number;
}): { width: string; height: string; left: string; top: string } | undefined {
  if (!crop) return undefined;
  // Defensive clamp (review fix) — even though CropSchema now refuses out-of-
  // bounds crops on write, a hand-rolled/legacy in-memory comp could still carry
  // w/h=0 (→ div-by-zero) or off-frame values. Clamp w/h away from 0 and the
  // origin into [0,1] so the geometry never produces NaN/Infinity.
  const w = Math.min(1, Math.max(1e-4, crop.w));
  const h = Math.min(1, Math.max(1e-4, crop.h));
  const x = Math.min(1 - w, Math.max(0, crop.x));
  const y = Math.min(1 - h, Math.max(0, crop.y));
  return {
    width: pct(100 / w),
    height: pct(100 / h),
    left: pct((-x / w) * 100),
    top: pct((-y / h) * 100),
  };
}

function pct(n: number): string {
  // Trim trailing zeros so "20" not "20.000000000004"; keep CSS-valid %.
  return `${Number(n.toFixed(4))}%`;
}

/**
 * S13 (PRD-0014) — build a CSS `mask-image` for a clip's rect/ellipse mask.
 * Returns `{ maskImage, svg }` (an inline data-URI SVG the wrapper applies via
 * `mask-image` / `-webkit-mask-image`) or undefined when there is no mask.
 *
 * The SVG draws the shape as a `<path>` filled opaque (`#fff`) on a transparent
 * frame → the mask's ALPHA keeps the INSIDE of the shape (mask-image is
 * alpha-sourced). `feather` (0–1) adds an `feGaussianBlur` that softens the alpha
 * edge. `inverted` prepends a full-frame rect subpath and switches to
 * `fill-rule="evenodd"`, so the shape becomes a transparent HOLE and the OUTSIDE
 * is kept instead (cutout / vignette). Chromium rasterises this identically for
 * the browser preview and the headless export (renderMedia) — WYSIWYG by
 * construction, no ffmpeg dual. Pure + exported so its geometry is unit-tested.
 */
export function buildClipMask(
  mask:
    | {
        type: "rect" | "ellipse";
        feather?: number;
        inverted?: boolean;
        rect?: { x: number; y: number; w: number; h: number };
      }
    | undefined,
  dims: { width: number; height: number },
): { maskImage: string; svg: string } | undefined {
  if (!mask) return undefined;
  const W = dims.width;
  const H = dims.height;
  const r = mask.rect ?? { x: 0, y: 0, w: 1, h: 1 };
  // Defensive clamp — a hand-rolled/legacy comp could carry w/h=0 (→ div issues)
  // or off-frame values; keep the geometry inside [0,1] and away from zero.
  const w = Math.min(1, Math.max(1e-4, r.w));
  const h = Math.min(1, Math.max(1e-4, r.h));
  const x = Math.min(1 - w, Math.max(0, r.x));
  const y = Math.min(1 - h, Math.max(0, r.y));
  const px = x * W;
  const py = y * H;
  const pw = w * W;
  const ph = h * H;
  const shape =
    mask.type === "ellipse"
      ? svgEllipsePath(px + pw / 2, py + ph / 2, pw / 2, ph / 2)
      : svgRectPath(px, py, pw, ph);
  const inverted = mask.inverted === true;
  const d = inverted ? `${svgRectPath(0, 0, W, H)} ${shape}` : shape;
  const fillRule = inverted ? ' fill-rule="evenodd"' : "";
  const feather = Math.min(1, Math.max(0, mask.feather ?? 0));
  const hasBlur = feather > 0;
  // stdDeviation scales with feather × a fraction of the shorter frame edge, so
  // the softness reads the same on portrait and landscape frames.
  const std = hasBlur ? round2(feather * 0.12 * Math.min(W, H)) : 0;
  const filterDef = hasBlur
    ? `<filter id="avm-f" x="-25%" y="-25%" width="150%" height="150%">` +
      `<feGaussianBlur stdDeviation="${std}"/></filter>`
    : "";
  const filterAttr = hasBlur ? ` filter="url(#avm-f)"` : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    (filterDef ? `<defs>${filterDef}</defs>` : "") +
    `<path d="${d}"${fillRule} fill="#fff"${filterAttr}/>` +
    `</svg>`;
  const maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return { maskImage, svg };
}

function svgRectPath(x: number, y: number, w: number, h: number): string {
  return `M${round2(x)} ${round2(y)}H${round2(x + w)}V${round2(y + h)}H${round2(x)}Z`;
}

function svgEllipsePath(cx: number, cy: number, rx: number, ry: number): string {
  // Two half-arcs sweep the full ellipse (SVG has no ellipse path primitive).
  return (
    `M${round2(cx - rx)} ${round2(cy)}` +
    `A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx + rx)} ${round2(cy)}` +
    `A${round2(rx)} ${round2(ry)} 0 1 0 ${round2(cx - rx)} ${round2(cy)}Z`
  );
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * S3 (PRD-0014) — a transparent full-frame scene used as the "before" sequence
 * of a clip's ENTRANCE transition. The entrance presentation composites the
 * incoming clip OVER this blank, so the clip fades/glitches/whips in from
 * nothing at its head. Kept dead-simple (an absolutely-filled empty div) so it
 * adds no pixels of its own.
 */
function BlankScene() {
  return <div style={{ position: "absolute", inset: 0 }} data-test="entrance-blank" />;
}

/**
 * S3 (PRD-0014) — build the leading `[blankSequence, transition]` nodes that put
 * a clip's `transitionIn` presentation at its HEAD, inside a <TransitionSeries>.
 * The blank sequence + the transition BOTH span `entranceFrames`; the transition
 * overlaps them so the clip's own sequence still starts at chain-local frame 0
 * (no time shift — the entrance overlays the clip's first `entranceFrames`).
 * Returns `[]` when the clip has no entrance. Same component drives preview +
 * export (WYSIWYG by construction — no ffmpeg dual, mirrors the S2 cut-point
 * presets).
 */
function entranceNodes(
  clip: VideoClip,
  fps: number,
  dims: { width: number; height: number },
): React.ReactNode[] {
  const ti = clip.transitionIn;
  if (!ti) return [];
  const entranceFrames = Math.max(1, Math.round(ti.durationSec * fps));
  return [
    <TransitionSeries.Sequence
      key={`entrance-blank-${clip.id}`}
      durationInFrames={entranceFrames}
    >
      <BlankScene />
    </TransitionSeries.Sequence>,
    <TransitionSeries.Transition
      key={`entrance-tr-${clip.id}`}
      presentation={presentationFor(ti.preset, dims)}
      timing={timingFor(ti.easing ?? "linear", entranceFrames)}
    />,
  ];
}

export function VideoTrackRenderer({ track }: { track: Track }) {
  const { fps, width, height } = useVideoConfig();
  if (track.hidden) return null;
  const dims = { width, height };
  const chains = groupChains(track.clips as VideoClip[], track.transitions ?? []);
  return (
    <>
      {chains.map((chain) => {
        const first = chain.clips[0];
        const from = Math.round(first.trackOffset * fps);
        // S3 — an entrance transition on the chain's FIRST clip prepends a
        // blank + transition inside a <TransitionSeries>. It is ORTHOGONAL to
        // the cut-point transitions between clips (both can be present).
        const entrance = entranceNodes(first, fps, dims);
        // Single-clip chain with NO entrance → plain <Sequence> (unchanged
        // behaviour). This covers ALL tracks until the user adds a transition;
        // matters for back-compat with every existing test + work.
        if (chain.clips.length === 1 && entrance.length === 0) {
          const dur = Math.max(1, Math.round(effectiveClipDuration(first) * fps));
          return (
            <Sequence key={first.id} from={from} durationInFrames={dur}>
              <VideoClipRenderer clip={first} />
            </Sequence>
          );
        }
        // Single-clip chain WITH an entrance → wrap the lone clip in a
        // <TransitionSeries> [blank, entrance-transition, clip]. Total span =
        // clipDur (the transition overlaps the blank), so timeline timing is
        // preserved.
        if (chain.clips.length === 1) {
          const clipDur = Math.max(1, Math.round(effectiveClipDuration(first) * fps));
          return (
            <Sequence key={first.id} from={from} durationInFrames={clipDur}>
              <TransitionSeries>
                {entrance}
                <TransitionSeries.Sequence
                  key={`s-${first.id}`}
                  durationInFrames={clipDur}
                >
                  <VideoClipRenderer clip={first} />
                </TransitionSeries.Sequence>
              </TransitionSeries>
            </Sequence>
          );
        }
        // Multi-clip chain → wrap the chain at its first clip's time, then let
        // Remotion's <TransitionSeries> compose .Sequence + .Transition. The
        // transition consumes durationInFrames from BOTH adjacent sequences
        // (handles), shortening the chain by sum(transition durations) — same
        // visual outcome as the EXPORT because Stage 1 of render-pipeline runs
        // this exact <Scene/> (WYSIWYG by construction, #54 Phase 1). EVERY clip's
        // own `transitionIn` is honoured (not just the first) — see the per-clip
        // nesting below.
        return (
          <Sequence key={chain.clips.map((c) => c.id).join(":")} from={from}>
            <TransitionSeries>
              {chain.clips.flatMap((c, i) => {
                const seqDur = Math.max(1, Math.round(effectiveClipDuration(c) * fps));
                // S3 review fix (finding #1) — a clip's entrance is ORTHOGONAL to
                // the cut-point transition that may precede it. A NON-first clip
                // already sits after a <TransitionSeries.Transition>, so its own
                // entrance can't be prepended at the outer level; instead we nest
                // `[blank, entrance, clip]` INSIDE the clip's own sequence. The
                // inner series total span = seqDur (the entrance overlaps the
                // blank), so chain timing is byte-identical. The FIRST clip goes
                // through the SAME nesting (no more outer-level prepend), so first
                // and non-first clips honour transitionIn uniformly. Clips with no
                // entrance render the bare <VideoClipRenderer> exactly as before,
                // so a chain with zero entrances is unchanged (back-compat).
                const clipEntrance = entranceNodes(c, fps, dims);
                const clipSeq =
                  clipEntrance.length === 0 ? (
                    <TransitionSeries.Sequence
                      key={`s-${c.id}`}
                      durationInFrames={seqDur}
                    >
                      <VideoClipRenderer clip={c} />
                    </TransitionSeries.Sequence>
                  ) : (
                    <TransitionSeries.Sequence
                      key={`s-${c.id}`}
                      durationInFrames={seqDur}
                    >
                      <TransitionSeries>
                        {clipEntrance}
                        <TransitionSeries.Sequence
                          key={`si-${c.id}`}
                          durationInFrames={seqDur}
                        >
                          <VideoClipRenderer clip={c} />
                        </TransitionSeries.Sequence>
                      </TransitionSeries>
                    </TransitionSeries.Sequence>
                  );
                const nodes: React.ReactNode[] = [clipSeq];
                const t = chain.transitions[i];
                if (t) {
                  const trDur = Math.max(1, Math.round(t.durationSec * fps));
                  nodes.push(
                    <TransitionSeries.Transition
                      key={`t-${t.id}`}
                      presentation={presentationFor(t.preset, { width, height })}
                      timing={timingFor(t.easing, trDur)}
                    />,
                  );
                }
                return nodes;
              })}
            </TransitionSeries>
          </Sequence>
        );
      })}
    </>
  );
}
