import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type Konva from "konva";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEditor } from "@/features/editor/store";
import { makeEmptyCarousel, type Carousel } from "@/features/editor/types";
import {
  loadCarousel,
  saveCarousel,
} from "@/features/editor/services/carousel";
import { Stage } from "@/features/editor/canvas/Stage";
import { Inspector } from "@/features/editor/panels/Inspector";
import { Filmstrip } from "@/features/editor/panels/Filmstrip";
import { TopBar } from "@/features/editor/panels/TopBar";
import { useExport } from "@/features/editor/hooks/useExport";
import { CarouselExportProgress } from "@/features/editor/panels/CarouselExportProgress";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { useT } from "@/i18n/useT";
import { useLocaleStore } from "@/i18n/store";
import { localizeApiErrorParts } from "@/i18n/serverError";
import { LoadErrorScreen } from "@/components/LoadErrorScreen";
import { useWorks } from "@/queries/works";
import NotFound from "./NotFound";

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

// #50 — dirtiness fingerprint for autosave. Serializes everything a user can
// edit while dropping the volatile `updatedAt` timestamp (not user content),
// so "current === load-time baseline" reliably means "nothing was edited yet"
// regardless of structural shape. The old guard used layer-count as a proxy
// for "untouched", which silently discarded global edits (grain / palette /
// layout / bg) on single-slide/0-layer carousels because those edits don't add
// a layer. Comparing against the loaded baseline fixes that AND the inverse
// (deleting down to a 1-slide/0-layer carousel now persists, instead of being
// mistaken for a pristine blank and resurrected on refresh).
export function serializeForDirty(car: Carousel): string {
  const { updatedAt: _updatedAt, ...rest } = car;
  return JSON.stringify(rest);
}

