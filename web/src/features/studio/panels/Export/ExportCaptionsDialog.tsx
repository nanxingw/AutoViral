// Phase H (issue #35) — modal that hosts the CaptionTracksSection so
// users can pick burn/sidecar before triggering an export. Opens from
// the TopBar's More-export-options dropdown.
//
// Owns its own selection state (seeded from the composition's text tracks
// via defaultCaptionSelection). Click Export to dispatch the render with
// the user's choices folded into EnqueueRenderOptions.captionTracks.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CaptionTracksSection,
  defaultCaptionSelection,
  type CaptionSelection,
  type CaptionTrackOption,
} from "./CaptionTracksSection";
import styles from "./ExportCaptionsDialog.module.css";

export interface ExportCaptionsDialogProps {
  tracks: CaptionTrackOption[];
  onCancel: () => void;
  onExport: (selection: CaptionSelection) => void;
}

export function ExportCaptionsDialog({
  tracks,
  onCancel,
  onExport,
}: ExportCaptionsDialogProps) {
  const initial = useMemo(() => defaultCaptionSelection(tracks), [tracks]);
  const [selection, setSelection] = useState<CaptionSelection>(initial);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Portal to <body> so the backdrop's `position: fixed` escapes any
  // ancestor that establishes a containing block (e.g. the studio
  // `.glass` shell uses `backdrop-filter`, which per CSS Containment
  // spec creates a containing block for fixed descendants and would
  // otherwise pin the modal inside the 54px-tall TopBar).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="export-captions-title">
      <div className={styles.box}>
        <h2 id="export-captions-title" className={styles.title}>
          Export with captions
        </h2>
        <CaptionTracksSection
          tracks={tracks}
          selection={selection}
          onSelectionChange={setSelection}
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => onExport(selection)}
          >
            Export
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
