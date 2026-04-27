import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/ui/Button";
import { useEditor } from "../store";

interface TopBarProps {
  workId: string;
  savedAt: string | null;
  onExportCurrent: () => void;
  onExportAll: () => void;
}

export function TopBar({
  workId,
  savedAt,
  onExportCurrent,
  onExportAll,
}: TopBarProps) {
  const navigate = useNavigate();
  const car = useEditor((s) => s.car);
  const [open, setOpen] = useState(false);

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
        ← Works
      </Button>
      <strong
        style={{ fontFamily: "var(--font-editorial)", fontSize: 18 }}
      >
        {car?.id ?? workId}
      </strong>
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-soft)",
        }}
      >
        {savedAt ? `Saved · ${savedAt}` : "Unsaved"}
      </span>
      <div style={{ position: "relative" }}>
        <Button variant="primary" onClick={() => setOpen((v) => !v)}>
          Export ▾
        </Button>
        {open && (
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 4px)",
              minWidth: 200,
              background: "var(--surface-1, #fff)",
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              borderRadius: 6,
              padding: 4,
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
              zIndex: 30,
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
              Current slide as PNG
            </MenuItem>
            <MenuItem
              onClick={() => {
                setOpen(false);
                onExportAll();
              }}
            >
              All slides as PNGs
            </MenuItem>
          </div>
        )}
      </div>
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
