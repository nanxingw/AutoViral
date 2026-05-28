import clsx from "clsx";
import {
  type TrendItem, type Platform, SUPPORTED_REFRESH_PLATFORMS,
} from "@/queries/trends";
import { compactNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
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
}: {
  platform: Platform;
  items: TrendItem[];
  // #65 — "create from this trend": when provided, each row gets a button that
  // hands the trend (title + AI hook) up to the page to seed a new work's
  // topicHint. Undefined → read-only panel (back-compat).
  onUse?: (item: TrendItem) => void;
  busy?: boolean;
}) {
  const t = useT();
  const list = items ?? [];
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {PLATFORM_LABEL[platform]} <em>{t("explore.trendingTitleEm")}</em>
        </h2>
        <span className={styles.meta}>
          {list.length === 0
            ? t("explore.trendingNoData")
            : t("explore.trendingTopMeta", { count: list.length })}
        </span>
      </div>
      {list.length === 0 && (
        <div style={{ padding: "20px 0", color: "var(--text-dimmer)", fontSize: 12 }}>
          {SUPPORTED_REFRESH_PLATFORMS.includes(platform)
            ? t("explore.trendingPanelEmpty")
            : t("explore.trendingPanelUnsupported")}
        </div>
      )}
      {list.map((item, idx) => (
        <div key={item.id} className={styles.row}>
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
        </div>
      ))}
    </section>
  );
}
