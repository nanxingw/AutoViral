import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Markdown } from "@/features/chat/Markdown";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import { useScript } from "../../scriptStore";
import { saveScript } from "../../services/script";
import { ApiError } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// A4 (PRD-0010) — full-screen 剧本 reader/editor.
//
// The inline sidebar ScriptEditor is a cramped ~140px box; a full narrative is
// unreadable there. This modal opens a ~720px editorial reading column at
// 15–16px so the whole script reads like a page, with the SAME edit/preview
// toggle as the panel.
//
// PORTAL TO BODY (reference_backdrop_filter_portal_trap): the sidebar's glass
// ancestors set `backdrop-filter`, which turns them into the containing block
// for `position: fixed`. A fixed overlay rendered inside that subtree would be
// positioned against the glass box, not the viewport, and mis-place. So — like
// the sibling AssetPreviewModal — we `createPortal` the overlay onto
// `document.body`.
//
// SHARED STATE + WRITE PATH: the modal reads the same `useScript` store and
// commits on blur through the SAME `saveScript` service the agent's
// `autoviral script edit` CLI uses (ADR-009 agent-人一致). Because the store is a
// single global instance, a save here reflows the inline panel preview instantly
// — no prop drilling, no second load.
// ─────────────────────────────────────────────────────────────────────────────

// The modal remembers its own edit/preview choice under one global key (a UI
// preference, not work data — mirrors the inline editor's SCRIPT_MODE_KEY but
// kept separate so the two surfaces don't fight over one value).
const SCRIPT_MODAL_MODE_KEY = "autoviral.scriptModal.mode";
function readModalMode(): "edit" | "preview" | null {
  try {
    const v = localStorage.getItem(SCRIPT_MODAL_MODE_KEY);
    return v === "edit" || v === "preview" ? v : null;
  } catch {
    return null;
  }
}

