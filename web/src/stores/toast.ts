import { create } from "zustand";
import { ApiError } from "@/lib/api";

// Task 5.1 — toast variants align with bridge `ui-toast` kind set
// (success / warn / error / info). The component renders a kind dot per
// variant; the store stays presentation-agnostic.
export type ToastVariant = "error" | "info" | "success" | "warn";

export interface ToastEntry {
  id: string;
  variant: ToastVariant;
  /** Pre-localized message text. Caller (or unhandledrejection listener)
   *  resolves the i18n key — the toast layer is dumb and just renders. */
  message: string;
  /** Optional secondary line (e.g. error code) shown smaller below the
   *  main message. Used for ApiError detail. */
  detail?: string;
  /** Auto-dismiss timeout in ms. 0 = sticky. */
  ttlMs: number;
  createdAt: number;
}

interface ToastStore {
  entries: ToastEntry[];
  push: (input: Omit<ToastEntry, "id" | "createdAt"> & { id?: string }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let _seq = 0;
const uid = () => `toast_${Date.now().toString(36)}_${(++_seq).toString(36)}`;

export const useToastStore = create<ToastStore>((set) => ({
  entries: [],
  push: (input) => {
    const id = input.id ?? uid();
    set((s) => {
      // De-dupe identical messages within a 2s window — unhandled rejections
      // can fire repeatedly for the same retry burst, and stacking 5 copies
      // of the same toast wastes screen real estate.
      const now = Date.now();
      const dedupe = s.entries.find(
        (e) =>
          e.message === input.message &&
          now - e.createdAt < 2000,
      );
      if (dedupe) return s;
      return {
        entries: [
          ...s.entries,
          { ...input, id, createdAt: now },
        ],
      };
    });
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  clear: () => set({ entries: [] }),
}));

/**
 * Translate any thrown value into a toast-shaped { message, detail } pair.
 * For ApiError: uses errorCode-based translation if a t() resolver is
 * provided; otherwise falls back to the raw English message + status code.
 * For Error: uses .message + .name.
 * For unknown: stringifies.
 */
export function describeError(
  err: unknown,
  t?: (key: string, params?: Record<string, string | number>) => string,
): { message: string; detail?: string } {
  if (err instanceof ApiError) {
    if (err.errorCode && t) {
      const key = `serverErrors.${err.errorCode}`;
      const localized = t(key);
      // walk() returns the key verbatim for missing entries
      if (localized !== key) {
        // e2e-report F120: don't leak HTTP status (e.g. "409") to end users
        // when the localized message already explains the situation. Status
        // codes are dev-only info — they show up in DevTools network panel
        // for debugging but don't belong in user-visible toast detail.
        return { message: localized };
      }
    }
    // Fallback path (no localized message available): prefer errorCode
    // identifier over raw HTTP status for the detail line. Status code is
    // last resort — at least it's a dev/support handhold when nothing else
    // resolves.
    return { message: err.message, detail: err.errorCode ?? `${err.status}` };
  }
  if (err instanceof Error) {
    return { message: err.message, detail: err.name };
  }
  return { message: String(err) };
}
