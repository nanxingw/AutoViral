/**
 * coachSession — workless grounded-coach wiring for the 灵感/Explore page
 * (PRD-0006 S7).
 *
 * The coach is NOT a work. It reuses the chat infrastructure (ChatPanel +
 * useChatSocket + the chat store) but its identity is a single stable, workless
 * session key. The WS channel /ws/browser/coach_main carries streaming tokens +
 * the `message_history` reseed (history survives reload — the coach session is
 * sidecar-persisted, unlike the ephemeral trends_ sessions). But the SEND and
 * MODEL-SWITCH paths are decoupled from the raw WS frame:
 *
 *   · send  → POST /api/coach/message  (first turn spins up the grounded
 *             research session: works + selected-platform trends + interests)
 *   · model → POST /api/coach/model    (SESSION-scoped — never touches the
 *             global config.model the editing agent rides, so switching the
 *             coach's tier can't steal the editing agent's tier)
 *
 * Everything here is a thin, dependency-light wrapper over apiFetch so the
 * decoupling is unit-testable without a live WS.
 */
import { apiFetch } from "@/lib/api";
import type { MessageKey } from "@/i18n/useT";

/**
 * The single canonical workless coach session key. MUST match the backend
 * `coachKeyFor("main")` ("coach_main") so the WS path /ws/browser/coach_main
 * reseeds the same persisted session and `useChatSocket` opens the right route.
 */
export const COACH_SESSION_KEY = "coach_main";

/** The user's real platform — the coach grounds against it by default. */
export const COACH_DEFAULT_PLATFORM = "douyin";

/** Send a message to the persisted coach. First turn creates the grounded
 *  session; later turns resume it. Streaming replies come back over the WS. */
export async function sendCoachMessage(
  text: string,
  platform: string = COACH_DEFAULT_PLATFORM,
): Promise<void> {
  await apiFetch(`/api/coach/message`, {
    method: "POST",
    body: { text, platform },
  });
}

/** Switch the coach's model tier — SESSION-scoped, never the global tier. */
export async function setCoachModel(model: string): Promise<void> {
  await apiFetch(`/api/coach/model`, {
    method: "POST",
    body: { model },
  });
}

/** A starter question for the empty coach box. Both keys live under
 *  `explore.coach.*` so they localize (zh + en). */
export interface CoachPrompt {
  labelKey: MessageKey;
  promptKey: MessageKey;
}

/**
 * The prompt library that seeds the empty coach box so the user never faces a
 * blank prompt. Each starter is grounded in the user's own works / trends /
 * interests (the coach reads them), e.g. "下一个该做什么选题" / "我哪类作品最值得多做".
 */
export const COACH_PROMPT_LIBRARY: readonly CoachPrompt[] = [
  { labelKey: "explore.coach.q1Label", promptKey: "explore.coach.q1Prompt" },
  { labelKey: "explore.coach.q2Label", promptKey: "explore.coach.q2Prompt" },
  { labelKey: "explore.coach.q3Label", promptKey: "explore.coach.q3Prompt" },
] as const;

// ── One-click coach idea → new work (PRD-0006 S8) ────────────────────────────
//
// The coach is a READ-ONLY strategy role — it never touches the user's works.
// When it suggests a concrete angle, it emits a `<coach-idea .../>` tag next to
// it. The chat layer renders that tag as a "用此创作" action which creates a NEW
// work seeded with a topicHint and navigates to it — the originating surface is
// the coach's chat output, not a trend row. This reuses the #65 topicHint
// plumbing (a trend → work brief) but builds the brief from a coach idea.

/** A concrete selection the coach surfaced, parsed out of a `<coach-idea/>`
 *  tag. `title` is required (it's what the new work is named + the lead line of
 *  the brief); `hook` / `why` enrich the topicHint when present. */
export interface CoachIdea {
  title: string;
  hook?: string;
  why?: string;
}

/**
 * Compose a creative brief (topicHint) from a coach idea — the chat-output
 * sibling of #65's `buildTrendTopicHint`. Joins title + hook + why into a clean
 * multi-line brief, trimming empty fields so the creation agent gets a tight,
 * grounded seed (not a tag dump).
 */
export function buildCoachIdeaTopicHint(idea: CoachIdea): string {
  return [idea.title, idea.hook, idea.why]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .map((p) => p.trim())
    .join("\n");
}

/** Pull one attribute (double- or single-quoted) out of a tag's attr string. */
function readAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  if (!m) return undefined;
  const v = (m[1] ?? m[2] ?? "").trim();
  return v.length > 0 ? v : undefined;
}

// g-flagged so we can extract EVERY idea tag in document order. The capture is
// the whole attribute span so individual attrs are read by readAttr (order /
// presence of hook|why is free-form). Mirrors the <viewer-action/> approach in
// chat/types.ts but the schema is idea-specific.
const COACH_IDEA_RX_GLOBAL = /<coach-idea\b([^>]*?)\/?>/gi;

/**
 * Parse all `<coach-idea/>` tags in an assistant text fragment. Returns the
 * cleaned text (every tag stripped so the bubble reads naturally) plus the list
 * of ideas in document order. A tag with a blank/missing title is dropped (an
 * idea you can't name is nothing to create from) — but its tag is still stripped
 * so no raw markup leaks into the bubble.
 */
export function parseCoachIdeas(text: string): {
  cleaned: string;
  ideas: CoachIdea[];
} {
  const ideas: CoachIdea[] = [];
  const cleaned = text.replace(COACH_IDEA_RX_GLOBAL, (_match, attrs: string) => {
    const title = readAttr(attrs, "title");
    if (title) {
      const idea: CoachIdea = { title };
      const hook = readAttr(attrs, "hook");
      const why = readAttr(attrs, "why");
      if (hook) idea.hook = hook;
      if (why) idea.why = why;
      ideas.push(idea);
    }
    return "";
  });
  return { cleaned, ideas };
}
