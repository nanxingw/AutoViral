import { create } from "zustand";

export type Theme = "dark" | "light";

interface ThemeStore {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const STORAGE_KEY = "av-theme";

function applyToDOM(t: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", t);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, t);
  }
}

const initial: Theme = (() => {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
})();

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: initial,
  setTheme: (t) => {
    applyToDOM(t);
    set({ theme: t });
  },
  toggle: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyToDOM(next);
    set({ theme: next });
  },
}));

// Apply once at import time so SSR/CSR sync stays correct
applyToDOM(initial);
