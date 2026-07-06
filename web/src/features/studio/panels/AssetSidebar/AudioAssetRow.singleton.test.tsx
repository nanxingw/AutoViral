// A6 (PRD-0010) — AudioAssetRow single-instance audition, row-level parity for
// E2E finding AE3-素材卡-F2.
//
// The AE3 browser sweep could NOT verify the AUDIO row's single-instance
// playback ("点播 DOM 二确 paused===false；点第二条第一条应停") because the
// Chrome extension was disconnected. This encodes that exact acceptance
// deterministically in CI: TWO real AudioAssetRow instances wired through the
// REAL useAudioAudition singleton (only useWaveform is stubbed), asserting BOTH
//   (a) the user-visible ▶/⏸ button accessible name on each row, and
//   (b) the underlying <audio>.paused property the E2E's javascript_tool would
//       have read (paused===false while sounding; the prior row's element flips
//       back to paused===true the moment a second row starts).
//
// The hook-level test (hooks/useAudioAudition.test.ts) already proves the module
// singleton in isolation; this closes the row↔hook↔DOM gap the other row test
// left open by MOCKING the hook.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { AudioAssetRow } from "./AudioAssetRow";
import { _resetAuditionForTests } from "../../hooks/useAudioAudition";
import type { AssetItem } from "@/queries/assets";

// Only the waveform peaks fetch is stubbed; the audition singleton stays REAL.
vi.mock("../../hooks/useWaveform", () => ({
  useWaveform: () => ({
    peaks: new Float32Array([0.4, 0.8, 0.3]),
    sourceDuration: 10,
    loading: false,
    error: null,
  }),
  _resetWaveformCacheForTests: () => {},
}));

// Record every <audio> the singleton mints + track a real `paused` flag: the
// shared prototype play/pause mocks are no-ops that never flip .paused, so we
// give each element its own play/pause that maintain the flag the browser's
// `audio.paused` DOM property would report.
const created: HTMLAudioElement[] = [];
const RealAudio = globalThis.Audio;

beforeEach(() => {
  created.length = 0;
  _resetAuditionForTests();
  vi.stubGlobal("Audio", function (src?: string) {
    const el = new RealAudio(src);
    Object.defineProperty(el, "paused", {
      configurable: true,
      writable: true,
      value: true,
    });
    el.play = vi.fn(async () => {
      (el as unknown as { paused: boolean }).paused = false;
    });
    el.pause = vi.fn(() => {
      (el as unknown as { paused: boolean }).paused = true;
    });
    created.push(el);
    return el;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetAuditionForTests();
});

const A: AssetItem = {
  path: "assets/audio/a.mp3",
  url: "/api/works/w1/assets/audio/a.mp3",
  kind: "audio",
  ext: "mp3",
  name: "a.mp3",
};
const B: AssetItem = {
  path: "assets/audio/b.mp3",
  url: "/api/works/w1/assets/audio/b.mp3",
  kind: "audio",
  ext: "mp3",
  name: "b.mp3",
};

/** The play/pause toggle within a given row (its a11y name flips ▶⇄⏸). */
function toggleBtn(container: HTMLElement): HTMLElement {
  return within(container).getByRole("button", { name: /preview/i });
}

describe("AudioAssetRow single-instance audition (AE3-素材卡-F2)", () => {
  it("clicking a row plays it: button shows ⏸ and audio.paused===false", () => {
    const { container } = render(
      <AudioAssetRow item={A} index={0} onOpen={() => {}} />,
    );
    const btn = toggleBtn(container);
    expect(btn).toHaveAccessibleName(/play preview/i); // ▶ at rest

    fireEvent.click(btn);

    // (a) user-visible: row now shows ⏸.
    expect(toggleBtn(container)).toHaveAccessibleName(/pause preview/i);
    // (b) DOM 二确: the element created for this src is actually sounding.
    expect(created).toHaveLength(1);
    expect(created[0].play).toHaveBeenCalledTimes(1);
    expect(created[0].paused).toBe(false);
  });

  it("playing a second row stops the first (点第二条第一条应停)", () => {
    const rowA = render(<AudioAssetRow item={A} index={0} onOpen={() => {}} />);
    const rowB = render(<AudioAssetRow item={B} index={1} onOpen={() => {}} />);

    fireEvent.click(toggleBtn(rowA.container));
    // A sounds, B idle.
    expect(created[0].paused).toBe(false);
    expect(toggleBtn(rowA.container)).toHaveAccessibleName(/pause preview/i);
    expect(toggleBtn(rowB.container)).toHaveAccessibleName(/play preview/i);

    fireEvent.click(toggleBtn(rowB.container));

    // First stops — the crux of F2.
    expect(created[0].pause).toHaveBeenCalledTimes(1);
    expect(created[0].paused).toBe(true);
    expect(toggleBtn(rowA.container)).toHaveAccessibleName(/play preview/i); // ▶ reverted
    // Second is now the sole audition.
    expect(created).toHaveLength(2);
    expect(created[1].paused).toBe(false);
    expect(toggleBtn(rowB.container)).toHaveAccessibleName(/pause preview/i); // ⏸
  });

  it("toggling the same row again pauses it (play → pause)", () => {
    const { container } = render(
      <AudioAssetRow item={A} index={0} onOpen={() => {}} />,
    );
    fireEvent.click(toggleBtn(container));
    expect(created[0].paused).toBe(false);

    fireEvent.click(toggleBtn(container));
    expect(created[0].pause).toHaveBeenCalledTimes(1);
    expect(created[0].paused).toBe(true);
    expect(toggleBtn(container)).toHaveAccessibleName(/play preview/i);
  });
});
