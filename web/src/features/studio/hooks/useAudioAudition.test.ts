// A6 (PRD-0010) — useAudioAudition singleton hook tests.
//
// The library AUDIO row plays a preview in place. Only ONE audition may
// sound at a time (module-scoped singleton): starting B stops A, unmounting
// the active row stops it (covers work-switch, since the row unmounts), and
// the clip ending resets the row to not-playing.
//
// happy-dom exposes a real `Audio` whose .play/.pause live on
// HTMLMediaElement.prototype (mocked in test/setup.ts as shared vi.fn()s).
// We stub the `Audio` constructor to (a) record every element the hook
// creates and (b) give each element its OWN play/pause spies so per-element
// assertions don't collide with the shared prototype mock.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAudioAudition, _resetAuditionForTests } from "./useAudioAudition";

const created: HTMLAudioElement[] = [];
const RealAudio = globalThis.Audio;

beforeEach(() => {
  created.length = 0;
  _resetAuditionForTests();
  vi.stubGlobal("Audio", function (src?: string) {
    const el = new RealAudio(src);
    // Own-property spies shadow the shared prototype mock for isolation.
    el.play = vi.fn(async () => undefined);
    el.pause = vi.fn();
    created.push(el);
    return el;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetAuditionForTests();
});

describe("useAudioAudition (singleton)", () => {
  it("plays the requested src and reports playing=true", () => {
    const a = renderHook(() => useAudioAudition("/a.mp3"));
    expect(a.result.current.playing).toBe(false);
    act(() => a.result.current.toggle());
    expect(a.result.current.playing).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].play).toHaveBeenCalledTimes(1);
  });

  it("playing a second src auto-stops the first", () => {
    const a = renderHook(() => useAudioAudition("/a.mp3"));
    const b = renderHook(() => useAudioAudition("/b.mp3"));
    act(() => a.result.current.toggle());
    expect(a.result.current.playing).toBe(true);
    expect(b.result.current.playing).toBe(false);

    act(() => b.result.current.toggle());
    // A's element was paused; B is now the sole audition.
    expect(created[0].pause).toHaveBeenCalledTimes(1);
    expect(b.result.current.playing).toBe(true);
    expect(a.result.current.playing).toBe(false);
  });

  it("toggling the same src twice pauses it (play → pause)", () => {
    const a = renderHook(() => useAudioAudition("/a.mp3"));
    act(() => a.result.current.toggle());
    expect(a.result.current.playing).toBe(true);
    act(() => a.result.current.toggle());
    expect(a.result.current.playing).toBe(false);
    expect(created[0].pause).toHaveBeenCalledTimes(1);
  });

  it("unmounting the active row stops playback (work switch)", () => {
    const a = renderHook(() => useAudioAudition("/a.mp3"));
    act(() => a.result.current.toggle());
    const el = created[0];
    a.unmount();
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it("resets to not-playing when the clip ends", () => {
    const a = renderHook(() => useAudioAudition("/a.mp3"));
    act(() => a.result.current.toggle());
    expect(a.result.current.playing).toBe(true);
    act(() => {
      created[0].dispatchEvent(new Event("ended"));
    });
    expect(a.result.current.playing).toBe(false);
  });
});
