import type { Clip } from "@/features/studio/types";
import type { Layer } from "@/features/editor/types";

/**
 * Build the short, human-readable reference phrase injected into the chat
 * composer when a user picks "加入聊天上下文" on a UI element.
 *
 * The agent learns the PRECISE element id via the viewer-context envelope —
 * the affordance selects the element first, and buildViewerContext /
 * buildEditorViewerContext already carry the selected id invisibly. So this
 * phrase only needs to be something the USER recognises and can extend, e.g.
 * type "改成红色" after it. We keep clip and layer in separate functions
 * because their schemas are intentionally heterogeneous (CLAUDE.md: read every
 * clip-kind schema before wiring) — there is no shared shape to assume.
 *
 * The kind nouns are passed in (resolved via i18n at the call site) so these
 * functions stay pure and unit-testable.
 */

/** i18n noun labels per clip kind, resolved by the caller. */
export type ClipNouns = Record<Clip["kind"], string>;
/** i18n noun labels per carousel layer kind, resolved by the caller. */
export type LayerNouns = Record<Layer["kind"], string>;

function clipName(clip: Clip): string {
  if (clip.kind === "text") return clip.text.trim().slice(0, 24);
  // video / audio / overlay all carry a `src` path — show its basename.
  const base = clip.src.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  return base.slice(0, 24);
}

/** e.g. `字幕「樱花季的味道」(3.2s)` / `视频「sakura」(0.0s)`. The trailing
 *  `(<offset>s)` gives temporal context so two clips with the same source
 *  are still distinguishable. */
export function describeClip(clip: Clip, nouns: ClipNouns): string {
  const noun = nouns[clip.kind];
  const name = clipName(clip);
  const at = `${clip.trackOffset.toFixed(1)}s`;
  return name ? `${noun}「${name}」(${at})` : `${noun}(${at})`;
}

function layerName(layer: Layer): string {
  if (layer.kind === "text") return layer.text.trim().slice(0, 24);
  return "";
}

/** e.g. `文字图层「标题」` / `形状图层(circle)` / `图片图层`. */
export function describeLayer(layer: Layer, nouns: LayerNouns): string {
  const noun = nouns[layer.kind];
  const name = layerName(layer);
  if (name) return `${noun}「${name}」`;
  if (layer.kind === "shape") return `${noun}(${layer.shape})`;
  return noun;
}
