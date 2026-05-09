import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import type { AssetItem } from "@/queries/assets";

interface Props {
  asset: AssetItem | null;
  onClose: () => void;
}

/**
 * R43 — large-format preview for sidebar assets. Pre-fix, the asset tile
 * was a 144×256 dead-end: hover triggered muted autoplay (video) or did
 * nothing (audio/image). User feedback (2026-05-09):
 *   "右侧的素材只能预览，不能放大进一步查看，音频素材也无法播放"
 *
 * This modal:
 *   - image  → fit-to-viewport <img> (object-fit: contain)
 *   - video  → full <video controls> with audio (the sidebar tile mutes)
 *   - audio  → <audio controls> + filename + duration via metadata
 *   - text/other → metadata card with link (no inline preview yet)
 *
 * ESC + backdrop click both close. Reuses useModalFocus (R41) for
 * keyboard focus management — same pattern as ReframeConfirmDialog and
 * ExportProgress.
 */
export function AssetPreviewModal({ asset, onClose }: Props) {
  const open = asset !== null;
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && asset && (
        <motion.div
          key="asset-preview-backdrop"
          data-testid="asset-preview-backdrop"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10, 11, 15, 0.85)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
          }}
        >
          <motion.div
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-preview-title"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            style={{
              maxWidth: "min(92vw, 1200px)",
              maxHeight: "min(92vh, 800px)",
              minWidth: 320,
              background: "var(--surface-1)",
              border: "1px solid var(--glass-border)",
              borderRadius: 16,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
            }}
          >
            <header
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--divider)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2
                  id="asset-preview-title"
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-editorial)",
                    fontStyle: "italic",
                    fontSize: 18,
                    letterSpacing: "-0.015em",
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={asset.name}
                >
                  {asset.name}
                </h2>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dimmer)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    marginTop: 2,
                  }}
                >
                  {asset.kind} · {asset.ext}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("studio.assetPreview.btnClose")}
                data-bare
                style={{
                  width: 28,
                  height: 28,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 6,
                  border: "1px solid var(--glass-border)",
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </header>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                // R47 — must be `hidden`, not `auto`. Combined with the
                // `display: grid + placeItems: center` we used here
                // before, portrait 1080×1920 images blew past the modal's
                // 706-px content height because CSS grid resolves
                // `max-height: 100%` against an auto-sized track (which
                // sizes to image natural height). flex avoids that
                // because the flex container's content box is the
                // resolution target, not the auto track.
                overflow: "hidden",
                background: "var(--surface-0)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: asset.kind === "audio" ? 32 : 0,
              }}
            >
              {asset.kind === "image" && (
                <img
                  src={asset.url}
                  alt={asset.name}
                  style={{
                    // R47-fix2 — earlier attempt used max-height: 100% on a
                    // flex child, but flex resolves percentages against a
                    // *definite* parent height. Our modal only has
                    // max-height (no explicit height), so 100% degraded
                    // to the image's natural height and the image got
                    // cropped by the parent overflow:hidden. Switch to
                    // viewport units directly on the image — this
                    // resolves against the viewport, not the flex
                    // hierarchy, so portrait + landscape both fit.
                    maxWidth: "min(88vw, 1100px)",
                    // 92vh - ~100px (header + footer + borders) buffer so
                    // the image clears the surrounding chrome.
                    maxHeight: "min(82vh, 700px)",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              )}
              {asset.kind === "video" && (
                <video
                  src={asset.url}
                  controls
                  autoPlay
                  playsInline
                  // NOT muted — this is the explicit "preview" view; user
                  // wants to hear the audio. Sidebar tile remains muted.
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    background: "black",
                  }}
                />
              )}
              {asset.kind === "audio" && (
                <div
                  style={{
                    width: "100%",
                    maxWidth: 520,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    alignItems: "center",
                  }}
                >
                  <svg
                    width="64"
                    height="64"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.4"
                    aria-hidden
                  >
                    <polygon points="12 6 7 11 3 11 3 13 7 13 12 18 12 6" fill="var(--accent)" />
                    <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" />
                  </svg>
                  <audio
                    src={asset.url}
                    controls
                    autoPlay
                    style={{ width: "100%" }}
                  />
                </div>
              )}
              {(asset.kind === "text" || asset.kind === "other") && (
                <div
                  style={{
                    padding: 32,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--text-dim)",
                    textAlign: "center",
                    lineHeight: 1.6,
                  }}
                >
                  {t("studio.assetPreview.noInlinePreview")}
                  <br />
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--accent-hi)",
                      textDecoration: "underline",
                      marginTop: 12,
                      display: "inline-block",
                    }}
                  >
                    {t("studio.assetPreview.openInTab")}
                  </a>
                </div>
              )}
            </div>

            <footer
              style={{
                padding: "10px 16px",
                borderTop: "1px solid var(--divider)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dimmer)",
                letterSpacing: "0.04em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={asset.path}
            >
              {asset.path}
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
