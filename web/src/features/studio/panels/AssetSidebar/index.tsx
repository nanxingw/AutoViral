import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useComposition } from "@/features/studio/store";
import { LibraryTab } from "./LibraryTab";
import { ScriptTab } from "./ScriptTab";
import { InspectorTab } from "@/features/studio/panels/Inspector/InspectorTab";
import { useT } from "@/i18n/useT";

interface Props {
  workId: string;
}

type Tab = "library" | "inspector" | "script";

/**
 * AssetSidebar — right-column shell for three views:
 *   - Library:   browse the work's asset library (existing behaviour)
 *   - Inspector: per-clip variant switcher + dive entry point (Phase 5.B)
 *   - Script:    read-only storyboard / 分镜 skeleton (S3 · PRD-0007)
 *
 * Auto-activation (D2): selecting a clip in the timeline switches the active
 * tab to "inspector". The user can override by clicking back to "library";
 * we then keep their choice until selection changes again.
 *
 * S3 exception: when the user is parked on the "script" tab, a selection must
 * NOT yank them away to the inspector — reading the storyboard while clicking
 * clips on the timeline is a first-class flow. The library→inspector behaviour
 * is preserved unchanged for the other two tabs.
 */
export function AssetSidebar({ workId }: Props) {
  const selection = useComposition((s) => s.selection);
  const [tab, setTab] = useState<Tab>("library");

  // D2 auto-activation — when selection arrives, jump to inspector. We read the
  // current tab from a ref (not the effect's dependency list) so a tab change
  // alone never re-fires the jump; only a *selection change* does. This keeps
  // the "script tab stays sticky" guard correct without making the effect
  // re-run (and re-jump) every time the user manually switches tabs.
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (selection && tabRef.current !== "script") setTab("inspector");
  }, [selection]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <TabBar tab={tab} onChange={setTab} />
      <div style={{ flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}>
        <motion.div
          key={tab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: [0.32, 0.72, 0, 1] }}
          style={{ height: "100%" }}
        >
          {tab === "script" ? (
            <ScriptTab />
          ) : tab === "library" ? (
            <LibraryTab workId={workId} />
          ) : (
            <InspectorTab />
          )}
        </motion.div>
      </div>
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const t = useT();
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
        {t("studio.assetSidebar.tabLibrary")}
      </TabButton>
      <TabButton active={tab === "inspector"} onClick={() => onChange("inspector")}>
        {t("studio.assetSidebar.tabInspector")}
      </TabButton>
      <TabButton active={tab === "script"} onClick={() => onChange("script")}>
        {t("studio.assetSidebar.tabScript")}
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
