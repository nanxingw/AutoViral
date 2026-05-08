import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/useT";
import { useCheckpoints } from "./useCheckpoints";

/**
 * Header dropdown listing yaml snapshots for the current work. One click
 * restores the deliverable to that snapshot's content; the surrounding
 * page's react-query subscription pulls the new yaml on the next read.
 *
 * The list is taken automatically by the backend on every agent turn
 * complete (see src/server/checkpoints.ts + src/ws-bridge.ts). Users can
 * also press the button when closed to take a manual snapshot before a
 * risky chat.
 */
export function CheckpointsMenu({ workId }: { workId: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const { items, isLoading, restore, restoring } = useCheckpoints(workId, open);
  const list = { isLoading, data: { items } };
  const onRestore = (file: string) => {
    void restore(file);
    setOpen(false);
  };

  // Anchor + portal: previously the dropdown was `position:absolute` inside
  // a wrapper sitting in a react-resizable-panels Panel, which creates a
  // stacking/overflow context that visually clipped the menu (the absolute
  // child rendered but was hidden behind the LIBRARY panel below). Solution:
  // render the menu in a portal to <body> with `position:fixed`, anchored to
  // the trigger button's bounding rect — escapes both the stacking context
  // and any ancestor `overflow:hidden`.
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Close on outside click (clicking outside both trigger and menu).
  useLayoutEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const menu = document.querySelector('[data-checkpoints-menu]');
      if (menu?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        data-bare
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "5px 11px",
          fontSize: 11,
          borderRadius: 7,
          border: "1px solid var(--glass-border)",
          background: open ? "var(--surface-2)" : "transparent",
          color: "var(--text-soft)",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >
        ↻ {t("checkpoints.button")}
      </button>
      {open && anchorRect && createPortal(
        <div
          role="menu"
          data-checkpoints-menu
          style={{
            position: "fixed",
            right: window.innerWidth - anchorRect.right,
            top: anchorRect.bottom + 4,
            minWidth: 280,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--surface-1, #fff)",
            border: "1px solid var(--glass-border)",
            borderRadius: 8,
            padding: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            zIndex: 1000,
          }}
        >
          {list.isLoading && (
            <div style={menuMutedRow}>{/* loading shim */}…</div>
          )}
          {list.data && list.data.items.length === 0 && (
            <div style={menuMutedRow}>{t("checkpoints.empty")}</div>
          )}
          {list.data?.items.map((c) => (
            <button
              key={c.file}
              type="button"
              onClick={() => onRestore(c.file)}
              disabled={restoring === c.file}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                border: "none",
                background: "transparent",
                cursor: restoring === c.file ? "wait" : "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text)",
                borderRadius: 4,
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ color: "var(--accent)" }}>{c.sha}</span>
              <span style={{ color: "var(--text-soft)" }}>
                {fmtTs(c.ts)} · {c.deliverable.replace(".yaml", "")}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-dimmer)" }}>
                {(c.bytes / 1024).toFixed(1)}KB
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 19);
  const now = new Date();
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return d.toLocaleDateString();
}

const menuMutedRow: React.CSSProperties = {
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text-dimmer)",
};
