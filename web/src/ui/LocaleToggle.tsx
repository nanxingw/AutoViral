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
      aria-label={t("topnav.localeToggleAria")}
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
        testId="locale-toggle-zh"
      />
      <Seg
        active={locale === "en"}
        onClick={() => setLocale("en")}
        label={t("topnav.localeToggleEn")}
        testId="locale-toggle-en"
      />
    </div>
  );
}

function Seg({
  active,
  onClick,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  testId: string;
}) {
  // e2e-report F72: aria-pressed reflects active locale so SR users hear the
  // selected segment. Visual styling via background-color isn't perceivable.
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
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
