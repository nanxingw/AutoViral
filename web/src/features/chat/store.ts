import { create } from "zustand";
import type { StreamBlock, StreamBlockType } from "./types";

interface ChatStore {
  blocks: StreamBlock[];
  streaming: boolean;
  push: (b: { type: StreamBlockType; text: string; toolName?: string; questions?: string[] }) => void;
  setStreaming: (s: boolean) => void;
  clear: () => void;
}

let counter = 0;
const nextId = () => `b_${Date.now()}_${counter++}`;

export const useChatStore = create<ChatStore>((set) => ({
  blocks: [],
  streaming: false,
  push: (b) =>
    set((s) => ({
      blocks: [...s.blocks, { id: nextId(), ts: Date.now(), ...b }],
    })),
  setStreaming: (streaming) => set({ streaming }),
  clear: () => set({ blocks: [] }),
}));
