import type { Filters, Effect, BlendMode } from "../../types";

const clamp = (v: number, lo = -1, hi = 1) =>
  Math.min(hi, Math.max(lo, v));

export function toCssFilter(
  f: Pick<Filters, "brightness" | "contrast" | "saturation">,
): string {
  const parts: string[] = [];
  if (f.brightness !== 0)
    parts.push(`brightness(${1 + clamp(f.brightness)})`);
  if (f.contrast !== 0) parts.push(`contrast(${1 + clamp(f.contrast)})`);
  if (f.saturation !== 0)
    parts.push(`saturate(${1 + clamp(f.saturation)})`);
  return parts.join(" ");
}

// PRD-0014 S14 — the CSS `filter` string for an ORDERED effect stack. Consumed
// IDENTICALLY by the browser preview and the headless export (renderMedia runs
// the SAME Remotion tree) — WYSIWYG by construction, no ffmpeg dual. Only the
// CSS-filter-expressible types contribute here (grade → brightness/contrast/
// saturate; blur → blur(px)); vignette / grain are painted as stacked overlay
// layers instead (effectOverlayLayers). Disabled entries are skipped but stay in
// the stack. Order is preserved (a blur BEFORE a grade reads differently than
// after — CSS applies left→right).
function gradeParts(params: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const b = params.brightness;
  const c = params.contrast;
  const s = params.saturation;
  if (typeof b === "number" && b !== 0) parts.push(`brightness(${1 + clamp(b)})`);
  if (typeof c === "number" && c !== 0) parts.push(`contrast(${1 + clamp(c)})`);
  if (typeof s === "number" && s !== 0) parts.push(`saturate(${1 + clamp(s)})`);
  return parts;
}

export function effectsToCssFilter(effects: Effect[] | undefined): string {
  if (!effects || effects.length === 0) return "";
  const parts: string[] = [];
  for (const eff of effects) {
    if (eff.enabled === false) continue;
    const params = (eff.params ?? {}) as Record<string, unknown>;
    if (eff.type === "grade") {
      parts.push(...gradeParts(params));
    } else if (eff.type === "blur") {
      const radius = typeof params.radius === "number" ? params.radius : 8;
      if (radius > 0) parts.push(`blur(${radius}px)`);
    }
    // vignette / grain are not CSS `filter` functions — see effectOverlayLayers.
  }
  return parts.join(" ");
}

// PRD-0014 S14 — the OVERLAY layers for effect types that can't be a CSS `filter`
// function: `vignette` (a radial darkening) + `grain` (a soft noise veil). Each
// enabled entry yields one absolutely-filled div style, stacked over the clip
// body in stack order. `strength`/`opacity` params tune intensity.
export function effectOverlayLayers(
  effects: Effect[] | undefined,
): { key: string; testId: string; style: React.CSSProperties }[] {
  if (!effects || effects.length === 0) return [];
  const out: { key: string; testId: string; style: React.CSSProperties }[] = [];
  for (const eff of effects) {
    if (eff.enabled === false) continue;
    const params = (eff.params ?? {}) as Record<string, unknown>;
    if (eff.type === "vignette") {
      const strength = typeof params.strength === "number" ? clamp(params.strength, 0, 1) : 0.5;
      out.push({
        key: eff.id,
        testId: "effect-vignette",
        style: {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength}) 100%)`,
        },
      });
    } else if (eff.type === "grain") {
      const opacity = typeof params.opacity === "number" ? clamp(params.opacity, 0, 1) : 0.12;
      // A tiny fractal-noise SVG tiled as the grain texture (self-contained, no
      // external asset — survives the headless export).
      const noise =
        `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>` +
        `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter>` +
        `<rect width='100%' height='100%' filter='url(%23n)'/></svg>`;
      out.push({
        key: eff.id,
        testId: "effect-grain",
        style: {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity,
          mixBlendMode: "overlay",
          backgroundImage: `url("data:image/svg+xml,${noise}")`,
        },
      });
    }
  }
  return out;
}

// PRD-0014 S14 — map a `blendMode` to its CSS `mix-blend-mode` value. `normal` /
// undefined → undefined (no blend wrapper, back-compat). "add" → the CSS
// `plus-lighter` value; screen/multiply/overlay are literal CSS blend modes.
export function blendModeToCss(bm: BlendMode | undefined): string | undefined {
  if (!bm || bm === "normal") return undefined;
  if (bm === "add") return "plus-lighter";
  return bm;
}
