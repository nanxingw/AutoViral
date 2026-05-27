// #85 — progress overlay for the carousel "export all" flow. The export
// walks the LIVE Konva canvas through every slide (toDataURL per slide), a
// multi-second operation that previously gave zero feedback AND let the user
// watch the canvas glitch through each slide. This portal overlay both
// reports N/M progress and covers the cycling canvas. Non-cancelable: the
// op is short and downloads land incrementally, so a mid-flight cancel would
// just leave a partial set with no clean rollback.

import { createPortal } from "react-dom";
import { useT } from "@/i18n/useT";
import type { ExportProgress } from "../hooks/useExport";
import styles from "./CarouselExportProgress.module.css";

export function CarouselExportProgress({ progress }: { progress: ExportProgress }) {
  const t = useT();
  if (typeof document === "undefined") return null;
  const pct =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="carousel-export-title"
    >
      <div className={styles.box}>
        <h2 id="carousel-export-title" className={styles.title}>
          {t("editor.exportProgress.title")}
        </h2>
        <div
          className={styles.counter}
          role="status"
          aria-live="polite"
          data-testid="export-progress-counter"
        >
          {t("editor.exportProgress.counter", {
            done: progress.done,
            total: progress.total,
          })}
        </div>
        <div
          className={styles.track}
          role="progressbar"
          aria-valuenow={progress.done}
          aria-valuemin={0}
          aria-valuemax={progress.total}
        >
          <div className={styles.fill} style={{ width: `${pct}%` }} />
        </div>
        <p className={styles.hint}>{t("editor.exportProgress.hint")}</p>
      </div>
    </div>,
    document.body,
  );
}
