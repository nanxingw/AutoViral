import styles from "./InsightRibbon.module.css";

export interface Insight {
  tag: string;
  body: string;
  date: string;
  cta?: string;
}

interface Props {
  insights: Insight[];
  /** When provided, marks the ribbon as placeholder data — renders a SAMPLE
   *  chip header + visually de-emphasizes each card so users don't read
   *  the bodies as real algorithm output. Same pattern as AnglesCard. */
  note?: string;
  /** #76 — explanatory label for the (disabled) CTA in demo mode. Shown as
   *  title + aria-label so the CTA reads as "not wired yet", not a dead link.
   *  (AnglesCard used to share this demo pattern; S9 replaced its samples with
   *  real grounded briefs, so only this ribbon still carries the demo CTA.) */
  ctaDisabledLabel?: string;
}

export function InsightRibbon({ insights, note, ctaDisabledLabel }: Props) {
  const isDemo = !!note;
  return (
    <>
      {note && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--text-dimmer)",
          }}
        >
          <span
            style={{
              padding: "2px 8px",
              fontSize: 9,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              border: "1px solid var(--glass-border)",
              borderRadius: 4,
            }}
            aria-label="Sample data, not algorithm output"
          >
            Sample
          </span>
          <span>* {note}</span>
        </div>
      )}
      <section className={styles.wrap} style={isDemo ? { opacity: 0.6 } : undefined}>
        {insights.map((i, idx) => (
          <div key={idx} className={styles.card}>
            <span className={styles.tag}>→ {i.tag}</span>
            <h3 className={styles.head}>{i.body}</h3>
            <div className={styles.foot}>
              <span>{i.date}</span>
              {/* #76 — the CTA was a fake-clickable <span> (accent color +
                  arrow, no role/handler/disabled). In demo mode render a real
                  disabled <button> with an explanatory title/aria-label so it
                  reads as "not available yet", matching AnglesCard. */}
              {i.cta &&
                (isDemo ? (
                  <button
                    type="button"
                    disabled
                    title={ctaDisabledLabel}
                    aria-label={
                      ctaDisabledLabel ? `${i.cta} — ${ctaDisabledLabel}` : i.cta
                    }
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      color: "var(--text-dimmer)",
                      cursor: "not-allowed",
                    }}
                  >
                    {i.cta}
                  </button>
                ) : (
                  <span style={{ color: "var(--accent)" }}>{i.cta}</span>
                ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
