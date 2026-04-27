import type { Filters } from "../../types";

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
