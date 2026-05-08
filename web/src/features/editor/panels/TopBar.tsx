import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Button } from "@/ui/Button";
import { useEditor } from "../store";
import { useT } from "@/i18n/useT";
import { CheckpointsMenu } from "@/features/checkpoints/CheckpointsMenu";

interface TopBarProps {
  workId: string;
  savedAt: string | null;
  /** Set when an autosave round-trip rejected. Renders a red badge in
   *  place of the "Saved · time" indicator so the user doesn't trust the
   *  stale time stamp. */
  saveError?: string | null;
  onExportCurrent: () => void;
  onExportAll: () => void;
}

export function TopBar({
  workId,
  savedAt,
  saveError,
  onExportCurrent,
  onExportAll,
}: TopBarProps) {
  const navigate = useNavigate();
  const car = useEditor((s) => s.car);
  const [open, setOpen] = useState(false);
  const t = useT();

  // Same portal-anchor pattern as CheckpointsMenu: the editor TopBar sits
  // inside a react-resizable-panels Panel, so an absolutely-positioned
  // dropdown gets clipped by the panel's stacking/overflow context. Render
  // the menu in a portal to <body> with `position:fixed`, anchored to the
  // trigger button's bounding rect — escapes both the stacking context
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

  useLayoutEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      const menu = document.querySelector("[data-export-menu]");
      if (menu?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div
      className="editor-topbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        position: "relative",
      }}
    >
      <Button variant="ghost" onClick={() => navigate("/")}>
        {t("editor.topbar.backToWorks")}
      </Button>
      <strong
        style={{ fontFamily: "var(--font-editorial)", fontSize: 18 }}
        title={car?.id && car.id !== workId ? `carousel: ${car.id}` : undefined}
      >
        {workId}
      </strong>
      {saveError ? (
        <span
          role="alert"
          title={t("common.saveFailedTitle", { msg: saveError })}
          style={{
            marginLeft: "auto",
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid var(--status-error, #d4756c)",
            background: "rgba(212, 117, 108, 0.1)",
            color: "var(--status-error, #d4756c)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
          }}
        >
          ⚠ {t("common.saveFailed")}
        </span>
      ) : (
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-soft)",
          }}
        >
          {savedAt ? `${t("common.saved")} · ${savedAt}` : t("common.unsaved")}
        </span>
      )}
      <CheckpointsMenu workId={workId} />
      <Button ref={btnRef} variant="primary" onClick={() => setOpen((v) => !v)}>
        {t("editor.topbar.exportMenu")}
      </Button>
      {open && anchorRect && createPortal(
        <div
          role="menu"
          data-export-menu
          style={{
            position: "fixed",
            right: window.innerWidth - anchorRect.right,
            top: anchorRect.bottom + 4,
            minWidth: 200,
            background: "var(--surface-1, #fff)",
            border: "1px solid var(--border, rgba(0,0,0,0.12))",
            borderRadius: 6,
            padding: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <MenuItem
            onClick={() => {
              setOpen(false);
              onExportCurrent();
            }}
          >
            {t("editor.topbar.exportCurrent")}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onExportAll();
            }}
          >
            {t("editor.topbar.exportAll")}
          </MenuItem>
        </div>,
        document.body,
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "8px 10px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--text)",
        borderRadius: 4,
      }}
    >
      {children}
    </button>
  );
}
