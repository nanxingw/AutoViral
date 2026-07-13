import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useSettingsPanelStore } from "@/stores/settings";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import { useConfig, useSaveConfig, type AppConfig, type SecretMetaEntry } from "@/queries/config";
import { IconButton } from "@/ui/IconButton";
import { XIcon } from "@/ui/icons";
import styles from "./SettingsPanel.module.css";

const EDITABLE_KEYS = [
  "openrouterKey",
  "model",
] as const satisfies readonly (keyof AppConfig)[];

interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  showLabel: string;
  hideLabel: string;
  /**
   * R109 F475 — server never returns the plaintext secret; instead it
   * reports whether one is stored and the last-4 chars for visual
   * confirmation. When meta.set is true and the draft value is still
   * empty, we render "Currently stored ····AKLT" hint plus a placeholder
   * prompting "leave blank to keep · type to replace."
   */
  meta?: SecretMetaEntry;
  storedHintTemplate: string; // e.g. "Currently stored · ····{tail}"
  keepBlankPlaceholder: string; // e.g. "Leave blank to keep · type to replace"
}
function SecretField({ label, value, onChange, showLabel, hideLabel, meta, storedHintTemplate, keepBlankPlaceholder }: SecretFieldProps) {
  const [shown, setShown] = useState(false);
  const reactId = useId();
  const id = `secret-${reactId}`;
  const hasStored = !!meta?.set;
  const tail = meta?.lastFour ?? "";
  // Function replacer so a secret's last-4 chars containing $&/$$/$`/$' render
  // verbatim — String.prototype.replace treats those as special patterns in a
  // string replacement (same class as bug B7).
  const storedHint = hasStored ? storedHintTemplate.replace("{tail}", () => tail) : "";
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>{label}</label>
      <div className={styles.fieldRow}>
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={hasStored ? keepBlankPlaceholder : undefined}
          className={styles.input}
        />
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? hideLabel : showLabel}
        </button>
      </div>
      {storedHint && (
        <p className={styles.sectionHint} style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 11 }} data-testid="secret-stored-hint">
          {storedHint}
        </p>
      )}
    </div>
  );
}

