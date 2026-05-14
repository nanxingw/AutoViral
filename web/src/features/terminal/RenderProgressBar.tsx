// Phase 5 Task 5.2 — render progress strip surfaced from bridge events.
//
// Subscribes to the `autoviral:ui-render-progress` window CustomEvent
// dispatched by useBridgeEvents (which itself receives ui-render-progress
// frames from the bridge WebSocket). Shows the current pipeline stage
// (render / duck / loudnorm / burn / encode) with an accent gradient fill
// bar; auto-hides 2 seconds after `stage=encode pct=1` arrives.
//
// We use a window event rather than a zustand store to keep render
// progress firmly outside persistent app state — it's a *signal stream*,
// not a piece of model data.

import { useEffect, useRef, useState } from "react";
import styles from "./RenderProgressBar.module.css";

export interface RenderProgressDetail {
  stage: string;
  pct?: number;
}

const KNOWN_STAGES = new Set(["render", "duck", "loudnorm", "burn", "encode"]);

export function RenderProgressBar() {
  const [state, setState] = useState<RenderProgressDetail | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    function onProgress(e: Event) {
      const detail = (e as CustomEvent<RenderProgressDetail>).detail;
      if (!detail || typeof detail.stage !== "string") return;
      // Cancel any pending hide so re-entry resets the auto-dismiss
      // window. (Render → duck → encode is a multi-stage flow; only
      // a final `encode pct=1` should trigger the 2s fade.)
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setState(detail);
      // Auto-hide 2s after the terminal "encode 100%" signal.
      if (detail.stage === "encode" && (detail.pct ?? 0) >= 0.999) {
        hideTimer.current = window.setTimeout(() => {
          setState(null);
          hideTimer.current = null;
        }, 2000);
      }
    }
    window.addEventListener("autoviral:ui-render-progress", onProgress);
    return () => {
      window.removeEventListener("autoviral:ui-render-progress", onProgress);
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
  }, []);

  if (!state) return null;

  const pct = Math.max(0, Math.min(1, state.pct ?? 0));
  const pctPercent = `${Math.round(pct * 100)}%`;
  const stageLabel = KNOWN_STAGES.has(state.stage) ? state.stage : state.stage;

  return (
    <div
      className={styles.bar}
      role="status"
      aria-live="polite"
      aria-label={`render progress ${stageLabel} ${pctPercent}`}
      style={{ ["--pct" as string]: pctPercent } as React.CSSProperties}
      data-stage={state.stage}
      data-testid="render-progress-bar"
    >
      <div className={styles.fill} aria-hidden="true" />
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.stage}>{stageLabel}</span>
      <span className={styles.pct}>{pctPercent}</span>
    </div>
  );
}
