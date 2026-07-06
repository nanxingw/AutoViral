import type { ViewerAction } from "./types";

/** The store setters a viewer-action can drive. Kept as a plain interface (not
 *  a store import) so the routing is a pure, unit-testable function — the
 *  RightPane host binds these to the live composition + carousel-editor stores.
 */
export interface ViewerActionStores {
  /** Video: move the playhead to a frame number. */
  setFrame: (frame: number) => void;
  /** Video: select a timeline clip by id (null clears). */
  setClipSelection: (clipId: string | null) => void;
  /** Carousel: switch the active slide by id. */
  setCurrentSlide: (id: string) => void;
  /** Carousel: select a layer by id (null clears). */
  setLayerSelection: (id: string | null) => void;
}

/**
 * Route one agent-emitted `<viewer-action>` to the matching store setter.
 *
 * The protocol (taught in the ws-bridge system prompt) carries a typed payload:
 *   set-frame    → {frame:120}   select-clip  → {clipId:"c1"}
 *   select-slide → {id:"s2"}     select-layer → {id:"s1_h"}
 *
 * PRD-0010 CE E2E ship-blocker: this consumer never existed — RightPane passed
 * no dispatchAction to ChatPanel, so useChatSocket's `dispatchAction?.(a)` was a
 * no-op. The agent's "I moved the playhead to 3s" follow-through never reached
 * the viewer. A malformed payload (wrong type / missing key) is skipped, never
 * thrown: assistant_text dispatches in a loop and one bad tag must not abort it.
 */
export function dispatchViewerAction(
  action: ViewerAction,
  stores: ViewerActionStores,
): void {
  switch (action.type) {
    case "set-frame": {
      const frame = action.data.frame;
      if (typeof frame === "number" && Number.isFinite(frame)) stores.setFrame(frame);
      break;
    }
    case "select-clip": {
      const clipId = action.data.clipId;
      if (typeof clipId === "string") stores.setClipSelection(clipId);
      break;
    }
    case "select-slide": {
      const id = action.data.id;
      if (typeof id === "string") stores.setCurrentSlide(id);
      break;
    }
    case "select-layer": {
      const id = action.data.id;
      if (typeof id === "string") stores.setLayerSelection(id);
      break;
    }
  }
}
