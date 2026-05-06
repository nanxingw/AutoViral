import { useEffect, useState } from "react";
import { useComposition } from "@/features/studio/store";
import { LibraryTab } from "./LibraryTab";
import { InspectorTab } from "@/features/studio/panels/Inspector/InspectorTab";

interface Props {
  workId: string;
}

type Tab = "library" | "inspector";

/**
 * AssetSidebar — right-column shell for two views:
 *   - Library:   browse the work's asset library (existing behaviour)
 *   - Inspector: per-clip variant switcher + dive entry point (Phase 5.B)
 *
 * Auto-activation (D2): selecting a clip in the timeline switches the active
 * tab to "inspector". The user can override by clicking back to "library";
 * we then keep their choice until selection changes again.
 */
export function AssetSidebar({ workId }: Props) {
  const selection = useComposition((s) => s.selection);
  const [tab, setTab] = useState<Tab>("library");

  // D2 auto-activation — when selection arrives, jump to inspector.
  useEffect(() => {
    if (selection) setTab("inspector");
  }, [selection]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <TabBar tab={tab} onChange={setTab} />
      <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
        {tab === "library" ? <LibraryTab workId={workId} /> : <InspectorTab />}
      </div>
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        padding: "10px 14px 0",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <TabButton active={tab === "library"} onClick={() => onChange("library")}>
        Library
      </TabButton>
      <TabButton active={tab === "inspector"} onClick={() => onChange("inspector")}>
        Inspector
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-bare
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}
