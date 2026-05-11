import { useEffect, useId, useRef, useState } from "react";
import { useSettingsPanelStore } from "@/stores/settings";
import { useModalFocus } from "@/hooks/useModalFocus";
import { useT } from "@/i18n/useT";
import { useConfig, type AppConfig } from "@/queries/config";
import styles from "./SettingsPanel.module.css";

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
  const t = useT();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const { data: config } = useConfig();
  const [draft, setDraft] = useState<AppConfig | null>(null);

  useModalFocus(open, panelRef);

  // Seed draft when config loads / panel opens; reset on close
  useEffect(() => {
    if (open && config && !draft) setDraft({ ...config });
    if (!open) setDraft(null);
  }, [open, config, draft]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  if (!open) return null;

  const patch = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [k]: v });
  };

  return (
    <div
      className={styles.backdrop}
      data-testid="settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePanel();
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
            onClick={closePanel}
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
                <label className={styles.toggleRow}>
                  <span>{t("settings.field.autoResearch")}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.researchEnabled}
                    className={styles.toggle}
                    data-on={draft.researchEnabled}
                    onClick={() => patch("researchEnabled", !draft.researchEnabled)}
                  >
                    <span className={styles.toggleThumb} />
                  </button>
                </label>
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

              {/* Tasks 8-9 will append Douyin / Model sections here */}
            </>
          ) : (
            <div>{t("common.loading")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
