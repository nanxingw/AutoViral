import { MESSAGES } from "@/i18n/messages";

// #83 — the set of every locale's "untitled" placeholder literal. Historic
// blank works baked the localized placeholder into their stored title (an
// EN-created draft stored "Untitled", a ZH one stored "未命名"), freezing the
// title's language. We can't tell a baked placeholder from a real title by
// shape, but we CAN match it against the known placeholder values — those are
// exactly the strings NewWorkCard used to persist.
const PLACEHOLDER_TITLES: ReadonlySet<string> = new Set(
  Object.values(MESSAGES).map((m) => m.works.untitledWork),
);

/**
 * True when a stored title is empty OR is a localized "untitled" placeholder
 * that leaked into storage (any locale). Such titles must be re-localized at
 * render time against the CURRENT locale rather than shown verbatim.
 *
 * Edge case: a user who deliberately named a work exactly "Untitled"/"未命名"
 * gets it localized too — acceptable, since that's indistinguishable from the
 * bug and the user arguably wants locale consistency anyway.
 */
export function isPlaceholderWorkTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim();
  if (!trimmed) return true; // null / undefined / "" / whitespace-only
  return PLACEHOLDER_TITLES.has(trimmed);
}

/**
 * The title to display for a work: the stored title when it's a real name,
 * otherwise the current-locale "untitled" placeholder. `untitled` is the
 * already-localized `t("works.untitledWork")` from the caller.
 */
export function displayWorkTitle(
  title: string | null | undefined,
  untitled: string,
): string {
  return isPlaceholderWorkTitle(title) ? untitled : (title as string);
}
