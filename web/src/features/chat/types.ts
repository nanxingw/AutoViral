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

export interface StreamBlock {
  id: string;
  type: StreamBlockType;
  text: string;
  toolName?: string;
  collapsed?: boolean;
  questions?: string[];
  ts: number;
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
