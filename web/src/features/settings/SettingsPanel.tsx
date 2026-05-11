import { useEffect, useId, useRef, useState } from "react";
import { useSettingsPanelStore } from "@/stores/settings";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import { useConfig, useRefreshAnalytics, useSaveConfig, type AppConfig } from "@/queries/config";
import styles from "./SettingsPanel.module.css";

const EDITABLE_KEYS = [
  "jimengAccessKey",
  "jimengSecretKey",
  "openrouterKey",
  "douyinUrl",
  "researchEnabled",
  "researchCron",
  "model",
] as const satisfies readonly (keyof AppConfig)[];

interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  showLabel: string;
  hideLabel: string;
}
function SecretField({ label, value, onChange, showLabel, hideLabel }: SecretFieldProps) {
  const [shown, setShown] = useState(false);
  const reactId = useId();
  const id = `secret-${reactId}`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>{label}</label>
      <div className={styles.fieldRow}>
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
    </div>
  );
}

export function SettingsPanel() {
  const open = useSettingsPanelStore((s) => s.open);
  const closePanel = useSettingsPanelStore((s) => s.closePanel);
  const focusSection = useSettingsPanelStore((s) => s.focusSection);
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { data: config } = useConfig();
  const refreshMut = useRefreshAnalytics();
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
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open, focusSection, draft]);

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
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={t("settings.close")}
            onClick={requestClose}
          >
            ×
          </button>
        </header>
        <div className={styles.body}>
          {draft ? (
            <>
              <section data-section="jimeng">
                <h3 className={styles.sectionLabel}>{t("settings.section.jimeng")}</h3>
                <SecretField
                  label={t("settings.field.accessKey")}
                  value={draft.jimengAccessKey}
                  onChange={(v) => patch("jimengAccessKey", v)}
                  showLabel={t("settings.show")}
                  hideLabel={t("settings.hide")}
                />
                <SecretField
                  label={t("settings.field.secretKey")}
                  value={draft.jimengSecretKey}
                  onChange={(v) => patch("jimengSecretKey", v)}
                  showLabel={t("settings.show")}
                  hideLabel={t("settings.hide")}
                />
              </section>

              <section data-section="openrouter">
                <h3 className={styles.sectionLabel}>{t("settings.section.openrouter")}</h3>
                <SecretField
                  label={t("settings.field.apiKey")}
                  value={draft.openrouterKey}
                  onChange={(v) => patch("openrouterKey", v)}
                  showLabel={t("settings.show")}
                  hideLabel={t("settings.hide")}
                />
              </section>

              <section data-section="research">
                <h3 className={styles.sectionLabel}>{t("settings.section.research")}</h3>
                <div className={styles.toggleRow}>
                  <span id="research-auto-label">{t("settings.field.autoResearch")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.researchEnabled}
                    aria-labelledby="research-auto-label"
                    className={styles.toggle}
                    data-on={draft.researchEnabled}
                    onClick={() => patch("researchEnabled", !draft.researchEnabled)}
                  >
                    <span className={styles.toggleThumb} />
                  </button>
                </div>
                {draft.researchEnabled && (
                  <div className={styles.field}>
                    <label htmlFor="research-cron" className={styles.fieldLabel}>{t("settings.field.cron")}</label>
                    <input
                      id="research-cron"
                      className={styles.input}
                      value={draft.researchCron}
                      onChange={(e) => patch("researchCron", e.target.value)}
                    />
                  </div>
                )}
              </section>

              <section data-section="douyin" id="douyin-binding">
                <h3 className={styles.sectionLabel}>{t("settings.section.douyin")}</h3>
                <div className={styles.field}>
                  <label htmlFor="douyin-url" className={styles.fieldLabel}>{t("settings.field.douyinUrl")}</label>
                  <input
                    id="douyin-url"
                    className={styles.input}
                    value={draft.douyinUrl}
                    onChange={(e) => patch("douyinUrl", e.target.value)}
                    placeholder="https://www.douyin.com/user/..."
                  />
                </div>
                <div className={styles.refreshRow}>
                  <button
                    type="button"
                    className={styles.refreshBtn}
                    disabled={!draft.douyinUrl || refreshMut.isPending}
                    onClick={() => refreshMut.mutate()}
                  >
                    {refreshMut.isPending ? t("settings.refreshing") : t("settings.refresh")}
                  </button>
                  {config?.analyticsLastCollectedAt && (
                    <span className={styles.lastCollected}>
                      {t("settings.lastCollected")}: {new Date(config.analyticsLastCollectedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </section>

              <section data-section="model">
                <h3 className={styles.sectionLabel}>{t("settings.section.model")}</h3>
                <div className={styles.field}>
                  <label htmlFor="default-model" className={styles.fieldLabel}>{t("settings.section.model")}</label>
                  <select
                    id="default-model"
                    className={styles.input}
                    value={draft.model}
                    onChange={(e) => patch("model", e.target.value)}
                    aria-label={t("settings.section.model")}
                  >
                    <option value="opus">Claude Opus</option>
                    <option value="sonnet">Claude Sonnet</option>
                    <option value="haiku">Claude Haiku</option>
                  </select>
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
