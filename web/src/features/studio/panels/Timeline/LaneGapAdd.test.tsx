import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LaneGapAdd } from "./LaneGapAdd";
import { useComposition } from "../../store";
import { makeEmptyComposition, type Track } from "../../types";

/* Phase F (issue #33) — LaneGapAdd contract tests.

   Notable behaviours:
   - Hover with 0ms dwell → button data-visible=false (CSS opacity:0)
   - Hover after 150ms dwell → button data-visible=true (clickable)
   - Same-kind gap → click adds matching kind, no picker
   - Heterogeneous gap → click opens kind picker, picker click adds the
     selected kind

   We use `data-visible` (not aria-hidden) for assertions because aria-hidden
   removes the element from getByRole queries, and we want both states
   addressable. Timer advancement is wrapped in act() so React flushes the
   dwell-fired setState before the next assertion. */

function getTrack(kind: Track["kind"]): Track {
  const comp = useComposition.getState().comp!;
  return comp.tracks.find((t) => t.kind === kind)!;
}

beforeEach(() => {
  vi.useFakeTimers();
  useComposition.setState({ comp: makeEmptyComposition({ workId: "w-test-33" }) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("<LaneGapAdd /> — dwell timing", () => {
  it("button is not visible immediately on hover", () => {
    const video = getTrack("video");
    const audio = getTrack("audio");
    const { container } = render(
      <LaneGapAdd upperTrackId={video.id} lowerTrackId={audio.id} />,
    );
    const btn = screen.getByTestId("lane-gap-btn");
    expect(btn.getAttribute("data-visible")).toBe("false");

    const gap = container.querySelector('[data-testid="lane-gap"]') as HTMLElement;
    fireEvent.mouseEnter(gap);

    // Immediately after entering — timer hasn't fired yet.
    expect(btn.getAttribute("data-visible")).toBe("false");
  });

  it("after 150ms dwell the button becomes visible", () => {
    const video = getTrack("video");
    const audio = getTrack("audio");
    const { container } = render(
      <LaneGapAdd upperTrackId={video.id} lowerTrackId={audio.id} />,
    );
    const gap = container.querySelector('[data-testid="lane-gap"]') as HTMLElement;
    fireEvent.mouseEnter(gap);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // happy-dom may need an extra microtask flush for the React render to
    // commit the new state to the DOM after the timer fires.
    act(() => {});

    expect(screen.getByTestId("lane-gap-btn").getAttribute("data-visible")).toBe("true");
  });

  it("mouseleave before dwell elapses cancels the timer (button stays hidden)", () => {
    const video = getTrack("video");
    const audio = getTrack("audio");
    const { container } = render(
      <LaneGapAdd upperTrackId={video.id} lowerTrackId={audio.id} />,
    );
    const gap = container.querySelector('[data-testid="lane-gap"]') as HTMLElement;
    fireEvent.mouseEnter(gap);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseLeave(gap);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId("lane-gap-btn").getAttribute("data-visible")).toBe("false");
  });
});

describe("<LaneGapAdd /> — same-kind gap", () => {
  it("click directly adds a same-kind lane anchored to the upper track", async () => {
    // Add a second audio lane so we have an audio↔audio gap to test.
    useComposition.getState().addTrack("audio");
    const comp = useComposition.getState().comp!;
    const audios = comp.tracks
      .filter((t) => t.kind === "audio")
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const upper = audios[0];
    const lower = audios[1];

    const spy = vi.fn(useComposition.getState().addTrack);
    useComposition.setState({ addTrack: spy as never });

    const { container } = render(
      <LaneGapAdd upperTrackId={upper.id} lowerTrackId={lower.id} />,
    );

    // Reveal the button via dwell.
    const gap = container.querySelector('[data-testid="lane-gap"]') as HTMLElement;
    fireEvent.mouseEnter(gap);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // happy-dom may need an extra microtask flush for the React render to
    // commit the new state to the DOM after the timer fires.
    act(() => {});

    const btn = screen.getByTestId("lane-gap-btn");
    expect(btn.getAttribute("data-visible")).toBe("true");

    // Switch to real timers so userEvent.click can use its internal setTimeouts.
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(btn);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("audio", { afterTrackId: upper.id });
    // No kind picker should have appeared.
    expect(screen.queryByRole("menu", { name: /new lane kind/i })).toBeNull();
  });
});

describe("<LaneGapAdd /> — heterogeneous gap", () => {
  it("click opens kind picker; picking a kind calls addTrack with that kind", async () => {
    // Default seeded composition has video → audio adjacency (V1, A1).
    const video = getTrack("video");
    const audio = getTrack("audio");

    const spy = vi.fn(useComposition.getState().addTrack);
    useComposition.setState({ addTrack: spy as never });

    const { container } = render(
      <LaneGapAdd upperTrackId={video.id} lowerTrackId={audio.id} />,
    );
    const gap = container.querySelector('[data-testid="lane-gap"]') as HTMLElement;
    fireEvent.mouseEnter(gap);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // happy-dom may need an extra microtask flush for the React render to
    // commit the new state to the DOM after the timer fires.
    act(() => {});

    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("lane-gap-btn"));

    // Picker should be visible.
    const picker = await screen.findByRole("menu", { name: /new lane kind/i });
    expect(picker).toBeInTheDocument();
    // Pick "Subtitles" (text kind).
    const subItem = picker.querySelector('[data-kind="text"]') as HTMLElement;
    expect(subItem).toBeTruthy();
    await user.click(subItem);

    expect(spy).toHaveBeenCalledWith("text", { afterTrackId: video.id });
  });
});
