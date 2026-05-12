import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateWork } from "@/queries/works";
import { useT } from "@/i18n/useT";
import { localizeApiError } from "@/i18n/serverError";
import styles from "./NewWorkCard.module.css";

export function NewWorkCard() {
  const navigate = useNavigate();
  const create = useCreateWork();
  const t = useT();
  // R21: surface mutation failures + lock buttons during request. Previously
  // a server-side failure left the user staring at an unchanged card with no
  // feedback — and clicking again would queue a parallel POST. Both fixed.
  const [createError, setCreateError] = useState<string | null>(null);
  // R101 F406 — give the user a place to name the work before commit.
  // Empty input falls back to the localized "Untitled" so the existing
  // direct-click path stays one click.
  const [pendingTitle, setPendingTitle] = useState("");
  // R101 F414 — Tier 2 race protection. `create.isPending` is a hook value
  // that only refreshes on the next render, so three back-to-back
  // synchronous .click() calls all read the stale `false` and fire three
  // POSTs (M152 verify proved 3/3 leaked). useRef writes are synchronous
  // and immediately visible, which is what we need to block re-entry
  // before React has a chance to flush. `navigating` (useState) drives
  // the disabled visual; lockRef does the actual guarding.
  const lockRef = useRef(false);
  const [navigating, setNavigating] = useState(false);

  async function pick(type: "short-video" | "image-text") {
    if (lockRef.current) return;
    lockRef.current = true;
    setNavigating(true);
    setCreateError(null);
    const title = pendingTitle.trim() || t("works.untitledWork");
    try {
      const w = await create.mutateAsync({ title, type });
      navigate(type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`);
      // lock stays held — the component unmounts on navigate.
    } catch (err: unknown) {
      // R27: prefer the localized server-error path (errorCode → i18n key)
      // over raw err.message; falls back automatically for unmapped codes.
      const msg = localizeApiError(err, t);
      setCreateError(t("works.createFailed", { msg }));
      // Failure unwinds the lock so the user can correct and retry.
      lockRef.current = false;
      setNavigating(false);
    }
  }

  const locked = create.isPending || navigating;

  return (
    <div className={styles.card}>
      <div className={styles.title}>+ {t("works.newWork")}</div>
      <input
        type="text"
        value={pendingTitle}
        onChange={(e) => setPendingTitle(e.target.value)}
        placeholder={t("works.newWorkTitlePlaceholder")}
        aria-label={t("works.newWorkTitleAria")}
        disabled={locked}
        maxLength={120}
        className={styles.titleInput}
        data-bare
      />
      <div className={styles.options}>
        <button
          type="button"
          className={styles.opt}
          onClick={() => {
            void pick("short-video");
          }}
          disabled={locked}
          style={locked ? { opacity: 0.5, cursor: "wait" } : undefined}
        >
          <div className={styles.ico}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </div>
          <div className={styles.lbl}>{t("works.type.video")}</div>
          <div className={styles.sub}>{t("works.type.videoSub")}</div>
        </button>
        <button
          type="button"
          className={styles.opt}
          onClick={() => {
            void pick("image-text");
          }}
          disabled={locked}
          style={locked ? { opacity: 0.5, cursor: "wait" } : undefined}
        >
          <div className={styles.ico}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <div className={styles.lbl}>{t("works.type.image")}</div>
          <div className={styles.sub}>{t("works.type.imageSub")}</div>
        </button>
      </div>
      {locked && (
        <div
          aria-live="polite"
          style={{
            marginTop: 6,
            padding: "4px 12px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            color: "var(--text-dimmer)",
          }}
        >
          {t("works.creatingLabel")}
        </div>
      )}
      {createError && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--status-error, #d4756c)",
            background: "rgba(212, 117, 108, 0.08)",
            color: "var(--status-error, #d4756c)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {createError}
        </div>
      )}
    </div>
  );
}
