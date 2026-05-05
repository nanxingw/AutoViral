import clsx from "clsx";
import type { TrendItem, Platform } from "@/queries/trends";
import { compactNumber } from "@/lib/format";
import styles from "./TrendingPanel.module.css";

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "▶ YouTube",
  tiktok: "♪ TikTok",
  xiaohongshu: "小红书",
  douyin: "抖音",
};

export function TrendingPanel({ platform, items }: { platform: Platform; items: TrendItem[] }) {
  const list = items ?? [];
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {PLATFORM_LABEL[platform]} <em>Trending</em>
        </h2>
        <span className={styles.meta}>
          {list.length === 0 ? "NO DATA" : `TOP ${list.length} · 24H`}
        </span>
      </div>
      {list.length === 0 && (
        <div style={{ padding: "20px 0", color: "var(--text-dimmer)", fontSize: 12 }}>
          暂无该平台趋势数据。请在后台先采集一次 trends。
        </div>
      )}
      {list.map((it) => (
        <div key={it.rank} className={styles.row}>
          <div className={styles.rank}>{String(it.rank).padStart(2, "0")}</div>
          <div className={styles.thumb}>{it.thumbAspect}</div>
          <div>
            <h3 className={styles.title3}>{it.title}</h3>
            <div className={styles.stats}>
              <span>▶ {compactNumber(it.views)}</span>
              <span>♥ {compactNumber(it.likes)}</span>
              <span>💬 {compactNumber(it.comments)}</span>
            </div>
          </div>
          <div
            className={clsx(
              styles.arrow,
              it.change > 0 ? styles.up : it.change < 0 ? styles.down : styles.flat,
            )}
          >
            {it.change > 0 ? `↑ ${it.change}` : it.change < 0 ? `↓ ${Math.abs(it.change)}` : "— 0"}
          </div>
        </div>
      ))}
    </section>
  );
}
