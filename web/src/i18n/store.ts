import { create } from "zustand";
import type { LocaleId } from "./messages";

const STORAGE_KEY = "autoviral.locale";

/**
 * Initial locale resolution order:
 *   1. localStorage (user explicitly toggled before)
 *   2. navigator.language (browser preference) — zh* → "zh", anything else → "en"
 *   3. Hard fallback "zh" (the product's primary language).
 *
 * Tests rely on the runtime DEFAULT_LOCALE_OVERRIDE environment hook
 * (see `web/src/test/setup.ts`) to force "en" so existing
 * screen.getByText("English") matchers keep working.
 */
function detectInitial(): LocaleId {
  // Tests opt-in via this global before importing the store.
  const override = (globalThis as { __AUTOVIRAL_LOCALE__?: LocaleId })
    .__AUTOVIRAL_LOCALE__;
  if (override === "en" || override === "zh") return override;

  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") return stored;
    } catch {
      // localStorage may be blocked — fall through.
    }
    const lang = window.navigator?.language ?? "";
    if (/^zh/i.test(lang)) return "zh";
    return "en";
  }
  return "zh";
}

interface LocaleState {
  locale: LocaleId;
  setLocale: (l: LocaleId) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectInitial(),
  setLocale: (l) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, l);
      } catch {
        // ignore storage failures — in-memory locale still updates.
      }
    }
    set({ locale: l });
  },
}));
