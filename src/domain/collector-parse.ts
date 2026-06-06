// D4 parse boundary — PRD-0006 §D4, slice S5 (Douyin collector wiring).
//
// The Douyin collector is a managed-venv Python script (f2 + browser_cookie3).
// Its ACTUAL scrape is integration-only: it must read the user's already-
// logged-in douyin.com `sessionid` cookie out of their browser, which only
// works once the user has logged in (the PRD's single HITL touch-point). What
// IS pure — and therefore unit-tested as the green-gate — is the BOUNDARY that
// turns the script's raw output into either:
//
//   * a typed `CreatorData` (the success object f2 produced), or
//   * a structured `CollectorError` with an actionable code + a `needsRelogin`
//     flag the Settings UI uses to show a clear "re-login to douyin.com" prompt
//     instead of a silent empty page.
//
// HONESTY (the whole point of S5): a failed scrape NEVER degrades to a blank
// screen or a generic 500. The collector either returns real data or a
// structured, named error the user can act on. Tokens/cookies stay local-only —
// this module never sees them; it only parses the script's stdout.

import type { CreatorData } from "./analytics-collector.js";

/** Stable, machine-checkable failure codes the collector boundary can emit.
 *  The first six mirror the Python collector's `error_exit(code, …)` envelope
 *  (collect.py / platforms/douyin.py); PARSE_ERROR is added by THIS boundary
 *  when the script's stdout is neither a valid success object nor a recognised
 *  error envelope (crash, traceback, truncated JSON, …). */
export type CollectorErrorCode =
  | "NOT_LOGGED_IN"
  | "COOKIE_NOT_FOUND"
  | "API_ERROR"
  | "INVALID_URL"
  | "NO_URL"
  | "DEPENDENCY_ERROR"
  | "BROWSER_NOT_FOUND"
  | "PLATFORM_NOT_SUPPORTED"
  | "PARSE_ERROR";

export interface CollectorError {
  /** Discriminant so `CreatorData | CollectorError` is a checkable union. */
  kind: "collector_error";
  /** Machine code — drives the i18n key + the UI's branch (re-login vs fix-URL). */
  code: CollectorErrorCode;
  /** Human, already-actionable message straight from the collector (or this
   *  boundary). The Settings UI localizes off `code` but falls back to this. */
  message: string;
  /** True when the user can self-heal by logging into douyin.com again and
   *  closing the browser (auth / cookie failures). The UI shows a "重新登录"
   *  prompt only for these. */
  needsRelogin: boolean;
}

/** Narrowing helper so callers can branch on the union without poking `kind`. */
export function isCollectorError(
  v: CreatorData | CollectorError,
): v is CollectorError {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as CollectorError).kind === "collector_error"
  );
}

/** Error codes that mean "your douyin.com session is gone — log in again".
 *  COOKIE_NOT_FOUND = browser still open / no readable cookie store;
 *  NOT_LOGGED_IN = no sessionid cookie at all. */
const RELOGIN_CODES: ReadonlySet<string> = new Set([
  "NOT_LOGGED_IN",
  "COOKIE_NOT_FOUND",
]);

/** API_ERROR is generic, but f2's "profile fetch failed" almost always means
 *  the cookie expired mid-scrape. When the message says so, treat it as a
 *  re-login prompt rather than an opaque API failure. */
function apiErrorIsExpiredCookie(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("cookie") && (m.includes("expire") || m.includes("re-login") || m.includes("relogin"));
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  "NOT_LOGGED_IN",
  "COOKIE_NOT_FOUND",
  "API_ERROR",
  "INVALID_URL",
  "NO_URL",
  "DEPENDENCY_ERROR",
  "BROWSER_NOT_FOUND",
  "PLATFORM_NOT_SUPPORTED",
]);

function parseError(code: string, message: string): CollectorError {
  const known = KNOWN_ERROR_CODES.has(code);
  const finalCode = (known ? code : "API_ERROR") as CollectorErrorCode;
  const needsRelogin =
    RELOGIN_CODES.has(finalCode) ||
    (finalCode === "API_ERROR" && apiErrorIsExpiredCookie(message));
  return {
    kind: "collector_error",
    code: finalCode,
    message: message || `Collector error (${finalCode})`,
    needsRelogin,
  };
}

function parseFail(message: string): CollectorError {
  return {
    kind: "collector_error",
    code: "PARSE_ERROR",
    message,
    needsRelogin: false,
  };
}

/** Validate that an object has the minimum CreatorData shape. We keep this a
 *  structural check (not a zod schema) so the boundary stays a single tiny pure
 *  fn with zero deps — the contract is `analytics-collector.ts`'s CreatorData,
 *  and downstream (insights / coach / table) only read account/works/summary. */
function looksLikeCreatorData(o: Record<string, unknown>): boolean {
  if (typeof o.platform !== "string") return false;
  const account = o.account as Record<string, unknown> | undefined;
  if (!account || typeof account !== "object") return false;
  if (typeof account.nickname !== "string") return false;
  if (typeof account.follower_count !== "number") return false;
  if (!Array.isArray(o.works)) return false;
  const summary = o.summary as Record<string, unknown> | undefined;
  if (!summary || typeof summary !== "object") return false;
  if (typeof summary.total_works_collected !== "number") return false;
  return true;
}

/**
 * Parse one collector run's raw output into a typed `CreatorData` or a
 * structured `CollectorError`. PURE — never spawns, never touches disk.
 *
 * Accepts either:
 *   * the already-parsed object the script printed, OR
 *   * the raw stdout string (we JSON.parse it; non-JSON → PARSE_ERROR).
 *
 * Recognises the Python collector's error envelope `{error, message, platform}`
 * and maps auth/cookie failures to `needsRelogin: true`. Anything that's
 * neither a valid success object nor a known error envelope → PARSE_ERROR.
 */
export function parseCollectorResult(raw: unknown): CreatorData | CollectorError {
  if (raw == null) return parseFail("Collector produced no output");

  let obj: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return parseFail("Collector produced empty output");
    try {
      obj = JSON.parse(trimmed);
    } catch {
      // Truncate so a multi-KB traceback doesn't blow up logs / the UI.
      return parseFail(`Collector output was not valid JSON: ${trimmed.slice(0, 200)}`);
    }
  }

  if (typeof obj !== "object" || obj === null) {
    return parseFail("Collector output was not a JSON object");
  }

  const o = obj as Record<string, unknown>;

  // Error envelope: the script's error_exit() prints {"error", "message", …}.
  if (typeof o.error === "string") {
    const message = typeof o.message === "string" ? o.message : "";
    return parseError(o.error, message);
  }

  // Otherwise it must be a success object with the CreatorData shape. The
  // structural check above validated the required keys, so the cast is sound.
  if (looksLikeCreatorData(o)) {
    return o as unknown as CreatorData;
  }

  return parseFail("Collector output is missing required fields (account / works / summary)");
}
