import type { ReactNode } from "react";
import { useT } from "@/i18n/useT";
import styles from "./HonestEmptyState.module.css";

/**
 * PRD-0006 S2 — the reusable honest 3-part empty state.
 *
 * Replaces the deleted demographics + insights placeholder cards, which read
 * fields no code ever writes and lied with "等待后台采集首批样本". The honest
 * shape is three parts:
 *
 *   - Inform   : WHY it's empty (no soft "coming soon" — the real reason).
 *   - Inspire  : a WATERMARKED sample shape so the reader sees what real data
 *                would look like, while it is impossible to mistake for real
 *                data (loud watermark badge + ghosted, hatched fill).
 *   - Activate : one genuinely actionable CTA (rendered by the caller, who
 *                knows whether the right action is connect-account vs
 *                not-enough-followers vs no-API).
 *
 * The watermark is non-negotiable (see honesty constraint + e2e Hard rule 5):
 * the sample is decorative, `aria-hidden`, low-opacity, and badged "SAMPLE".
 */
interface Props {
  informTitle: string;
  informBody: string;
  inspireLabel: string;
  /** The watermarked sample shape (caller supplies its inner illustration). */
  sample: ReactNode;
  activateTitle: string;
  activateBody: string;
  /** Optional real CTA (a button/link). Omit when "do nothing" is honest. */
  cta?: ReactNode;
  /** aria-label for the whole region so screen readers get context. */
  ariaLabel: string;
}

export function HonestEmptyState({
  informTitle,
  informBody,
  inspireLabel,
  sample,
  activateTitle,
  activateBody,
  cta,
  ariaLabel,
}: Props) {
  const t = useT();
  return (
    <section className={styles.card} aria-label={ariaLabel}>
      <div className={styles.inform}>
        <h3 className={styles.informTitle}>{informTitle}</h3>
        <p className={styles.informBody}>{informBody}</p>
      </div>

      <div className={styles.activate}>
        <div className={styles.activateTitle}>{activateTitle}</div>
        <p className={styles.activateBody}>{activateBody}</p>
        {cta ? <div style={{ marginTop: 10 }}>{cta}</div> : null}
      </div>

      <div className={styles.sampleWrap}>
        {/* aria-hidden: the sample is illustrative only, never announced as data. */}
        <div className={styles.sample} aria-hidden="true">
          <span
            className={styles.watermark}
            data-testid="empty-state-watermark"
          >
            {t("analytics.emptyState.sampleWatermark")}
          </span>
          <div className={styles.sampleLabel}>{inspireLabel}</div>
          <div className={styles.sampleContent}>{sample}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * A pre-baked "fake demographics bars" sample shape, watermarked by the host.
 * Pure presentational — the percentages are obviously round, illustrative
 * numbers, never a real distribution.
 */
export function SampleDemographicBars() {
  const rows = [
    { label: "18–24", pct: 0.62 },
    { label: "25–34", pct: 0.41 },
    { label: "35–44", pct: 0.18 },
  ];
  return (
    <div className={styles.sampleBars}>
      {rows.map((r) => (
        <div key={r.label} className={styles.sampleBarRow}>
          <span>{r.label}</span>
          <span className={styles.sampleTrack}>
            <span
              className={styles.sampleFill}
              style={{ width: `${r.pct * 100}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
