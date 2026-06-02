import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { clampMenuToViewport } from "@/features/studio/panels/Timeline/menuPosition";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A small reusable right-click menu.
 *
 * Portals to <body> so a glass / backdrop-filter ancestor can't trap its
 * position:fixed box (a containing-block bug we've hit before — see
 * reference_backdrop_filter_portal_trap). Clamps into the viewport via the
 * same clampMenuToViewport the timeline track-header menu uses, and tears
 * down on Escape / outside-mousedown.
 *
 * Pure presentational: the opener owns the {x, y} coordinate + open/close
 * state. Render `<ContextMenu>` only while open.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
  ariaLabel,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  ariaLabel?: string;
}) {
  // null until measured — first paint renders at the raw cursor coord, then a
  // layout effect (before paint) clamps it, so there is no off-screen flash.
  // Deps are [x, y] only (fixed for one menu's lifetime), so the clamp runs
  // once and never loops.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      clampMenuToViewport(
        { top: y, left: x },
        el.offsetWidth,
        el.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      data-testid="element-context-menu"
      style={{
        position: "fixed",
        top: pos?.top ?? y,
        left: pos?.left ?? x,
        zIndex: 1000,
        minWidth: 168,
        padding: 4,
        background: "var(--surface-1)",
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--radius-md, 10px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.30)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "7px 12px",
            fontSize: 12,
            fontFamily: "inherit",
            color: item.danger ? "var(--status-error, #d4756c)" : "var(--text)",
            background: "transparent",
            border: "none",
            borderRadius: "var(--radius-sm, 6px)",
            cursor: "pointer",
            letterSpacing: "-0.005em",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--surface-2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
