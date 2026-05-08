import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";
import {
  loadComposition,
  saveComposition,
} from "@/features/studio/services/composition";
import { PreviewPanel } from "@/features/studio/panels/PreviewPanel";
import { Timeline } from "@/features/studio/panels/Timeline";
import { ChatPanel } from "@/features/studio/panels/Chat";
import { buildStudioViewerContext } from "@/features/studio/services/viewerContext";
import { AssetSidebar } from "@/features/studio/panels/AssetSidebar";
import { TopBar } from "@/features/studio/panels/TopBar";
import { TweaksPanel } from "@/features/studio/panels/Tweaks";
import { useShortcuts } from "@/features/studio/hooks/useShortcuts";
import { useT } from "@/i18n/useT";
import { useLocaleStore } from "@/i18n/store";
import { useWorks } from "@/queries/works";
import NotFound from "./NotFound";

// Same locale-aware HH:MM helper as Editor.tsx — keeps the savedAt
// indicator short + predictable instead of letting the browser default
// surface seconds / timezone.
function fmtSavedAt(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale !== "zh",
  }).format(d);
}

// Resize handle styling — slim editorial separator using --glass-border.
// 4px-wide cool-steel rule that thickens on hover/drag for clear affordance.
const handleBaseStyle: React.CSSProperties = {
  flex: "0 0 4px",
  background: "var(--glass-border)",
  transition: "background 160ms ease",
};

function HResizeHandle({ id }: { id: string }) {
  return (
    <PanelResizeHandle
      id={id}
      data-testid={`resize-handle-${id}`}
      style={{ ...handleBaseStyle, cursor: "col-resize" }}
    />
  );
}

function VResizeHandle({ id }: { id: string }) {
  return (
    <PanelResizeHandle
      id={id}
      data-testid={`resize-handle-${id}`}
      style={{ ...handleBaseStyle, cursor: "row-resize", flex: "0 0 4px" }}
    />
  );
}

