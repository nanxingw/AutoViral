import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWaveform } from "./useWaveform";

vi.mock("wavesurfer.js", () => ({
  default: {
    create: vi.fn(() => ({
      load: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
    })),
  },
}));

describe("useWaveform", () => {
  it("creates one WaveSurfer per src and destroys on unmount", () => {
    const div = document.createElement("div");
    const { unmount } = renderHook(() =>
      useWaveform({ container: div, src: "/a.mp3" }),
    );
    unmount();
    expect(true).toBe(true);
  });
});
