import { useLocaleStore } from "@/i18n/store";
import { useT } from "@/i18n/useT";

/** Two-segment 中 / EN pill that toggles the global locale store. */
export function LocaleToggle() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useT();
  return (
    <div
      role="group"
      aria-label="Locale toggle"
      style={{
        display: "inline-flex",
        border: "1px solid var(--glass-border, rgba(0,0,0,0.1))",
        borderRadius: 999,
        padding: 2,
        gap: 2,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <Seg
        active={locale === "zh"}
        onClick={() => setLocale("zh")}
        label={t("topnav.localeToggleZh")}
      />
      <Seg
        active={locale === "en"}
        onClick={() => setLocale("en")}
        label={t("topnav.localeToggleEn")}
      />
    </div>
  );
}

function Seg({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? "var(--accent, #2a3a4a)" : "transparent",
        color: active ? "var(--bg, #fff)" : "var(--text-soft)",
        border: "none",
        padding: "2px 10px",
        borderRadius: 999,
        cursor: "pointer",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </button>
  );
}
