import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import type { AssetItem } from "@/queries/assets";

interface Props {
  /** The asset pending deletion. null = dialog closed. */
  asset: AssetItem | null;
  /** How many timeline clips reference this asset (0 = none). */
  referencedClipCount: number;
  /** True while the DELETE request is in flight (disables Confirm). */
  deleting: boolean;
  /** Localized error string to surface, or null. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * I18 (PRD-0003 §3.2) — two-step confirm before deleting a library asset's
 * file. Opening the dialog is step one; the explicit Confirm button is step
 * two (no global Delete key — it would clash with text inputs / the timeline
 * keymap, per the issue). When the asset is referenced by N clips the body
 * warns that those clips will also be removed (WARN-then-cascade policy), so
 * the user is never surprised by a silently-broken timeline.
 *
 * Mirrors TimelineTrackHeader's role="alertdialog" portal confirm and reuses
 * useModalFocus (R41) + ESC-to-cancel like AssetPreviewModal.
 */
export function DeleteAssetConfirm({
  asset,
  referencedClipCount,
  deleting,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const open = asset !== null;
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, deleting, onCancel]);

  if (!open || !asset) return null;

  return createPortal(
    <div
      data-testid="asset-delete-backdrop"
      onClick={deleting ? undefined : onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 11, 15, 0.78)",
        backdropFilter: "blur(8px)",
        zIndex: 1100,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="asset-delete-title"
        aria-describedby="asset-delete-body"
        style={{
          width: "min(92vw, 420px)",
          background: "var(--surface-1)",
          border: "1px solid var(--glass-border)",
          borderRadius: 14,
          padding: 20,
          boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
        }}
      >
        <h3
          id="asset-delete-title"
          style={{
            margin: "0 0 8px",
            fontFamily: "var(--font-editorial)",
            fontStyle: "italic",
            fontSize: 18,
            letterSpacing: "-0.015em",
            color: "var(--text)",
          }}
        >
          {t("studio.assetDelete.title")}
        </h3>
        <p
          id="asset-delete-body"
          style={{
            margin: "0 0 6px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--text-dim)",
          }}
        >
          {referencedClipCount > 0
            ? t("studio.assetDelete.bodyReferenced", {
                name: asset.name,
                count: referencedClipCount,
              })
            : t("studio.assetDelete.body", { name: asset.name })}
        </p>
        {error && (
          <p
            role="alert"
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.04em",
              color: "var(--status-error, #d4756c)",
            }}
          >
            {error}
          </p>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            autoFocus
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 7,
              border: "1px solid var(--glass-border)",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: deleting ? "not-allowed" : "pointer",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              opacity: deleting ? 0.5 : 1,
            }}
          >
            {t("studio.assetDelete.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            data-testid="asset-delete-confirm"
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 7,
              border: "1px solid var(--status-error, #d4756c)",
              background: "rgba(212, 117, 108, 0.12)",
              color: "var(--status-error, #d4756c)",
              cursor: deleting ? "wait" : "pointer",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting
              ? t("studio.assetDelete.deleting")
              : referencedClipCount > 0
                ? t("studio.assetDelete.confirmReferenced")
                : t("studio.assetDelete.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
