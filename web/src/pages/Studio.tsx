import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";
import {
  loadComposition,
  saveComposition,
} from "@/features/studio/services/composition";
import { exportMp4 } from "@/features/studio/services/render";
import { PreviewPanel } from "@/features/studio/panels/PreviewPanel";
import { Timeline } from "@/features/studio/panels/Timeline";
import { TweaksPanel } from "@/features/studio/panels/Tweaks";
import { ChatPanel } from "@/features/studio/panels/Chat";
import { TopBar } from "@/features/studio/panels/TopBar";

export default function Studio() {
  const { workId } = useParams();
  const loadComp = useComposition((s) => s.loadComposition);
  const comp = useComposition((s) => s.comp);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!workId) return;
    (async () => {
      const found = await loadComposition(workId);
      loadComp(found ?? makeEmptyComposition({ workId }));
    })();
  }, [workId, loadComp]);

  // Autosave on change (debounced)
  useEffect(() => {
    if (!comp || !workId) return;
    const t = setTimeout(() => {
      saveComposition(workId, comp).then(() =>
        setSavedAt(new Date().toLocaleTimeString()),
      );
    }, 800);
    return () => clearTimeout(t);
  }, [comp, workId]);

  if (!workId) return <div>Missing workId</div>;

  return (
    <div
      className="studio-shell"
      data-work-id={workId}
      style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 300px",
        gridTemplateRows: "56px 1fr 320px",
        gridTemplateAreas:
          '"top top top" "chat preview aside" "chat timeline aside"',
        height: "calc(100vh - 56px)",
      }}
    >
      <div style={{ gridArea: "top" }}>
        <TopBar
          workId={workId}
          savedAt={savedAt}
          onExport={() => {
            void exportMp4(workId);
          }}
        />
      </div>
      <div
        style={{ gridArea: "chat", borderRight: "1px solid var(--border)" }}
      >
        <ChatPanel workId={workId} />
      </div>
      <div style={{ gridArea: "preview", overflow: "hidden" }}>
        <PreviewPanel />
      </div>
      <div
        style={{
          gridArea: "timeline",
          borderTop: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <Timeline />
      </div>
      <div
        style={{ gridArea: "aside", borderLeft: "1px solid var(--border)" }}
      >
        <TweaksPanel />
      </div>
    </div>
  );
}
