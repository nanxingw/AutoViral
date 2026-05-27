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
export interface ApiErrorParts {
  /** Localized, human-readable headline — safe to show non-technical users.
   *  For schema-validation codes (composition_unreadable / carousel_unreadable
   *  / composition_yaml_invalid) this NO LONGER embeds the raw server detail
   *  (#61: a full ZodError JSON dump was being shown as the headline). */
  message: string;
  /** Raw technical detail from the server (e.g. ZodError JSON) for a
   *  collapsible "technical details" panel, NOT the headline. "" when none. */
  detail: string;
}

/**
 * #61 — split a server `ApiError` into a human headline + raw technical detail.
 * The headline comes from `serverErrors.<code>`; the detail is the server's
 * `body.detail` verbatim. Callers that want a single string use
 * `localizeApiError` (headline only); callers with a collapsible diagnostic
 * panel (Studio/Editor load-failure screens) use the parts.
 */
export function localizeApiErrorParts(err: unknown, t: TFn): ApiErrorParts {
  let detail = "";
  if (err && typeof err === "object" && "errorCode" in err) {
    const code = (err as ApiError).errorCode;
    if (typeof code === "string") {
      const body = (err as ApiError).body;
      detail =
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
        return { message: localized, detail };
      }
    }
  }
  return { message: err instanceof Error ? err.message : String(err), detail };
}

export function localizeApiError(err: unknown, t: TFn): string {
  return localizeApiErrorParts(err, t).message;
}
