import { useTheme } from "@/stores/theme";
import { useEffect, useState } from "react";

const ACCENTS = ["violet", "cyan", "coral", "lime", "steel"] as const;
type Accent = (typeof ACCENTS)[number];

const STORAGE_KEY = "av-accent";

function readAccent(): Accent {
  if (typeof localStorage === "undefined") return "steel";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (ACCENTS as readonly string[]).includes(saved))
    return saved as Accent;
  return "steel";
}

function applyAccent(a: Accent) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-accent", a);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, a);
  }
}

export function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const [accent, setAccent] = useState<Accent>(() => readAccent());

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

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
        Theme
      </h4>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button
          className={theme === "dark" ? "active" : ""}
          onClick={() => setTheme("dark")}
        >
          Dark
        </button>
        <button
          className={theme === "light" ? "active" : ""}
          onClick={() => setTheme("light")}
        >
          Light
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