export default function Studio() {
  const { workId } = useParams();
  const loadComp = useComposition((s) => s.loadComposition);
  const comp = useComposition((s) => s.comp);
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // R20: surface autosave failures. Studio's autosave previously had NO
  // .catch handler at all — unhandled rejection + silent UX. Now any
  // rejection sets saveError so TopBar shows a red SAVE FAILED badge
  // instead of the stale time-stamp.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useShortcuts(workId ?? null);

  const [loadError, setLoadError] = useState<string | null>(null);
  // Mirror of Editor.tsx Round 16 typo guard — defer makeEmptyComposition
  // until we can cross-check works list. 404 on a real-but-unsaved work
  // is fine; 404 on a typo'd workId should NotFound instead of silently
  // creating a ghost composition.
  const [loadEmpty, setLoadEmpty] = useState(false);
  const works = useWorks();
  // Reset comp + savedAt synchronously when workId changes — prevents A's
  // composition from being saved into B during a route hop. (Codex review 2026-04-27)
  useEffect(() => {
    if (!workId) return;
    loadComp(null);
    setSavedAt(null);
    setSaveError(null);
    setLoadError(null);
    setLoadEmpty(false);
    let cancelled = false;
    (async () => {
      try {
        const found = await loadComposition(workId);
        if (cancelled) return;
        if (found) {
          loadComp(found);
        } else {
          setLoadEmpty(true);
        }
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.status;
        if (typeof status === "number" && status >= 500) {
          // Corrupt yaml or server bug — DO NOT overwrite by autosaving an
          // empty comp. Show the error and leave comp null so autosave is
          // skipped (it requires comp.workId === workId). (Codex review 2026-04-27)
          setLoadError(
            t("studio.loadError.body", {
              msg: err?.message ?? t("studio.loadError.serverFallbackMsg"),
            }),
          );
        } else {
          // Network unreachable / non-500 non-404 — fresh-start fallback,
          // doesn't go through typo guard (no 404 → no ambiguity).
          loadComp(makeEmptyComposition({ workId }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [workId, loadComp, t]);

  // 404 → typo guard. Once works.data arrives, decide.
  const workInList =
    works.data && workId ? works.data.some((w) => w.id === workId) : null;
  useEffect(() => {
    if (!loadEmpty || !workId) return;
    if (workInList === true) {
      loadComp(makeEmptyComposition({ workId }));
    }
  }, [loadEmpty, workInList, workId, loadComp]);

  // Autosave on change (debounced) — guard with workId match so a stale
  // comp doesn't get saved into the new route's work id. Also skip when the
  // composition is empty (no clips on any track); persisting an empty comp
  // shadows the server-side legacy auto-build for unedited works.
  useEffect(() => {
    if (!comp || !workId) return;
    if (comp.workId !== workId) return;   // load-in-progress
    const isEmpty = comp.tracks.every((t) => t.clips.length === 0);
    if (isEmpty) return;                  // don't persist a blank slate
    const tid = setTimeout(() => {
      saveComposition(workId, comp)
        .then(() => {
          setSavedAt(fmtSavedAt(new Date(), locale));
          setSaveError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setSaveError(msg);
        });
    }, 800);
    return () => clearTimeout(tid);
  }, [comp, workId, locale]);

  if (!workId) return <div>{t("studio.loadError.missingWorkId")}</div>;
  // Typo guard (Round 16): 404 + workId absent from works list → user
  // followed a stale/wrong URL. Render NotFound rather than silently
  // bootstrap an empty composition that would later autosave a ghost.
  if (loadEmpty && workInList === false) return <NotFound />;
  if (loadError) {
    return (
      <div style={{ padding: 32, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
        <h2>{t("studio.loadError.title")}</h2>
        <p>{loadError}</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          {t("studio.loadError.helpText", { workId })}
        </p>
      </div>
    );
  }

  return (
    <div
      className="studio-shell"
      data-work-id={workId}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        gap: 12,
        padding: 12,
        boxSizing: "border-box",
      }}
    >
      <div data-area="top" className="glass" style={{ flex: "0 0 56px" }}>
        <TopBar
          workId={workId}
          savedAt={savedAt}
          saveError={saveError}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          settingsOpen={settingsOpen}
        />
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0 }}>
        <PanelGroup
          direction="horizontal"
          autoSaveId="autoviral-studio-v1"
          style={{ height: "100%", gap: 0 }}
        >
          <Panel id="chat" order={1} defaultSize={18} minSize={14} maxSize={30}>
            <div
              data-area="chat"
              className="glass"
              style={{ height: "100%", overflow: "hidden", minHeight: 0 }}
            >
              <ChatPanel
                workId={workId}
                getViewerContext={() => {
                  const s = useComposition.getState();
                  return buildStudioViewerContext(
                    s.comp,
                    s.selection,
                    s.currentFrame,
                  );
                }}
                dispatchAction={(action) => {
                  const s = useComposition.getState();
                  if (action.type === "select-clip") {
                    const id = action.data.clipId ?? action.data.id;
                    if (typeof id === "string") s.setSelection(id);
                  } else if (action.type === "set-frame") {
                    const f = action.data.frame;
                    if (typeof f === "number") s.setFrame(f);
                  }
                  // studio ignores select-slide / select-layer
                }}
              />
            </div>
          </Panel>

          <HResizeHandle id="chat-center" />

          <Panel id="center" order={2} defaultSize={65} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="autoviral-studio-center-v1" style={{ height: "100%" }}>
              <Panel id="preview" order={1} defaultSize={70} minSize={30}>
                <div
                  data-area="preview"
                  className="glass"
                  style={{ height: "100%", overflow: "hidden", minHeight: 0 }}
                >
                  <PreviewPanel />
                </div>
              </Panel>

              <VResizeHandle id="preview-timeline" />

              <Panel id="timeline" order={2} defaultSize={30} minSize={15}>
                <div
                  data-area="timeline"
                  className="glass"
                  style={{ height: "100%", overflow: "hidden", minHeight: 0 }}
                >
                  <Timeline />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <HResizeHandle id="center-aside" />

          <Panel id="aside" order={3} defaultSize={17} minSize={14} maxSize={28}>
            <div
              data-area="aside"
              className="glass"
              style={{ height: "100%", overflow: "hidden", minHeight: 0 }}
            >
              <AssetSidebar workId={workId} />
            </div>
          </Panel>
        </PanelGroup>
      </div>

      <TweaksPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        workId={workId}
      />
    </div>
  );
}
