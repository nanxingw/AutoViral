export type StreamBlockType =
  | "user"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "ask_question"
  | "locator";

export interface TurnUsage {
  /** Cost of this single turn in USD (Claude CLI's `total_cost_usd`). */
  costUsd?: number;
  /** Total wall time of this turn in milliseconds. */
  durationMs?: number;
  /** Token counts as Claude CLI reports them. */
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/** A media file the user attached to a chat message (image / video / audio).
 *  Uploaded to the work's assets/ via POST /api/works/:id/assets/upload, then
 *  referenced by workspace-relative path so the agent can Read it. The local
 *  user bubble renders a thumbnail; the agent receives the path in an
 *  <attachments> envelope (see useChatSocket.send + ws-bridge buildSystemPrompt). */
export interface ChatAttachment {
  /** Workspace-relative path, e.g. "assets/images/ref.png". The agent joins
   *  this onto its workspace root (cwd is the project root, NOT the work dir). */
  path: string;
  /** Served URL for the local thumbnail, e.g. "/api/works/:id/assets/images/ref.png". */
  url: string;
  /** Original filename, shown on the chip. */
  name: string;
  kind: "image" | "video" | "audio";
}

/** One chat session in a work's `.sessions.jsonl` sidecar (ADR-008 §5 / I24).
 *  Mirrors the server's SessionRecord (src/server/sessions/sessions-sidecar.ts)
 *  for the fields the session strip needs. Returned by GET
 *  /api/works/:id/sessions and POST /api/works/:id/sessions. */
export interface ChatSessionRecord {
  /** Server-minted stable id, e.g. "s_1", "s_2". */
  id: string;
  surface: "chat" | "terminal";
  /** Chat only: claude's `--resume` UUID. */
  cliSessionId?: string;
  createdAt: string;
  lastActive: string;
  /** First user line / cwd — a human-readable label for the strip. */
  preview: string;
  archived: boolean;
}

export interface StreamBlock {
  id: string;
  type: StreamBlockType;
  text: string;
  toolName?: string;
  collapsed?: boolean;
  questions?: string[];
  ts: number;
  /** Media the user attached to this (user) message. Rendered as thumbnails
   *  in the bubble; the agent got the paths via the <attachments> envelope. */
  attachments?: ChatAttachment[];
  /** Set on the last text block of a turn when turn_complete arrives.
   *  Lets the bubble render a small cost/duration/tokens badge. */
  usage?: TurnUsage;
}

export interface LocatorData {
  clipId?: string;
  time?: number;     // seconds, can be fractional
  assetId?: string;
  trackId?: string;
}

export interface LocatorBlock {
  id: string;
  type: "locator";
  label: string;
  data: LocatorData;
  timestamp?: number;
}

const LOCATOR_RX =
  /<viewer-locator\s+label\s*=\s*(?:"([^"]+)"|'([^']+)')\s+data\s*=\s*(?:"([^"]+)"|'([^']+)')\s*\/?>/i;

export function parseLocatorTag(
  text: string,
): { label: string; data: LocatorData } | null {
  const m = text.match(LOCATOR_RX);
  if (!m) return null;
  const label = m[1] ?? m[2] ?? "";
  const dataRaw = m[3] ?? m[4] ?? "{}";
  try {
    const data = JSON.parse(dataRaw) as LocatorData;
    return { label, data };
  } catch {
    return null;
  }
}

// ── Viewer-Action protocol (port of pneuma's actionRequest) ──────────────────
// Agent emits `<viewer-action type="..." data='{...}' />` inside its text;
// the chat layer auto-dispatches the action on receive and strips the tag
// from the visible bubble. Distinct from <viewer-locator/>: locators wait
// for a user click; actions fire immediately. Use for "I switched you to
// slide 2" / "playing from 4.5s" / "selected the headline" follow-through.
export type ViewerActionType =
  | "select-slide"
  | "select-layer"
  | "select-clip"
  | "set-frame";

export interface ViewerAction {
  type: ViewerActionType;
  /** Action payload — id / time / track depending on type. JSON in the tag. */
  data: Record<string, unknown>;
}

const ACTION_RX_GLOBAL =
  /<viewer-action\s+type\s*=\s*(?:"([^"]+)"|'([^']+)')\s+data\s*=\s*(?:"([^"]+)"|'([^']+)')\s*\/?>/gi;

/** Parse all `<viewer-action/>` tags in a text fragment. Returns the
 *  cleaned text (with every tag stripped) plus the list of actions found,
 *  in document order. Bad JSON in the data attribute drops just that one
 *  tag — the surrounding text is preserved. */
export function extractViewerActions(text: string): {
  cleaned: string;
  actions: ViewerAction[];
} {
  const actions: ViewerAction[] = [];
  const cleaned = text.replace(ACTION_RX_GLOBAL, (_match, t1, t2, d1, d2) => {
    const type = (t1 ?? t2 ?? "") as ViewerActionType;
    const dataRaw = d1 ?? d2 ?? "{}";
    try {
      const data = JSON.parse(dataRaw) as Record<string, unknown>;
      actions.push({ type, data });
    } catch {
      // bad JSON — skip this action but still strip the tag (otherwise it
      // sits in the user's bubble looking like garbage).
    }
    return "";
  });
  return { cleaned: cleaned.replace(/[ \t]{2,}/g, " ").trim(), actions };
}
