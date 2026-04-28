export type StreamBlockType =
  | "user"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "ask_question"
  | "locator";

export interface StreamBlock {
  id: string;
  type: StreamBlockType;
  text: string;
  toolName?: string;
  collapsed?: boolean;
  questions?: string[];
  ts: number;
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
