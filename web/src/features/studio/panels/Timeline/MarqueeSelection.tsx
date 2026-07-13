import { useEffect, useState, type RefObject } from "react";
import { useT } from "@/i18n/useT";
import { useComposition } from "../../store";
import {
  clearTimelineSelection,
  intersectingClipIds,
  replaceTimelineSelection,
  toggleTimelineSelection,
  unionTimelineSelection,
  type ClipBounds,
  type TimelineSelection,
} from "./selectionMath";

interface Point {
  x: number;
  y: number;
}

interface ActiveMarquee {
  start: Point;
  current: Point;
  baseSelection: TimelineSelection;
  mode: "replace" | "union" | "toggle";
  moved: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT"
  );
}

function effectiveSelection(): TimelineSelection {
  const state = useComposition.getState();
  return state.timelineSelection.primaryId === state.selection
    ? state.timelineSelection
    : replaceTimelineSelection(state.selection);
}

export function MarqueeSelection({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const [active, setActive] = useState<ActiveMarquee | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pointInContainer = (clientX: number, clientY: number): Point => {
      const rect = container.getBoundingClientRect();
      return {
        x: clientX - rect.left + container.scrollLeft,
        y: clientY - rect.top + container.scrollTop,
      };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target?.closest("[data-track-id]") ||
        target.closest("[data-clip-id]") ||
        target.closest("button, input, [role='button']")
      ) {
        return;
      }
      const start = pointInContainer(event.clientX, event.clientY);
      setActive({
        start,
        current: start,
        baseSelection: effectiveSelection(),
        mode: event.shiftKey
          ? "union"
          : event.metaKey || event.ctrlKey
            ? "toggle"
            : "replace",
        moved: false,
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      setActive((current) => {
        if (!current) return null;
        const nextPoint = pointInContainer(event.clientX, event.clientY);
        const moved =
          current.moved ||
          Math.hypot(
            nextPoint.x - current.start.x,
            nextPoint.y - current.start.y,
          ) >= 3;
        return { ...current, current: nextPoint, moved };
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      setActive((current) => {
        if (!current) return null;
        if (!current.moved) {
          useComposition.getState().clearTimelineSelection();
          return null;
        }

        const end = pointInContainer(event.clientX, event.clientY);
        const surfaceRect = container.getBoundingClientRect();
        const clipBounds: ClipBounds[] = Array.from(
          container.querySelectorAll<HTMLElement>("[data-clip-id]"),
        ).map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.dataset.clipId!,
            trackId:
              element.closest<HTMLElement>("[data-track-id]")?.dataset.trackId ??
              "",
            left: rect.left - surfaceRect.left + container.scrollLeft,
            top: rect.top - surfaceRect.top + container.scrollTop,
            right: rect.right - surfaceRect.left + container.scrollLeft,
            bottom: rect.bottom - surfaceRect.top + container.scrollTop,
          };
        });
        const hitIds = intersectingClipIds(clipBounds, {
          left: current.start.x,
          top: current.start.y,
          right: end.x,
          bottom: end.y,
        });

        let next: TimelineSelection;
        if (current.mode === "union") {
          next = unionTimelineSelection(current.baseSelection, hitIds);
        } else if (current.mode === "toggle") {
          next = hitIds.reduce(toggleTimelineSelection, current.baseSelection);
        } else {
          next = unionTimelineSelection(clearTimelineSelection(), hitIds);
        }
        useComposition.getState().setTimelineSelection(next);
        return null;
      });
    };

    const onPointerCancel = () => setActive(null);

    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [containerRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === "Escape") {
        useComposition.getState().clearTimelineSelection();
        setActive(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const state = useComposition.getState();
        // Preserve the legacy single-selection shortcut path exactly,
        // including Shift+Backspace ripple-delete. This capture handler only
        // owns the new group-delete behavior.
        if (state.timelineSelection.ids.length <= 1) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        state.removeTimelineSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  if (!active?.moved) return null;
  const left = Math.min(active.start.x, active.current.x);
  const top = Math.min(active.start.y, active.current.y);
  const width = Math.abs(active.current.x - active.start.x);
  const height = Math.abs(active.current.y - active.start.y);
  return (
    <div
      role="status"
      aria-label={t("studio.timeline.marqueeAria")}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        zIndex: 5,
        pointerEvents: "none",
        border: "1px solid var(--accent-lo)",
        borderRadius: 6,
        background: "var(--accent-glow)",
      }}
    />
  );
}
