import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type Konva from "konva";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEditor } from "@/features/editor/store";
import { makeEmptyCarousel } from "@/features/editor/types";
import {
  loadCarousel,
  saveCarousel,
} from "@/features/editor/services/carousel";
import { Stage } from "@/features/editor/canvas/Stage";
import { Inspector } from "@/features/editor/panels/Inspector";
import { Filmstrip } from "@/features/editor/panels/Filmstrip";
import { TopBar } from "@/features/editor/panels/TopBar";
import { useExport } from "@/features/editor/hooks/useExport";
import { ChatPanel } from "@/features/studio/panels/Chat";
import { ChatQuickActions } from "@/features/editor/panels/ChatQuickActions";
import type { LocatorData } from "@/features/chat/types";
import { buildEditorViewerContext } from "@/features/editor/services/viewerContext";
import { useT } from "@/i18n/useT";
import { useLocaleStore } from "@/i18n/store";

// Locale-aware HH:MM time formatter for the savedAt indicator.
// Keeps the topbar string short and predictable across locales —
// previously toLocaleTimeString() would surface seconds + sometimes a
// timezone suffix depending on browser, cluttering the chrome.
function fmtSavedAt(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale !== "zh",
  }).format(d);
}

// Match Studio's resize-handle look so editor↔studio interaction stays uniform.
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
      style={{ ...handleBaseStyle, cursor: "row-resize" }}
    />
  );
}

export default function Editor() {
  const { workId } = useParams();
  const loadCar = useEditor((s) => s.loadCarousel);
  const car = useEditor((s) => s.car);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const { setStage, exportCurrent, exportAll } = useExport();
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!workId) return;
    // Reset car + savedAt on workId change so we don't autosave A's car into B.
    loadCar(null);
    setSavedAt(null);
    setLoadError(null);
    let cancelled = false;
    (async () => {
      try {
        const found = await loadCarousel(workId);
        if (cancelled) return;
        loadCar(found ?? makeEmptyCarousel(workId));
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.status;
        if (typeof status === "number" && status >= 500) {
          // Don't overwrite a corrupt carousel.yaml with an empty one.
          setLoadError(
            t("editor.loadError.body", {
              msg: err?.message ?? t("editor.loadError.serverFallbackMsg"),
            }),
          );
        } else {
          loadCar(makeEmptyCarousel(workId));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workId, loadCar, t]);

  useEffect(() => {
    if (!car || !workId) return;
    if (car.workId !== workId) return;   // load-in-progress; don't save stale data
    // Skip empty carousel — persisting blank slate shadows future legacy auto-build
    // (and is just noise for "user opened the page but didn't edit").
    const isEmpty = car.slides.length <= 1 && car.slides[0]?.layers.length === 0;
    if (isEmpty) return;
    const tid = setTimeout(() => {
      saveCarousel(workId, car)
        .then(() => setSavedAt(fmtSavedAt(new Date(), locale)))
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(tid);
  }, [car, workId, locale]);

  if (!workId) return <div>{t("editor.loadError.missingWorkId")}</div>;
  if (loadError) {
    return (
      <div style={{ padding: 32, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
        <h2>{t("editor.loadError.title")}</h2>
        <p>{loadError}</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          {t("editor.loadError.helpText", { workId })}
        </p>
      </div>
    );
  }

  return (
    <div
      className="editor-shell"
      data-work-id={workId}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 56px)",
        gap: 8,
        padding: 8,
        boxSizing: "border-box",
      }}
    >
      <div style={{ flex: "0 0 56px" }}>
        <TopBar
          workId={workId}
          savedAt={savedAt}
          onExportCurrent={() =>
            exportCurrent(`${car?.id ?? workId}-slide.png`)
          }
          onExportAll={() => {
            void exportAll();
          }}
        />
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0 }}>
        <PanelGroup
          direction="horizontal"
          autoSaveId="autoviral-editor-v1"
          style={{ height: "100%", gap: 0 }}
        >
          <Panel id="chat" order={1} defaultSize={20} minSize={14} maxSize={32}>
            <div
              data-area="chat"
              style={{ height: "100%", overflow: "hidden", minHeight: 0, borderRight: "1px solid var(--glass-border)" }}
            >
              <ChatPanel
                workId={workId}
                quickActions={<ChatQuickActions />}
                onJumpToLocator={(data: LocatorData) => {
                  const slideId = (data as { slideId?: string }).slideId;
                  if (slideId) useEditor.getState().setCurrentSlide(slideId);
                }}
                getViewerContext={() => {
                  const s = useEditor.getState();
                  return buildEditorViewerContext(
                    s.car,
                    s.currentSlideId,
                    s.selectionLayerId,
                  );
                }}
                dispatchAction={(action) => {
                  const s = useEditor.getState();
                  if (action.type === "select-slide") {
                    const id = action.data.id;
                    if (typeof id === "string") s.setCurrentSlide(id);
                  } else if (action.type === "select-layer") {
                    const id = action.data.id;
                    if (typeof id === "string") s.setSelectionLayer(id);
                  }
                  // editor ignores select-clip / set-frame
                }}
              />
            </div>
          </Panel>

          <HResizeHandle id="chat-center" />

          <Panel id="center" order={2} defaultSize={58} minSize={30}>
            <PanelGroup
              direction="vertical"
              autoSaveId="autoviral-editor-center-v1"
              style={{ height: "100%" }}
            >
              <Panel id="canvas" order={1} defaultSize={78} minSize={30}>
                <div
                  data-area="canvas"
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "auto",
                    padding: 16,
                    minHeight: 0,
                  }}
                >
                  <Stage
                    ref={(s: Konva.Stage | null) => {
                      stageRef.current = s;
                      setStage(s);
                    }}
                  />
                </div>
              </Panel>

              <VResizeHandle id="canvas-tray" />

              <Panel id="tray" order={2} defaultSize={22} minSize={12} maxSize={50}>
                <div
                  data-area="tray"
                  style={{ height: "100%", overflow: "hidden", minHeight: 0, borderTop: "1px solid var(--glass-border)" }}
                >
                  <Filmstrip />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <HResizeHandle id="center-aside" />

          <Panel id="aside" order={3} defaultSize={22} minSize={14} maxSize={32}>
            <div
              data-area="aside"
              style={{ height: "100%", overflowY: "auto", minHeight: 0, borderLeft: "1px solid var(--glass-border)" }}
            >
              <Inspector workId={workId} />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
