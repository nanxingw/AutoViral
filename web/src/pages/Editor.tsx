import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type Konva from "konva";
import { useEditor } from "@/features/editor/store";
import { makeEmptyCarousel } from "@/features/editor/types";
import {
  loadCarousel,
  saveCarousel,
} from "@/features/editor/services/carousel";
import { Stage } from "@/features/editor/canvas/Stage";
import { SlidesNav } from "@/features/editor/panels/SlidesNav";
import { Inspector } from "@/features/editor/panels/Inspector";
import { Filmstrip } from "@/features/editor/panels/Filmstrip";
import { TopBar } from "@/features/editor/panels/TopBar";
import { AIHint } from "@/features/editor/panels/AIHint";
import { useExport } from "@/features/editor/hooks/useExport";

export default function Editor() {
  const { workId } = useParams();
  const loadCar = useEditor((s) => s.loadCarousel);
  const car = useEditor((s) => s.car);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const { setStage, exportCurrent, exportAll } = useExport();

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!workId) return;
    // Reset car + savedAt on workId change so we don't autosave A's car into B.
    loadCar(null as any);
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
          setLoadError(`无法加载作品数据：${err?.message ?? "服务端错误"}`);
        } else {
          loadCar(makeEmptyCarousel(workId));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workId, loadCar]);

  useEffect(() => {
    if (!car || !workId) return;
    if (car.workId !== workId) return;   // load-in-progress; don't save stale data
    const t = setTimeout(() => {
      saveCarousel(workId, car)
        .then(() => setSavedAt(new Date().toLocaleTimeString()))
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(t);
  }, [car, workId]);

  if (!workId) return <div>Missing workId</div>;
  if (loadError) {
    return (
      <div style={{ padding: 32, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
        <h2>载入失败</h2>
        <p>{loadError}</p>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          自动保存已暂停以防覆盖损坏的数据。请手动检查 ~/.autoviral/works/{workId}/carousel.yaml
        </p>
      </div>
    );
  }

  return (
    <div
      className="editor-shell"
      data-work-id={workId}
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr 340px",
        gridTemplateRows: "56px 1fr 124px",
        gridTemplateAreas: '"top top top" "left canvas right" "left tray right"',
        height: "calc(100vh - 56px)",
      }}
    >
      <div style={{ gridArea: "top" }}>
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
      <div
        style={{
          gridArea: "left",
          borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
          overflowY: "auto",
        }}
      >
        <SlidesNav />
      </div>
      <div
        style={{
          gridArea: "canvas",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "auto",
          padding: 16,
        }}
      >
        <Stage
          ref={(s: Konva.Stage | null) => {
            stageRef.current = s;
            setStage(s);
          }}
        />
      </div>
      <div
        style={{
          gridArea: "right",
          borderLeft: "1px solid var(--border, rgba(0,0,0,0.08))",
          overflowY: "auto",
        }}
      >
        <Inspector workId={workId} />
      </div>
      <div
        style={{
          gridArea: "tray",
          borderTop: "1px solid var(--border, rgba(0,0,0,0.08))",
        }}
      >
        <Filmstrip />
      </div>
      <AIHint />
    </div>
  );
}
