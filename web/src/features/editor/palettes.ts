import type { PaletteId } from "./types";

export interface Palette {
  id: PaletteId;
  name: string;
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  surface: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  mono: {
    id: "mono",
    name: "Mono",
    bg: "#fafaf7",
    fg: "#0a0b0f",
    accent: "#2a3a4a",
    muted: "#7a7a78",
    surface: "#efece5",
  },
  pastel: {
    id: "pastel",
    name: "Pastel",
    bg: "#fff5f5",
    fg: "#3d2c2e",
    accent: "#e58291",
    muted: "#b0838a",
    surface: "#fce7e8",
  },
  neon: {
    id: "neon",
    name: "Neon",
    bg: "#0a0b0f",
    fg: "#fafaf7",
    accent: "#a8c5d6",
    muted: "#5a6e7f",
    surface: "#11141a",
  },
  earth: {
    id: "earth",
    name: "Earth",
    bg: "#efe6d0",
    fg: "#3d2f1e",
    accent: "#8b6f3a",
    muted: "#9c8866",
    surface: "#e0d4b8",
  },
  noir: {
    id: "noir",
    name: "Noir",
    bg: "#1a1718",
    fg: "#f5ecdf",
    accent: "#d8b576",
    muted: "#7a6f5e",
    surface: "#2a2326",
  },
};

export function resolvePalette(id: PaletteId): Palette {
  return PALETTES[id] ?? PALETTES.mono;
}
