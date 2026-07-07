import { describe, it, expect, beforeEach } from "vitest";
import { useReader } from "./readerStore";

// The ScriptReader open/close switch lives in its own zustand store (mirrors the
// diveStore pattern) so the top bar can open the full-screen reader and any card
// can close it. Kept independent of diveStore so the two overlays never fight
// over one `open` flag.

beforeEach(() => {
  useReader.setState({ open: false });
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
});
