import { create } from "zustand";
import type { StreamBlock, StreamBlockType } from "./types";

interface ChatStore {
  blocks: StreamBlock[];
  streaming: boolean;
  push: (b: { type: StreamBlockType; text: string; toolName?: string; questions?: string[] }) => void;
  /** Replace the whole conversation — used when seeding from server-side chat.json. */
  setBlocks: (blocks: StreamBlock[]) => void;
  setStreaming: (s: boolean) => void;
  clear: () => void;
}

let counter = 0;
const nextId = () => `b_${Date.now()}_${counter++}`;

export const useChatStore = create<ChatStore>((set) => ({
  blocks: [],
  streaming: false,
  push: (b) =>
    set((s) => {
      // Drop near-duplicate of the last block. Real-world causes:
      //   - StrictMode / vite HMR producing two ws connections briefly
      //   - Backend session.messageHistory replay overlapping with the
      //     live `assistant_text` of the same block
      //   - Claude CLI re-emitting an identical text block after a
      //     tool_use cycle restart
      // Any one of these used to leave 2-3 copies of the same bubble in
      // the chat panel. Comparing against the LAST block only is enough
      // because dup-pushes always arrive contiguously.
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
        blocks: [...s.blocks, { id: nextId(), ts: Date.now(), ...b }],
      };
    }),
  setBlocks: (blocks) => set({ blocks }),
  setStreaming: (streaming) => set({ streaming }),
  clear: () => set({ blocks: [] }),
}));
