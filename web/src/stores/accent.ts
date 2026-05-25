import { create } from "zustand";

export const ACCENTS = ["violet", "cyan", "coral", "lime", "steel"] as const;
export type Accent = (typeof ACCENTS)[number];

interface AccentStore {
  accent: Accent;
  setAccent: (a: Accent) => void;
}

const STORAGE_KEY = "av-accent";

function applyToDOM(a: Accent) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-accent", a);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, a);
  }
}

const initial: Accent = (() => {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (ACCENTS as readonly string[]).includes(saved)) {
      return saved as Accent;
    }
  }
  return "steel";
})();

export const useAccent = create<AccentStore>((set) => ({
  accent: initial,
  setAccent: (a) => {
    applyToDOM(a);
    set({ accent: a });
  },
}));

// Apply once at import time so the user's chosen accent is on <html> before
// any component renders — mirrors stores/theme.ts. See e2e-report F61.
applyToDOM(initial);
