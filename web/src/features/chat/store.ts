import { create } from "zustand";
import type { StreamBlock, StreamBlockType, TurnUsage, ChatAttachment } from "./types";

interface ChatStore {
  blocks: StreamBlock[];
  streaming: boolean;
  push: (b: { id?: string; type: StreamBlockType; text: string; toolName?: string; questions?: string[]; attachments?: ChatAttachment[] }) => void;
  /** Replace the whole conversation — used when seeding from a server history
   *  path (HTTP /chat or WS message_history). Dedups by id defensively. */
  setBlocks: (blocks: StreamBlock[]) => void;
  setStreaming: (s: boolean) => void;
  /** Attach Claude CLI's per-turn cost/duration/usage to the last assistant
   *  text block. Called by useChatSocket on `turn_complete`. */
  attachLastTurnUsage: (usage: TurnUsage) => void;
  clear: () => void;
}

let counter = 0;
const nextId = () => `b_${Date.now()}_${counter++}`;

/** A1 (PRD-0010) — collapse blocks that share an id, keeping first-seen order.
 *  Guards a history seed against an already-doubled legacy log AND against a
 *  live block the seed also includes. Id-less blocks (legacy / optimistic echo)
 *  are kept as-is — their positional identity is all we have. */
function dedupeById(blocks: StreamBlock[]): StreamBlock[] {
  const seen = new Set<string>();
  const out: StreamBlock[] = [];
  for (const b of blocks) {
    if (b.id != null) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
    }
    out.push(b);
  }
  return out;
}

export const useChatStore = create<ChatStore>((set) => ({
  blocks: [],
  streaming: false,
  push: (b) =>
    set((s) => {
      // A1 (PRD-0010) — server-assigned blocks carry a stable id, so dedup BY ID:
      // the same logical block re-arriving on any seed path (live re-broadcast,
      // reconnect, StrictMode double-mount, a CLI re-emit after a tool cycle)
      // upserts in place instead of stacking a second bubble. Unlike the old
      // last-block-only heuristic this survives NON-contiguous re-arrivals (a
      // tool_result in between used to defeat it), and it never wrongly collapses
      // a legit repeat (two identical tool runs get different seqs → different ids).
      if (b.id != null) {
        if (s.blocks.some((x) => x.id === b.id)) return s; // already present → no-op
        return { blocks: [...s.blocks, { ts: Date.now(), ...b, id: b.id }] };
      }
      // No server id — old-server compat + the optimistic user echo, which can't
      // know its server id yet. Fall back to the contiguous last-block heuristic:
      // it only collapses an IMMEDIATE duplicate, so a legit non-contiguous
      // repeat is preserved.
      const last = s.blocks[s.blocks.length - 1];
      if (
        last &&
        last.type === b.type &&
        last.text === b.text &&
        (last.toolName ?? null) === (b.toolName ?? null)
      ) {
        return s;
      }
      return {
        blocks: [...s.blocks, { ts: Date.now(), ...b, id: nextId() }],
      };
    }),
  setBlocks: (blocks) => set({ blocks: dedupeById(blocks) }),
  setStreaming: (streaming) => set({ streaming }),
  attachLastTurnUsage: (usage) =>
    set((s) => {
      // Walk back from the end to find the most recent assistant text block.
      // Anything past it (e.g. an unterminated thinking) shouldn't grow
      // a cost badge — only one bubble per turn carries it.
      const blocks = s.blocks.slice();
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].type === "text") {
          blocks[i] = { ...blocks[i], usage };
          return { blocks };
        }
      }
      return s;
    }),
  clear: () => set({ blocks: [] }),
}));
