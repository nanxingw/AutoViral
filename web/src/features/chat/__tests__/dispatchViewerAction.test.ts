import { describe, it, expect, vi } from "vitest";
import { dispatchViewerAction } from "../dispatchViewerAction";
import type { ViewerAction } from "../types";

function makeStores() {
  return {
    setFrame: vi.fn(),
    setClipSelection: vi.fn(),
    setCurrentSlide: vi.fn(),
    setLayerSelection: vi.fn(),
  };
}

describe("dispatchViewerAction", () => {
  // PRD-0010 CE E2E ship-blocker: the agent emitted correct <viewer-action>
  // tags and the frontend stripped them, but no consumer was wired — every
  // action was silently dropped (playhead never seeked, clip never selected).
  // This routes each action type to the right store setter.

  it("set-frame → setFrame(frame)", () => {
    const s = makeStores();
    dispatchViewerAction({ type: "set-frame", data: { frame: 90 } } as ViewerAction, s);
    expect(s.setFrame).toHaveBeenCalledWith(90);
    expect(s.setClipSelection).not.toHaveBeenCalled();
  });

  it("select-clip → setClipSelection(clipId)", () => {
    const s = makeStores();
    dispatchViewerAction({ type: "select-clip", data: { clipId: "vc_0.00" } } as ViewerAction, s);
    expect(s.setClipSelection).toHaveBeenCalledWith("vc_0.00");
    expect(s.setFrame).not.toHaveBeenCalled();
  });

  it("select-slide → setCurrentSlide(id)", () => {
    const s = makeStores();
    dispatchViewerAction({ type: "select-slide", data: { id: "s2" } } as ViewerAction, s);
    expect(s.setCurrentSlide).toHaveBeenCalledWith("s2");
  });

  it("select-layer → setLayerSelection(id)", () => {
    const s = makeStores();
    dispatchViewerAction({ type: "select-layer", data: { id: "s1_h" } } as ViewerAction, s);
    expect(s.setLayerSelection).toHaveBeenCalledWith("s1_h");
  });

  it("ignores an action whose payload has the wrong type (no throw, no call)", () => {
    const s = makeStores();
    // frame as a string, clipId missing — a malformed payload must not crash
    // the whole assistant_text handler (it dispatches in a loop).
    dispatchViewerAction({ type: "set-frame", data: { frame: "90" } } as ViewerAction, s);
    dispatchViewerAction({ type: "select-clip", data: {} } as ViewerAction, s);
    expect(s.setFrame).not.toHaveBeenCalled();
    expect(s.setClipSelection).not.toHaveBeenCalled();
  });

  it("frame 0 is a valid seek (not skipped as falsy)", () => {
    const s = makeStores();
    dispatchViewerAction({ type: "set-frame", data: { frame: 0 } } as ViewerAction, s);
    expect(s.setFrame).toHaveBeenCalledWith(0);
  });
});
