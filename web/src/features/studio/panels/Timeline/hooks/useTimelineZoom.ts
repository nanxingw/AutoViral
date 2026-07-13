import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TIMELINE_HEADER_WIDTH } from "../timelineMetrics";

const MIN_PIXELS_PER_SECOND = 5;
const MAX_PIXELS_PER_SECOND = 300;
const INITIAL_PIXELS_PER_SECOND = 60;
const BUTTON_ZOOM_FACTOR = 1.25;

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return MIN_PIXELS_PER_SECOND;
  return Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, value));
}

function sliderPositionFor(pixelsPerSecond: number): number {
  const range = Math.log(MAX_PIXELS_PER_SECOND / MIN_PIXELS_PER_SECOND);
  return Math.log(clampZoom(pixelsPerSecond) / MIN_PIXELS_PER_SECOND) / range;
}

function zoomForSliderPosition(position: number): number {
  const normalized = Math.min(1, Math.max(0, position));
  return MIN_PIXELS_PER_SECOND *
    Math.pow(MAX_PIXELS_PER_SECOND / MIN_PIXELS_PER_SECOND, normalized);
}

export interface TimelineZoom {
  pixelsPerSecond: number;
  sliderPosition: number;
  setSliderPosition: (position: number) => void;
  setZoom: (pixelsPerSecond: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

export function useTimelineZoom({
  duration,
  scrollRef,
}: {
  duration: number;
  scrollRef: RefObject<HTMLElement | null>;
}): TimelineZoom {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(INITIAL_PIXELS_PER_SECOND);
  const pixelsPerSecondRef = useRef(INITIAL_PIXELS_PER_SECOND);
  const pendingAnchorRef = useRef<{
    anchorTime: number;
    laneX: number;
    target: number;
  } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    const element = scrollRef.current;
    if (!pending || !element || pending.target !== pixelsPerSecond) return;
    element.scrollLeft = Math.max(
      0,
      pending.anchorTime * pixelsPerSecond - pending.laneX,
    );
    pendingAnchorRef.current = null;
  }, [pixelsPerSecond, scrollRef]);

  const laneCenterClientX = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const rect = element.getBoundingClientRect();
    const laneWidth = Math.max(0, element.clientWidth - TIMELINE_HEADER_WIDTH);
    return rect.left + TIMELINE_HEADER_WIDTH + laneWidth / 2;
  }, [scrollRef]);

  const applyZoom = useCallback(
    (next: number | ((current: number) => number), anchorClientX?: number) => {
      const current = pixelsPerSecondRef.current;
      const target = clampZoom(typeof next === "function" ? next(current) : next);
      const element = scrollRef.current;
      if (element && current > 0) {
        const rect = element.getBoundingClientRect();
        const fallbackAnchor =
          rect.left +
          TIMELINE_HEADER_WIDTH +
          Math.max(0, element.clientWidth - TIMELINE_HEADER_WIDTH) / 2;
        const anchor = anchorClientX ?? fallbackAnchor;
        const laneX = Math.max(0, anchor - rect.left - TIMELINE_HEADER_WIDTH);
        const anchorTime = (element.scrollLeft + laneX) / current;
        pendingAnchorRef.current = { anchorTime, laneX, target };
      }
      pixelsPerSecondRef.current = target;
      setPixelsPerSecond(target);
    },
    [scrollRef],
  );

  const setZoom = useCallback(
    (next: number) => applyZoom(next, laneCenterClientX()),
    [applyZoom, laneCenterClientX],
  );
  const zoomIn = useCallback(
    () => applyZoom((current) => current * BUTTON_ZOOM_FACTOR, laneCenterClientX()),
    [applyZoom, laneCenterClientX],
  );
  const zoomOut = useCallback(
    () => applyZoom((current) => current / BUTTON_ZOOM_FACTOR, laneCenterClientX()),
    [applyZoom, laneCenterClientX],
  );
  const fit = useCallback(() => {
    const element = scrollRef.current;
    const laneWidth = element
      ? Math.max(0, element.clientWidth - TIMELINE_HEADER_WIDTH)
      : 0;
    const fitted = duration > 0 && laneWidth > 0
      ? laneWidth / duration
      : MIN_PIXELS_PER_SECOND;
    pendingAnchorRef.current = null;
    if (element) element.scrollLeft = 0;
    const target = clampZoom(fitted);
    pixelsPerSecondRef.current = target;
    setPixelsPerSecond(target);
  }, [duration, scrollRef]);

  const sliderPosition = sliderPositionFor(pixelsPerSecond);
  const setSliderPosition = useCallback(
    (position: number) => setZoom(zoomForSliderPosition(position)),
    [setZoom],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        // Browsers expose trackpad pinch as a ctrl-modified wheel stream.
        const factor = Math.exp(-event.deltaY * 0.002);
        applyZoom((current) => current * factor, event.clientX);
        return;
      }

      const horizontalDelta = event.deltaX + event.deltaY;
      element.scrollLeft = Math.max(0, element.scrollLeft + horizontalDelta);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [applyZoom, duration, scrollRef]);

  return useMemo(
    () => ({
      pixelsPerSecond,
      sliderPosition,
      setSliderPosition,
      setZoom,
      zoomIn,
      zoomOut,
      fit,
    }),
    [fit, pixelsPerSecond, setSliderPosition, setZoom, sliderPosition, zoomIn, zoomOut],
  );
}
