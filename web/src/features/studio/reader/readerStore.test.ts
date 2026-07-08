import { describe, it, expect, beforeEach } from "vitest";
import { useReader } from "./readerStore";

// The ScriptReader open/close switch lives in its own zustand store (mirrors the
// diveStore pattern) so the top bar can open the full-screen reader and any card
// can close it. Kept independent of diveStore so the two overlays never fight
// over one `open` flag.

beforeEach(() => {
  useReader.setState({ open: false, focusSceneId: null });
});

describe("useReader", () => {
  it("starts closed", () => {
    expect(useReader.getState().open).toBe(false);
  });

  it("openReader flips open true; closeReader flips it back", () => {
    useReader.getState().openReader("w1");
    expect(useReader.getState().open).toBe(true);
    useReader.getState().closeReader();
    expect(useReader.getState().open).toBe(false);
  });

  // ── focus-scene deep link (the sidebar ⤢ → center-panel handoff) ──────────
  // The sidebar's per-card expand button opens the docked reader AND names the
  // scene to scroll to. The reader consumes the request after scrolling, so a
  // later plain open doesn't re-scroll to a stale target.

  it("openReader carries a focus target; consumeFocus clears it without closing", () => {
    useReader.getState().openReader("w1", { focusSceneId: "sc1" });
    expect(useReader.getState().open).toBe(true);
    expect(useReader.getState().focusSceneId).toBe("sc1");
    useReader.getState().consumeFocus();
    expect(useReader.getState().focusSceneId).toBeNull();
    expect(useReader.getState().open).toBe(true);
  });

  it("openReader without a target leaves focus null; re-opening while open retargets", () => {
    useReader.getState().openReader("w1");
    expect(useReader.getState().focusSceneId).toBeNull();
    // Already open — a second openReader from another card must still update
    // the focus target (the docked panel follows the sidebar clicks).
    useReader.getState().openReader("w1", { focusSceneId: "sc2" });
    expect(useReader.getState().open).toBe(true);
    expect(useReader.getState().focusSceneId).toBe("sc2");
  });

  it("closeReader clears any pending focus target", () => {
    useReader.getState().openReader("w1", { focusSceneId: "sc1" });
    useReader.getState().closeReader();
    expect(useReader.getState().focusSceneId).toBeNull();
  });
});
