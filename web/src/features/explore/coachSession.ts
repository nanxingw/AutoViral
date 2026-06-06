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
