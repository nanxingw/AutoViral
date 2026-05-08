import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateWork } from "@/queries/works";
import { useT } from "@/i18n/useT";
import styles from "./NewWorkCard.module.css";

export function NewWorkCard() {
  const navigate = useNavigate();
  const create = useCreateWork();
  const t = useT();
  // R21: surface mutation failures + lock buttons during request. Previously
  // a server-side failure left the user staring at an unchanged card with no
  // feedback — and clicking again would queue a parallel POST. Both fixed.
  const [createError, setCreateError] = useState<string | null>(null);

  async function pick(type: "short-video" | "image-text") {
    if (create.isPending) return; // ignore spam-clicks during request
    setCreateError(null);
    try {
      const w = await create.mutateAsync({ title: t("works.untitledWork"), type });
      navigate(type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(t("works.createFailed", { msg }));
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.title}>+ {t("works.newWork")}</div>
      <div className={styles.options}>
        <button
          type="button"
          className={styles.opt}
          onClick={() => {
            void pick("short-video");
          }}
          disabled={create.isPending}
          style={create.isPending ? { opacity: 0.5, cursor: "wait" } : undefined}
        >
          <div className={styles.ico}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </div>
          <div className={styles.lbl}>{t("works.type.video")}</div>
          <div className={styles.sub}>SHORT VIDEO · 9:16</div>
        </button>
        <button
          type="button"
          className={styles.opt}
          onClick={() => {
            void pick("image-text");
          }}
          disabled={create.isPending}
          style={create.isPending ? { opacity: 0.5, cursor: "wait" } : undefined}
        >
          <div className={styles.ico}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <div className={styles.lbl}>{t("works.type.image")}</div>
          <div className={styles.sub}>CAROUSEL · 4:5</div>
        </button>
      </div>
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