export function ScriptModal({
  open,
  workId,
  onClose,
}: {
  open: boolean;
  workId: string;
  onClose: () => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialogRef);

  const script = useScript((s) => s.script);
  const loaded = useScript((s) => s.loaded);
  const storeWorkId = useScript((s) => s.workId);
  const setScript = useScript((s) => s.setScript);

  // TENANCY GUARD (mirrors ScriptEditor): the store is one global instance — the
  // held script is OURS only when stamped with our workId AND a load resolved.
  const isMine = storeWorkId === workId && loaded;
  const hasContent = isMine && script.trim() !== "";

  const [manualMode, setManualMode] = useState<"edit" | "preview" | null>(
    readModalMode,
  );
  const setMode = useCallback((next: "edit" | "preview") => {
    setManualMode(next);
    try {
      localStorage.setItem(SCRIPT_MODAL_MODE_KEY, next);
    } catch {
      /* ignore quota / disabled storage */
    }
  }, []);
  const mode: "edit" | "preview" =
    manualMode ?? (hasContent ? "preview" : "edit");

  const [saveError, setSaveError] = useState<string | null>(null);
  // Same commit contract as the inline ScriptEditor: gate on tenancy + loaded,
  // skip unchanged writes, optimistic setScript then persist via saveScript.
  const commit = useCallback(
    async (next: string) => {
      const st = useScript.getState();
      if (st.workId !== workId || !st.loaded) return;
      if (next === st.script) return; // unchanged — no needless write
      setSaveError(null);
      setScript(workId, next);
      try {
        await saveScript(workId, next);
      } catch (err) {
        setSaveError(errorMessage(err));
      }
    },
    [workId, setScript],
  );

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
      {open && (
        <motion.div
          key="script-modal-backdrop"
          data-testid="script-modal-backdrop"
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
            padding: 24,
          }}
        >
          <motion.div
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="script-modal-title"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            style={{
              width: "min(94vw, 960px)",
              height: "min(92vh, 900px)",
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
                flexShrink: 0,
              }}
            >
              <h2
                id="script-modal-title"
                style={{
                  margin: 0,
                  fontFamily: "var(--font-editorial)",
                  fontStyle: "italic",
                  fontSize: 18,
                  letterSpacing: "-0.015em",
                  color: "var(--text)",
                }}
              >
                {t("studio.scriptPanel.scriptHeading")}
              </h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  <ModeButton
                    active={mode === "edit"}
                    onClick={() => setMode("edit")}
                  >
                    {t("studio.scriptPanel.scriptModeEdit")}
                  </ModeButton>
                  <ModeButton
                    active={mode === "preview"}
                    onClick={() => setMode("preview")}
                  >
                    {t("studio.scriptPanel.scriptModePreview")}
                  </ModeButton>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("studio.scriptPanel.scriptModalCloseAria")}
                  title={t("studio.scriptPanel.scriptModalCloseAria")}
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
                  }}
                >
                  ×
                </button>
              </div>
            </header>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                background: "var(--surface-0)",
                padding: "28px 24px",
              }}
            >
              {mode === "edit" ? (
                <div style={{ maxWidth: 720, margin: "0 auto", height: "100%" }}>
                  <ModalTextarea
                    key={workId}
                    value={isMine ? script : ""}
                    loaded={isMine}
                    ariaLabel={t("studio.scriptPanel.editScriptAria")}
                    placeholder={t("studio.scriptPanel.scriptPlaceholder")}
                    onCommit={commit}
                  />
                </div>
              ) : (
                <div
                  data-testid="script-modal-reader"
                  aria-label={t("studio.scriptPanel.scriptPreviewAria")}
                  // ~720px editorial reading column at 15.5px (A4 acceptance):
                  // reuse the global `.md-bubble` typography, centered.
                  className="md-bubble"
                  style={{
                    maxWidth: 720,
                    margin: "0 auto",
                    fontSize: 15.5,
                    lineHeight: 1.75,
                    color: "var(--text)",
                  }}
                >
                  {!isMine || script.trim() === "" ? (
                    <span
                      style={{ fontStyle: "italic", color: "var(--text-dimmer)" }}
                    >
                      {t("studio.scriptPanel.scriptEmptyPreview")}
                    </span>
                  ) : (
                    <Markdown text={script} workId={workId} />
                  )}
                </div>
              )}

              {saveError && (
                <div
                  role="alert"
                  style={{
                    maxWidth: 720,
                    margin: "8px auto 0",
                    fontSize: 12,
                    lineHeight: 1.4,
                    color: "var(--status-error, #d4756c)",
                  }}
                >
                  {t("studio.scriptPanel.scriptSaveFailed", { msg: saveError })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// Locally-controlled markdown textarea (fills the modal). Seeds from `value`;
// commits on blur. Reflows to a fresh `value` (a refetchScript landing) ONLY
// when not focused — same contract as the inline ScriptTextarea.
function ModalTextarea({
  value,
  loaded,
  ariaLabel,
  placeholder,
  onCommit,
}: {
  value: string;
  loaded: boolean;
  ariaLabel: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      readOnly={!loaded}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        onCommit(draft);
      }}
      style={{
        width: "100%",
        height: "100%",
        minHeight: 320,
        background: "transparent",
        border: "1px solid var(--glass-border)",
        borderRadius: 8,
        color: "var(--text)",
        padding: "16px 18px",
        fontFamily: "var(--font-mono)",
        fontSize: 14,
        lineHeight: 1.7,
        resize: "none",
      }}
    />
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-bare
      onClick={onClick}
      style={{
        padding: "2px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.04em",
        background: "transparent",
        border: "1px solid var(--glass-border)",
        borderRadius: 6,
        color: active ? "var(--accent-hi)" : "var(--text-dimmer)",
        borderColor: active ? "var(--accent)" : "var(--glass-border)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// Pull the server's localized/raw error out of an ApiError body, falling back
// to the Error message / string form (mirrors ScriptTab.errorMessage).
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { error?: string } | undefined;
    return b?.error ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
