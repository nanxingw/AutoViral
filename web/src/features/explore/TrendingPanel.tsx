import clsx from "clsx";
import {
  type TrendItem, type Platform, SUPPORTED_REFRESH_PLATFORMS, coverUrlFor,
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

export function TrendingPanel({ platform, items }: { platform: Platform; items: TrendItem[] }) {
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
          <img
            className={styles.thumb}
            src={coverUrlFor(platform, item)}
            alt={item.title}
            loading="lazy"
            data-aspect={item.cover.aspect}
            // Swap to a valid-but-transparent 1×1 SVG data URI when the remote
            // cover is unreachable (CDN proxy/hotlink block). `removeAttribute`
            // or empty-string src still triggers Chrome's broken-image glyph
            // *on top of* our CSS gradient — a valid transparent src suppresses
            // that glyph so .thumb[data-broken] shows cleanly.
            onError={(e) => {
              const img = e.currentTarget;
              if (img.dataset.broken === "true") return;
              img.src = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%2F%3E";
              img.setAttribute("data-broken", "true");
              img.removeAttribute("alt");
            }}
          />
          <div>
            <h3 className={styles.title3}>
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.title}</a>
            </h3>
            <div className={styles.stats}>
              {item.metrics?.views != null && <span>▶ {compactNumber(item.metrics.views)}</span>}
              {item.metrics?.likes != null && <span>♥ {compactNumber(item.metrics.likes)}</span>}
              {item.metrics?.comments != null && <span>💬 {compactNumber(item.metrics.comments)}</span>}
              <span className={clsx(styles.sourceBadge, styles[`src_${item.source}`])}>
                {t(`explore.sourceBadge.${item.source === "agent_websearch" ? "agentWebsearch" : item.source}`)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
