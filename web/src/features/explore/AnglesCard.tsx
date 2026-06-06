import { useT } from "@/i18n/useT";
import type { AngleBrief, AngleGrounding } from "@/queries/angleBriefs";
import styles from "./AnglesCard.module.css";

interface Props {
  /** The real, grounded briefs from useAngleBriefs (S9). */
  briefs: AngleBrief[];
  /** Create a new work seeded from this brief, then navigate to it. */
  onCreate: (brief: AngleBrief) => void;
  /** True while the feed is being fetched — render an honest loading state. */
  loading?: boolean;
  /** True while a create-from-brief is in flight — disable the CTAs. */
  busy?: boolean;
  /** When provided, a "↻ REGENERATE" button is rendered. */
  onRegenerate?: () => void;
}

// The honest grounding chip label per brief — what the brief is ACTUALLY
// grounded in (trend × niche / trend / niche / thin), never an invented
// "STARTER" placeholder badge.
const GROUNDING_KEY: Record<AngleGrounding, Parameters<ReturnType<typeof useT>>[0]> = {
  "trend+interest": "explore.groundingTrendInterest",
  trend: "explore.groundingTrend",
  interest: "explore.groundingInterest",
  thin: "explore.groundingThin",
};

export function AnglesCard({ briefs, onCreate, loading, busy, onRegenerate }: Props) {
  const t = useT();

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.h2}>{t("explore.anglesH2")}</h2>
        {onRegenerate ? (
          <button type="button" onClick={onRegenerate} className={styles.regen}>↻ REGENERATE</button>
        ) : null}
      </div>

      {loading ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
            color: "var(--text-dim)",
            padding: "8px 0 4px",
          }}
        >
          {t("explore.anglesLoading")}
        </div>
      ) : briefs.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
            color: "var(--text-dimmer)",
            padding: "8px 0 4px",
          }}
        >
          {t("explore.anglesEmpty")}
        </div>
      ) : (
        <div className={styles.list}>
          {briefs.map((b, i) => {
            // A "thin" brief is informational (no trend + no interest) — there
            // is nothing real to create from, so its CTA stays disabled. Every
            // other grounding is a real, creatable angle.
            const creatable = b.grounding !== "thin" && !!b.title.trim();
            const disabled = !creatable || !!busy;
            return (
              <div key={b.id} className={styles.angle}>
                <div className={styles.num}>{String(i + 1).padStart(2, "0")}</div>
                <div className={styles.briefTitle}>{b.title}</div>
                {b.why ? <div className={styles.body}>{b.why}</div> : null}
                <div className={styles.foot}>
                  <span
                    className={styles.score}
                    title={t(GROUNDING_KEY[b.grounding])}
                  >
                    {t(GROUNDING_KEY[b.grounding])}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={creatable && !busy ? () => onCreate(b) : undefined}
                    className={`${styles.go}${disabled ? ` ${styles.goDisabled}` : ""}`}
                    title={creatable ? undefined : t("explore.angleThinCtaDisabled")}
                    aria-label={
                      creatable
                        ? `${t("explore.angleCreateCta")} ${b.title}`
                        : t("explore.angleThinCtaDisabled")
                    }
                  >
                    {busy ? t("explore.angleCreateBusy") : t("explore.angleCreateCta")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
