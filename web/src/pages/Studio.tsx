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
import { ChatPanel } from "@/features/studio/panels/Chat";
import { AssetSidebar } from "@/features/studio/panels/AssetSidebar";
import { TopBar } from "@/features/studio/panels/TopBar";
import { TweaksPanel } from "@/features/studio/panels/Tweaks";
import { useShortcuts } from "@/features/studio/hooks/useShortcuts";

export default function Studio() {
  const { workId } = useParams();
  const loadComp = useComposition((s) => s.loadComposition);
  const comp = useComposition((s) => s.comp);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useShortcuts(workId ?? null);

  const [loadError, setLoadError] = useState<string | null>(null);
  // Reset comp + savedAt synchronously when workId changes — prevents A's
  // composition from being saved into B during a route hop. (Codex review 2026-04-27)
  useEffect(() => {
    if (!workId) return;
    loadComp(null);
    setSavedAt(null);
    setLoadError(null);
    let cancelled = false;
    (async () => {
      try {
        const found = await loadComposition(workId);
        if (cancelled) return;
        loadComp(found ?? makeEmptyComposition({ workId }));
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.status;
        if (typeof status === "number" && status >= 500) {
          // Corrupt yaml or server bug — DO NOT overwrite by autosaving an
          // empty comp. Show the error and leave comp null so autosave is
          // skipped (it requires comp.workId === workId). (Codex review 2026-04-27)
          setLoadError(`无法加载作品数据：${err?.message ?? "服务端错误"}`);
        } else {
          // Network unreachable / 4xx other than 404 → safe fresh-start fallback.
          loadComp(makeEmptyComposition({ workId }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [workId, loadComp]);

  // Autosave on change (debounced) — guard with workId match so a stale
  // comp doesn't get saved into the new route's work id. Also skip when the
  // composition is empty (no clips on any track); persisting an empty comp
  // shadows the server-side legacy auto-build for unedited works.
  useEffect(() => {
    if (!comp || !workId) return;
    if (comp.workId !== workId) return;   // load-in-progress
    const isEmpty = comp.tracks.every((t) => t.clips.length === 0);
    if (isEmpty) return;                  // don't persist a blank slate
    const t = setTimeout(() => {
      saveComposition(workId, comp).then(() =>
        setSavedAt(new Date().toLocaleTimeString()),
      );
    }, 800);
    return () => clearTimeout(t);
  }, [comp, workId]);

  if (!workId) return <div>Missing workId</div>;
  if (loadError) {
    return (
      <div style={{ padding: 32, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
        <h2>载入失败</h2>
        <p>{loadError}</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          自动保存已暂停以防覆盖损坏的数据。请手动检查 ~/.autoviral/works/{workId}/composition.yaml
        </p>
      </div>
    );
  }

  return (
    <div
      className="studio-shell"
      data-work-id={workId}
      style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 320px",
        gridTemplateRows: "56px 1fr 280px",
        gridTemplateAreas:
          '"top top top" "chat preview aside" "chat timeline aside"',
        height: "100vh",
        gap: 12,
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <div style={{ gridArea: "top" }} className="glass">
        <TopBar
          workId={workId}
          savedAt={savedAt}
          onExport={() => {
            void exportMp4(workId);
          }}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          settingsOpen={settingsOpen}
        />
      </div>
      <div className="glass" style={{ gridArea: "chat", overflow: "hidden", minHeight: 0 }}>
        <ChatPanel workId={workId} />
      </div>
      <div className="glass" style={{ gridArea: "preview", overflow: "hidden", minHeight: 0 }}>
        <PreviewPanel />
      </div>
      <div className="glass" style={{ gridArea: "timeline", overflow: "hidden", minHeight: 0 }}>
        <Timeline />
      </div>
      <div className="glass" style={{ gridArea: "aside", overflow: "hidden", minHeight: 0 }}>
        <AssetSidebar workId={workId} />
      </div>

      <TweaksPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
