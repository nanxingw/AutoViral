import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateWork } from "@/queries/works";
import { useT, type MessageKey } from "@/i18n/useT";
import { localizeApiError } from "@/i18n/serverError";
import {
  listContentTypes,
  getContentType,
  type WorkType,
} from "@shared/content-types/registry";
import styles from "./NewWorkCard.module.css";

// I06 / ADR-006 — the create buttons now iterate the content-type registry.
// Per-type PRESENTATION (icon + sub-label) is web-only and stays out of the
// pure shared manifest (Decision #4: manifest carries data + i18n keys, not
// React). This small local table keys off the registry's WorkType so adding a
// type means a registry entry + one row here, not a new hand-wired button.
const TYPE_ICONS: Record<WorkType, ReactNode> = {
  "short-video": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  ),
  "image-text": (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
};
const TYPE_SUB_KEYS: Record<WorkType, MessageKey> = {
  "short-video": "works.type.videoSub",
  "image-text": "works.type.imageSub",
};

export function NewWorkCard() {
  const navigate = useNavigate();
  const create = useCreateWork();
  const t = useT();
  // R21: surface mutation failures + lock buttons during request. Previously
  // a server-side failure left the user staring at an unchanged card with no
  // feedback — and clicking again would queue a parallel POST. Both fixed.
  const [createError, setCreateError] = useState<string | null>(null);
  // R101 F406 — give the user a place to name the work before commit.
  // #83 — empty input stays an EMPTY title; WorksGrid localizes the
  // "未命名/Untitled" placeholder at render time. Baking `t(...)` here froze
  // the title's language to creation-time locale (an EN-created blank work
  // showed "Untitled" forever even in ZH).
  const [pendingTitle, setPendingTitle] = useState("");
  // #65 — optional creative brief / 选题方向. Drives the agent's research +
  // output server-side (work.topicHint); empty stays undefined so the server
  // falls back to title as before.
  const [pendingHint, setPendingHint] = useState("");
  // R101 F414 — Tier 2 race protection. `create.isPending` is a hook value
  // that only refreshes on the next render, so three back-to-back
  // synchronous .click() calls all read the stale `false` and fire three
  // POSTs (M152 verify proved 3/3 leaked). useRef writes are synchronous
  // and immediately visible, which is what we need to block re-entry
  // before React has a chance to flush. `navigating` (useState) drives
  // the disabled visual; lockRef does the actual guarding.
  const lockRef = useRef(false);
  const [navigating, setNavigating] = useState(false);

  async function pick(type: WorkType) {
    if (lockRef.current) return;
    lockRef.current = true;
    setNavigating(true);
    setCreateError(null);
    const title = pendingTitle.trim();
    const topicHint = pendingHint.trim() || undefined;
    try {
      const w = await create.mutateAsync({ title, type, topicHint });
      navigate(getContentType(type).routePath(w.id));
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
      <input
        type="text"
        value={pendingHint}
        onChange={(e) => setPendingHint(e.target.value)}
        placeholder={t("works.topicHintPlaceholder")}
        aria-label={t("works.topicHintAria")}
        disabled={locked}
        maxLength={280}
        className={styles.titleInput}
        data-bare
      />
      <div className={styles.options}>
        {listContentTypes().map((ct) => (
          <button
            key={ct.id}
            type="button"
            className={styles.opt}
            onClick={() => {
              void pick(ct.id);
            }}
            disabled={locked}
            style={locked ? { opacity: 0.5, cursor: "wait" } : undefined}
          >
            <div className={styles.ico}>{TYPE_ICONS[ct.id]}</div>
            <div className={styles.lbl}>{t(ct.labelKey as MessageKey)}</div>
            <div className={styles.sub}>{t(TYPE_SUB_KEYS[ct.id])}</div>
          </button>
        ))}
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
