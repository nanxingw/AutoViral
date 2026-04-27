import { useEffect, useState } from "react";

const DENSITIES = ["balanced", "compact", "comfy"] as const;
type Density = (typeof DENSITIES)[number];

const STORAGE_KEY = "av-density";

function readDensity(): Density {
  if (typeof localStorage === "undefined") return "balanced";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (DENSITIES as readonly string[]).includes(saved))
    return saved as Density;
  return "balanced";
}

function applyDensity(d: Density) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-density", d);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, d);
  }
}

export function DensitySection() {
  const [density, setDensity] = useState<Density>(() => readDensity());

  useEffect(() => {
    applyDensity(density);
  }, [density]);

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
        Density
      </h4>
      <div style={{ display: "flex", gap: 6 }}>
        {DENSITIES.map((d) => (
          <button
            key={d}
            className={density === d ? "active" : ""}
            onClick={() => setDensity(d)}
          >
            {d}
          </button>
        ))}
      </div>
    </section>
  );
}
