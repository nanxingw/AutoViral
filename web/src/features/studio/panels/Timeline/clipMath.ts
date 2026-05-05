import type { Clip } from "../../types";

export function clipDuration(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return Math.max(0, c.out - c.in);
  return Math.max(0, c.duration);
}

export function clipEnd(c: Clip): number {
  return c.trackOffset + clipDuration(c);
}
