import { create } from "zustand";

/**
 * Cross-component bridge for injecting text into the chat composer.
 *
 * The chat input lives as local `useState` inside ChatPanel with no external
 * setter (by design — ChatPanel owns its textarea). Element affordances like
 * the right-click "加入聊天上下文" menu live in a different component tree
 * (timeline clips, Konva canvas layers) and can't reach that state directly.
 *
 * They call `inject(text)`; ChatPanel subscribes to `nonce` and appends `text`
 * to its composer + focuses it. `nonce` is bumped on every call so injecting
 * the SAME text twice still re-fires the consumer effect (subscribing to the
 * text alone would dedupe a legitimate second add of an identical reference).
 *
 * Only one ChatPanel is mounted per route (Studio or carousel Editor), so
 * there is a single consumer — no fan-out ambiguity.
 */
interface ComposerDraftState {
  /** Monotonic counter; bumped on each inject() so repeats still fire. */
  nonce: number;
  /** The most recent text requested for injection. */
  text: string;
  /** Request that `text` be appended to the chat composer. */
  inject: (text: string) => void;
}

export const useComposerDraft = create<ComposerDraftState>((set) => ({
  nonce: 0,
  text: "",
  inject: (text) => set((s) => ({ nonce: s.nonce + 1, text })),
}));
