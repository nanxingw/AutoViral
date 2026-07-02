import type { StreamBlock, StreamBlockType, ChatAttachment, TurnUsage } from "./types";

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
}

/**
 * Map a work's persisted chat history (the `message_history` WS frame's
 * `data.blocks`, or an HTTP /chat block list) into the store's StreamBlock
 * shape. Extracted from useChatSocket so the reseed mapping is unit-testable.
 *
 * A1 (PRD-0010) — prefer the server-assigned stable id so the reseed agrees
 * with the HTTP seed + live blocks (by-id dedup); legacy id-less lines
 * synthesize `hist_{i}` by index.
 */
export function seedBlocksFromHistory(
  blocks: Array<Record<string, unknown>>,
): StreamBlock[] {
  return blocks.map((b, i) => ({
    id: (b.id as string) ?? `hist_${i}`,
    type: ((b.type as StreamBlockType) ?? "text") as StreamBlockType,
    text: asString(b.text),
    toolName: b.toolName as string | undefined,
    // Carry persisted user-message attachments through the WS reseed — otherwise
    // on reload the message_history frame overwrites the HTTP-seeded blocks and
    // the bubble thumbnails vanish.
    attachments: b.attachments as ChatAttachment[] | undefined,
    // B3 (PRD-0010) — carry the persisted per-turn usage through the reseed so
    // the session-total badge survives a refresh. Dropping it here made the
    // running total "reset to zero" on reload (the badge recomputes from blocks).
    usage: b.usage as TurnUsage | undefined,
    ts:
      typeof b.timestamp === "string"
        ? Date.parse(b.timestamp as string)
        : Date.now(),
  }));
}