export function SettingsPanel() {
  const open = useSettingsPanelStore((s) => s.open);
  const closePanel = useSettingsPanelStore((s) => s.closePanel);
  const focusSection = useSettingsPanelStore((s) => s.focusSection);
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // R126 F608 — the JS scroll-behavior option is independent of the CSS
  // `prefers-reduced-motion` @media rule (M223), so we read PRM at runtime
  // and force the non-animated fallback when the user has asked for reduced
  // motion. Vestibular-sensitive users opening the panel via the Analytics
  // §2 deep-link would otherwise see a sudden smooth scroll.
  const prefersReducedMotion = useReducedMotion();
  const { data: config } = useConfig();
  const saveMut = useSaveConfig();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [showUnsaved, setShowUnsaved] = useState(false);

  useModalFocus(open, panelRef);

  // Seed draft when config loads / panel opens; reset on close
  useEffect(() => {
    if (open && config && !draft) setDraft({ ...config });
    if (!open) {
      setDraft(null);
      setShowUnsaved(false);
    }
  }, [open, config, draft]);

  // Scroll to requested section when panel opens with focusSection (Analytics §2 deep-link)
  useEffect(() => {
    if (!open || !focusSection || !draft) return;
    const el = panelRef.current?.querySelector(`[data-section="${focusSection}"]`);
    if (el) {
      el.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    }
  }, [open, focusSection, draft, prefersReducedMotion]);

  const patch = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [k]: v });
  };

  const isDirty = !!config && !!draft && EDITABLE_KEYS.some((k) => draft[k] !== config[k]);

  const requestClose = () => {
    if (isDirty) setShowUnsaved(true);
    else closePanel();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDirty) setShowUnsaved(true);
        else closePanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel, isDirty]);

  if (!open) return null;

  return (
    <>
    <div
      className={styles.backdrop}
      data-testid="settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        ref={panelRef}
      >
        <header className={styles.header}>
          <h2>{t("settings.title")}</h2>
          <IconButton
            className={styles.closeBtn}
            aria-label={t("settings.close")}
            onClick={requestClose}
          >
            <XIcon />
          </IconButton>
        </header>
        <div className={styles.body}>
          {draft ? (
            <>
              <section data-section="openrouter">
                <h3 className={styles.sectionLabel}>{t("settings.section.openrouter")}</h3>
                <p className={styles.sectionHint}>{t("settings.sectionHint.openrouter")}</p>
                <SecretField
                  label={t("settings.field.apiKey")}
                  value={draft.openrouterKey}
                  onChange={(v) => patch("openrouterKey", v)}
                  showLabel={t("settings.show")}
                  hideLabel={t("settings.hide")}
                  meta={draft.secretMeta.openrouterKey}
                  storedHintTemplate={t("settings.field.secretStoredHint")}
                  keepBlankPlaceholder={t("settings.field.secretKeepBlank")}
                />
              </section>

              <section data-section="model">
                <h3 className={styles.sectionLabel}>{t("settings.section.model")}</h3>
                <p className={styles.sectionHint}>{t("settings.sectionHint.model")}</p>
                <div className={styles.field}>
                  <label htmlFor="default-model" className={styles.fieldLabel}>{t("settings.section.model")}</label>
                  <select
                    id="default-model"
                    className={styles.input}
                    value={draft.model}
                    onChange={(e) => patch("model", e.target.value)}
                    aria-label={t("settings.section.model")}
                    aria-describedby="default-model-note"
                  >
                    {/* e2e-report F143: surface concrete version after alias so
                        users know which Claude tier maps to which model line.
                        Versions kept inline (not hover-tooltip) because native
                        <option> title is unreliable across Safari/Chrome. */}
                    <option value="fable">{t("settings.field.modelOptionFable")}</option>
                    <option value="opus">{t("settings.field.modelOptionOpus")}</option>
                    <option value="sonnet">{t("settings.field.modelOptionSonnet")}</option>
                    <option value="haiku">{t("settings.field.modelOptionHaiku")}</option>
                  </select>
                  <p id="default-model-note" className={styles.sectionHint} style={{ marginTop: 4 }}>
                    {t("settings.field.modelAliasNote")}
                  </p>
                </div>
              </section>
            </>
          ) : (
            <div>{t("common.loading")}</div>
          )}
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.btnGhost} onClick={requestClose}>
            {t("settings.cancel")}
          </button>
          {/* e2e-report F142: visible dirty indicator. Old UX relied on a 0.5→1
              opacity flick when the Save button enabled — too subtle to notice.
              Pulse dot + UNSAVED label makes the state machine unmistakable. */}
          {isDirty && !saveMut.isPending && (
            <span className={styles.dirtyIndicator} data-testid="settings-dirty" aria-live="polite">
              <span className={styles.dirtyDot} aria-hidden />
              {t("settings.dirtyIndicator")}
            </span>
          )}
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={!isDirty || saveMut.isPending}
            onClick={() => {
              if (!draft) return;
              saveMut.mutate(
                Object.fromEntries(EDITABLE_KEYS.map((k) => [k, draft[k]])) as Parameters<typeof saveMut.mutate>[0],
                { onSuccess: () => closePanel() },
              );
            }}
          >
            {saveMut.isPending ? "…" : t("settings.save")}
          </button>
        </footer>
        {saveMut.isError && (
          <div className={styles.saveError} role="alert">
            {t("settings.saveError")}
          </div>
        )}
      </div>
    </div>
    {showUnsaved && (
      <div className={styles.confirmBackdrop} onClick={() => setShowUnsaved(false)}>
        <div
          className={styles.confirmBox}
          role="alertdialog"
          aria-labelledby="unsaved-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="unsaved-title">{t("settings.unsavedTitle")}</h3>
          <p>{t("settings.unsavedBody")}</p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setShowUnsaved(false)}
            >
              {t("settings.cancel")}
            </button>
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => {
                setShowUnsaved(false);
                closePanel();
              }}
            >
              {t("settings.unsavedConfirm")}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
