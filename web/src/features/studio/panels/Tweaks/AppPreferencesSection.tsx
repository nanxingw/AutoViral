import { LocaleToggle } from "@/ui/LocaleToggle";
import { useT } from "@/i18n/useT";
import { useSettingsPanelStore } from "@/stores/settings";

export function AppPreferencesSection() {
  const t = useT();
  const openPanel = useSettingsPanelStore((state) => state.openPanel);

  return (
    <section style={{ padding: "12px 16px", borderTop: "1px solid var(--divider)" }}>
      <h4
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--text-soft)",
          margin: "0 0 8px",
        }}
      >
        {t("topnav.settings")}
      </h4>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <LocaleToggle />
        <button
          type="button"
          data-testid="open-global-settings"
          onClick={() => openPanel()}
          style={{ whiteSpace: "nowrap" }}
        >
          {t("topnav.settings")}
        </button>
      </div>
    </section>
  );
}
