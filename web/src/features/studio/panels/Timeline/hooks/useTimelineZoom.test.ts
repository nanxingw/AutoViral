import { createElement, useRef } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTimelineZoom, type TimelineZoom } from "./useTimelineZoom";

function makeScrollElement(width = 976) {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: 200,
    left: 0,
    width,
    height: 200,
    toJSON: () => ({}),
  });
  document.body.appendChild(element);
  return element;
}

function renderZoom(duration = 10, width = 976) {
  const element = makeScrollElement(width);
  const scrollRef = { current: element };
  const hook = renderHook(() => useTimelineZoom({ duration, scrollRef }));
  return { ...hook, element };
}

describe("useTimelineZoom", () => {
  it("clamps zoom to the 5–300 px/s range", () => {
    const { result } = renderZoom();

    act(() => result.current.setZoom(1));
    expect(result.current.pixelsPerSecond).toBe(5);

    act(() => result.current.setZoom(500));
    expect(result.current.pixelsPerSecond).toBe(300);
  });

  it("steps zoom buttons by 1.25×", () => {
    const { result } = renderZoom();

    expect(result.current.pixelsPerSecond).toBe(60);
    act(() => result.current.zoomIn());
    expect(result.current.pixelsPerSecond).toBe(75);
    act(() => result.current.zoomOut());
    expect(result.current.pixelsPerSecond).toBe(60);
  });

  it("fits the full duration into the visible lane width", () => {
    const { result, element } = renderZoom(10, 976);
    element.scrollLeft = 240;

    act(() => result.current.fit());

    // 976px viewport - 176px sticky track header = 800px lane.
    expect(result.current.pixelsPerSecond).toBe(80);
    expect(element.scrollLeft).toBe(0);
  });

  it("keeps the time under the mouse stationary while wheel-zooming", () => {
    const duration = 100;
    let zoom: TimelineZoom | null = null;
    function Harness() {
      const scrollRef = useRef<HTMLDivElement>(null);
      const nextZoom = useTimelineZoom({ duration, scrollRef });
      zoom = nextZoom;
      return createElement(
        "div",
        { ref: scrollRef, "data-testid": "scroll" },
        createElement("div", {
          "data-testid": "content",
          style: { width: 176 + duration * nextZoom.pixelsPerSecond },
        }),
      );
    }
    const view = render(createElement(Harness));
    const element = view.getByTestId("scroll");
    const content = view.getByTestId("content");
    Object.defineProperty(element, "clientWidth", {
      configurable: true,
      value: 976,
    });
    element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      right: 976,
      bottom: 200,
      left: 0,
      width: 976,
      height: 200,
      toJSON: () => ({}),
    });
    let scrollLeft = 0;
    Object.defineProperties(element, {
      scrollWidth: {
        configurable: true,
        get: () => Number.parseFloat(content.style.width),
      },
      scrollLeft: {
        configurable: true,
        get: () => scrollLeft,
        set: (value: number) => {
          // Match browser overflow geometry: writes beyond the current
          // committed content width are clamped immediately.
          scrollLeft = Math.min(
            Math.max(0, value),
            Math.max(0, element.scrollWidth - element.clientWidth),
          );
        },
      },
    });

    act(() => zoom!.fit());
    expect(element.scrollWidth).toBe(element.clientWidth);

    const laneMouseX = 760;
    const clientX = 176 + laneMouseX;
    const timeBefore = (element.scrollLeft + laneMouseX) / zoom!.pixelsPerSecond;

    act(() => {
      const event = new WheelEvent("wheel", {
        deltaY: -100,
        bubbles: true,
        cancelable: true,
      });
      // happy-dom does not populate these inherited MouseEvent fields from
      // WheelEventInit, so supply the browser values explicitly.
      Object.defineProperties(event, {
        clientX: { value: clientX },
        ctrlKey: { value: true },
      });
      element.dispatchEvent(event);
    });

    expect(element.scrollWidth).toBeGreaterThan(element.clientWidth);
    const timeAfter = (element.scrollLeft + laneMouseX) / zoom!.pixelsPerSecond;
    expect(timeAfter).toBeCloseTo(timeBefore, 8);
  });

  it("uses an ordinary wheel to pan horizontally without changing zoom", () => {
    const { result, element } = renderZoom();
    element.scrollLeft = 100;
    const zoomBefore = result.current.pixelsPerSecond;

    act(() => {
      element.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 40,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(element.scrollLeft).toBe(140);
    expect(result.current.pixelsPerSecond).toBe(zoomBefore);
  });
});
