import type { ApiError } from "@/lib/api";
import type { MessageKey } from "./useT";

type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Round 26 — translate a server `ApiError.errorCode` (snake_case) into a
 * localized message via `serverErrors.<code>`. Falls back to err.message
 * when the code is missing or unknown, so unmapped errors still surface
 * useful text.
 *
 * Server side mirrors error codes in src/server/api.ts; adding a new code
 * is opt-in: server emits it, frontend defines an i18n key, and this
 * helper picks it up automatically.
 */
export function localizeApiError(err: unknown, t: TFn): string {
  if (err && typeof err === "object" && "errorCode" in err) {
    const code = (err as ApiError).errorCode;
    if (typeof code === "string") {
      const body = (err as ApiError).body;
      const detail =
        body && typeof body === "object" && "detail" in body
          ? String((body as { detail: unknown }).detail ?? "")
          : "";
      // Cast: serverErrors.<code> is built dynamically; the underlying
      // `walk()` returns the key itself for missing entries so unknown
      // codes degrade gracefully.
      const localized = t(`serverErrors.${code}` as MessageKey, { detail });
      // If walk() returned the key verbatim (unmapped code), use the
      // raw err.message instead — it's at least the English server text.
      if (localized !== `serverErrors.${code}`) {
        return localized;
      }
    }
  }
  return err instanceof Error ? err.message : String(err);
}
