import { useState } from "react";
import clsx from "clsx";
import {
  type TrendItem, type Platform, SUPPORTED_REFRESH_PLATFORMS,
} from "@/queries/trends";
import { compactNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
import { TrendDrilldown } from "./TrendDrilldown";
import styles from "./TrendingPanel.module.css";

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "▶ YouTube",
  tiktok: "♪ TikTok",
  xiaohongshu: "小红书",
  douyin: "抖音",
};

export function TrendingPanel({
  platform,
  items,
  onUse,
  busy = false,
  stale = false,
  ageDays = 0,
  collectedAt = null,
}: {
  platform: Platform;
  items: TrendItem[];
  // #65 — "create from this trend": when provided, each row gets a button that
  // hands the trend (title + AI hook) up to the page to seed a new work's
  // topicHint. Undefined → read-only panel (back-compat).
  onUse?: (item: TrendItem) => void;
  busy?: boolean;
  // S14/B2 freshness — server-computed. `stale` flips a visible badge so
  // month-old data can never masquerade as live; `collectedAt` (null when no
  // data on disk) drives an honest "collected Nd ago" line.
  stale?: boolean;
  ageDays?: number;
  collectedAt?: string | null;
}) {
  const t = useT();
  const list = items ?? [];
  const hasData = collectedAt != null;
  // S13 — which row's drill-down is open. Keyed by row index (stable identity
  // for a ranked snapshot, same rationale as the React key below). Resets to
  // null when the list/platform changes because the keys all change → remount.
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {PLATFORM_LABEL[platform]} <em>{t("explore.trendingTitleEm")}</em>
          {stale && (
            <span
              className={styles.staleBadge}
              title={t("explore.trendStaleTitle", { days: ageDays })}
            >
              {t("explore.trendStaleBadge", { days: ageDays })}
            </span>
          )}
        </h2>
        <span className={styles.meta}>
          {list.length === 0
            ? t("explore.trendingNoData")
            : t("explore.trendingTopMeta", { count: list.length })}
        </span>
      </div>
      {hasData && (
        <div className={styles.freshness}>
          {ageDays <= 0
            ? t("explore.trendCollectedToday")
            : t("explore.trendCollectedAt", { days: ageDays })}
        </div>
      )}
      {list.length === 0 && (
        <div style={{ padding: "20px 0", color: "var(--text-dimmer)", fontSize: 12 }}>
          {SUPPORTED_REFRESH_PLATFORMS.includes(platform)
            ? t("explore.trendingPanelEmpty")
            : t("explore.trendingPanelUnsupported")}
        </div>
      )}
      {list.map((item, idx) => (
        // Key by platform+rank, NOT item.id. The youtube/tiktok collectors have
        // emitted items with DUPLICATE ids (22 youtube items all
        // "youtube_d1085ffa"; tiktok partially), and React reconciliation breaks
        // on colliding keys — old rows fail to unmount on platform switch, so the
        // body got stuck on the previous platform's cards and accumulated stale
        // rows (the "stuck on tiktok / can't change" report). A ranked snapshot's
        // stable identity IS its (platform, position); changing platform changes
        // every key → clean remount, no stale rows, robust to duplicate ids.
        <div key={`${platform}-${idx}`} className={styles.row}>
          <div className={styles.rank}>{String(idx + 1).padStart(2, "0")}</div>
          <div className={styles.body}>
            {item.analysis && (
              <div className={styles.eyebrow}>
                <span>{item.analysis.category}</span>
                <span className={styles.eyebrowDot}>·</span>
                <span className={styles.opp} data-opp={item.analysis.opportunity}>
                  {item.analysis.opportunity}
                </span>
              </div>
            )}
            <h3 className={styles.title3}>
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.title}</a>
            </h3>
            {item.analysis?.exampleHook && (
              <p className={styles.hook}>{item.analysis.exampleHook}</p>
            )}
            <div className={styles.stats}>
              {item.metrics?.views != null && <span>▶ {compactNumber(item.metrics.views)}</span>}
              {item.metrics?.likes != null && <span>♥ {compactNumber(item.metrics.likes)}</span>}
              {item.metrics?.comments != null && <span>💬 {compactNumber(item.metrics.comments)}</span>}
              <span className={clsx(styles.sourceBadge, styles[`src_${item.source}`])}>
                {t(`explore.sourceBadge.${item.source === "agent_websearch" ? "agentWebsearch" : item.source}`)}
              </span>
            </div>
            <div className={styles.actions}>
              {/* S13 — open the drill-down (trendline / example / angles /
                  report.md / urgency). Toggles inline beneath this row. */}
              <button
                type="button"
                className={styles.drillBtn}
                aria-expanded={openIdx === idx}
                aria-label={openIdx === idx ? t("explore.collapseTrend") : t("explore.expandTrend")}
                onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
              >
                {openIdx === idx ? `${t("explore.collapseTrend")} ▴` : `${t("explore.expandTrend")} ▾`}
              </button>
              {onUse && (
                <button
                  type="button"
                  className={styles.useBtn}
                  disabled={busy}
                  onClick={() => onUse(item)}
                >
                  {t("explore.useTrend")}
                </button>
              )}
            </div>
            {openIdx === idx && (
              <TrendDrilldown
                platform={platform}
                item={item}
                onClose={() => setOpenIdx(null)}
              />
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
