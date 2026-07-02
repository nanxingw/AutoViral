/**
 * ChatBackend registry (C4, PRD-0010).
 *
 * A tiny lookup that maps a per-session backend id → its concrete ChatBackend
 * implementation, with a claude default fallback. WsBridge stores `backend` as a
 * per-session property (SessionRecord.backend / WsSession.backend); this is the
 * single place that resolves that id to the impl used by spawnCli.
 *
 * Why a default of "claude": legacy sidecar records predate the field, and every
 * pre-C4 session is a claude session. An unknown / missing id therefore resolves
 * to claude — never throws, never spawns the wrong CLI silently (the id is
 * validated at the route boundary before it ever reaches here).
 */

import type { ChatBackend } from "./types.js";
import { claudeBackend } from "./claude.js";
import { codexBackend } from "./codex.js";

/** The set of backend ids a session may be pinned to. */
export const CHAT_BACKEND_IDS = ["claude", "codex"] as const;
export type ChatBackendId = (typeof CHAT_BACKEND_IDS)[number];

/** The global fallback when a session has no backend (legacy / unset). */
export const DEFAULT_CHAT_BACKEND: ChatBackendId = "claude";

const REGISTRY: Record<ChatBackendId, ChatBackend> = {
  claude: claudeBackend,
  codex: codexBackend,
};

/** True for an id that names a real backend. */
export function isChatBackendId(id: unknown): id is ChatBackendId {
  return typeof id === "string" && (CHAT_BACKEND_IDS as readonly string[]).includes(id);
}

/** Coerce an arbitrary (possibly undefined / legacy) id to a valid backend id,
 *  defaulting to claude. This is the "legacy record ⇒ claude" rule. */
export function resolveBackendId(id?: string): ChatBackendId {
  return isChatBackendId(id) ? id : DEFAULT_CHAT_BACKEND;
}

/** Resolve an id to its concrete backend impl (claude on anything unknown). */
export function getChatBackend(id?: string): ChatBackend {
  return REGISTRY[resolveBackendId(id)];
}
