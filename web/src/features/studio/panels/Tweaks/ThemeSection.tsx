import { useTheme } from "@/stores/theme";
import { ACCENTS, useAccent } from "@/stores/accent";
import { useT } from "@/i18n/useT";

export function ThemeSection() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  return (
    <section style={{ padding: "12px 16px" }}>
      <h4
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--text-soft)",
          margin: "0 0 8px",
        }}
      >
        {t("studio.themeSection.heading")}
      </h4>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button
          data-testid="theme-toggle-dark"
          className={theme === "dark" ? "active" : ""}
          onClick={() => setTheme("dark")}
        >
          {t("studio.themeSection.dark")}
        </button>
        <button
          data-testid="theme-toggle-light"
          className={theme === "light" ? "active" : ""}
          onClick={() => setTheme("light")}
        >
          {t("studio.themeSection.light")}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ACCENTS.map((a) => (
          <button
            key={a}
            data-accent-swatch={a}
            aria-label={`accent ${a}`}
            className={accent === a ? "active" : ""}
            onClick={() => setAccent(a)}
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border:
                accent === a
                  ? "2px solid var(--text)"
                  : "1px solid var(--border)",
              background: `var(--accent-${a}, currentColor)`,
            }}
          />
        ))}
      </div>
    </section>
  );
}