export default function Editor() {
  const { workId } = useParams();
  const loadCar = useEditor((s) => s.loadCarousel);
  const car = useEditor((s) => s.car);
  // Load-time (or last-persisted) snapshot, keyed by workId. autosave fires
  // only when the live carousel diverges from this baseline (#50).
  const baselineRef = useRef<{ workId: string; json: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // R20: surface autosave failures to UI. Previously `.catch(() => undefined)`
  // silently swallowed errors, leaving the topbar showing a stale "Saved · X"
  // even when 5+ minutes of edits never reached the server. Now setSaveError
  // forces a red "SAVE FAILED" badge in TopBar so the user knows to copy
  // their work out before refreshing.
  const [saveError, setSaveError] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const { setStage, exportCurrent, exportAll, exporting, progress } = useExport();
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);

  // #61 — message + raw detail split so the failure screen shows a human
  // headline and collapses the raw ZodError into a technical-details panel.
  const [loadError, setLoadError] = useState<{ message: string; detail: string } | null>(null);
  // Tracks "loadCarousel returned null" — i.e. the work id 404'd. Defer
  // makeEmptyCarousel until we can cross-check works list (Round 16): a
  // 404 on a real-but-unsaved work is fine (NewWorkCard just created it,
  // yaml hasn't been written yet); a 404 on a typo'd workId should route
  // to NotFound instead of silently auto-creating a ghost work.
  const [loadEmpty, setLoadEmpty] = useState(false);
  const works = useWorks();
  useEffect(() => {
    if (!workId) return;
    loadCar(null);
    setSavedAt(null);
    setSaveError(null);
    setLoadError(null);
    setLoadEmpty(false);
    let cancelled = false;
    (async () => {
      try {
        const found = await loadCarousel(workId);
        if (cancelled) return;
        if (found) {
          loadCar(found);
          // e2e-report F81 (Editor sister of F67): backfill savedAt so a
          // previously-saved carousel doesn't misreport as "Unsaved" on every
          // load. Use load time as a proxy for disk mtime (the GET response
          // doesn't include it). Same trade-off as Studio.tsx — replace with
          // real mtime if backend ever exposes it.
          setSavedAt(fmtSavedAt(new Date(), locale));
        } else {
          setLoadEmpty(true);
        }
      } catch (err: any) {
        if (cancelled) return;
        const status = err?.status;
        if (typeof status === "number" && status >= 500) {
          // Don't overwrite a corrupt carousel.yaml with an empty one.
          // R26: localize the server error via errorCode → i18n key, fall
          // back to err.message for unmapped codes.
          // #61: raw detail (ZodError JSON) → collapsible panel, not headline.
          const parts = localizeApiErrorParts(err, t);
          setLoadError({
            message: t("editor.loadError.body", {
              msg: parts.message || t("editor.loadError.serverFallbackMsg"),
            }),
            detail: parts.detail,
          });
        } else {
          // Network unreachable / non-500 non-404 — fresh-start fallback,
          // same legacy behaviour, doesn't trigger typo guard.
          loadCar(makeEmptyCarousel(workId));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workId, loadCar, t]);

  // 404-resolved load flow: once `works.data` arrives, decide whether the
  // 404 was legitimate (work exists in list — fresh empty carousel) or a
  // typo'd URL (work absent from list — render NotFound). We defer
  // makeEmptyCarousel here so autosave doesn't accidentally persist a
  // ghost work for typo'd ids.
  const workInList =
    works.data && workId ? works.data.some((w) => w.id === workId) : null;
  useEffect(() => {
    if (!loadEmpty || !workId) return;
    if (workInList === true) {
      loadCar(makeEmptyCarousel(workId));
    }
    // workInList === false → rendered as NotFound below; do nothing here.
    // workInList === null → still waiting for works.data, keep waiting.
  }, [loadEmpty, workInList, workId, loadCar]);

  useEffect(() => {
    if (!car || !workId) return;
    if (car.workId !== workId) return;   // load-in-progress; don't save stale data
    const currentJson = serializeForDirty(car);
    // #50 — establish the load-time baseline once per workId. Until the user
    // actually mutates the carousel, current === baseline and we skip the PUT.
    // This preserves the original intent (don't persist an untouched blank
    // slate, which would shadow legacy auto-build) WITHOUT using layer-count as
    // a proxy for dirtiness — so a grain/palette/layout/bg edit on a single
    // empty slide now persists instead of being silently dropped.
    if (!baselineRef.current || baselineRef.current.workId !== workId) {
      baselineRef.current = { workId, json: currentJson };
      return; // freshly loaded — treat disk/empty content as already persisted
    }
    if (currentJson === baselineRef.current.json) return; // no net change
    const tid = setTimeout(() => {
      saveCarousel(workId, car)
        .then(() => {
          // Advance the baseline to what we just persisted, so "dirty" means
          // "differs from last saved state" — a later revert back to disk
          // content still re-saves correctly.
          baselineRef.current = { workId, json: currentJson };
          setSavedAt(fmtSavedAt(new Date(), locale));
          setSaveError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setSaveError(msg);
        });
    }, 800);
    return () => clearTimeout(tid);
  }, [car, workId, locale]);

  if (!workId) return <div>{t("editor.loadError.missingWorkId")}</div>;
  // Typo guard (Round 16): a 404 + workId absent from works list means
  // the URL was wrong, not a freshly-created work. Render NotFound so
  // user gets a clear "wrong page" affordance instead of an empty editor
  // that silently autosaves a ghost work.
  if (loadEmpty && workInList === false) return <NotFound />;
  if (loadError) {
    return (
      <LoadErrorScreen
        title={t("editor.loadError.title")}
        message={loadError.message}
        detail={loadError.detail}
        helpText={t("editor.loadError.helpText", { workId })}
      />
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
          saveError={saveError}
          onExportCurrent={() =>
            exportCurrent(`${car?.id ?? workId}-slide.png`)
          }
          onExportAll={() => {
            void exportAll();
          }}
        />
      </div>

      {/* #85 — progress overlay covers the cycling canvas + reports N/M. */}
      {exporting && <CarouselExportProgress progress={progress} />}

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
              {workId ? <TerminalPanel workId={workId} /> : null}
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
