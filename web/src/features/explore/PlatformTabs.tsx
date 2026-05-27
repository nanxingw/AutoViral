import { type Platform, SUPPORTED_REFRESH_PLATFORMS } from "@/queries/trends";
import styles from "./PlatformTabs.module.css";

// #82 — the "live" dot is DERIVED from SUPPORTED_REFRESH_PLATFORMS (the single
// source of truth), not a separate hardcoded map. Previously this hardcoded
// youtube/tiktok=live, which contradicted both the refresh endpoint (collects
// 小红书/抖音 only) and the product copy. Deriving it keeps the dot honest.
const LIST: { key: Platform; label: string }[] = [
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "douyin", label: "抖音" },
];

export function PlatformTabs({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className={styles.tabs}>
      {LIST.map((p) => (
        <button
          key={p.key}
          type="button"
          className={styles.tab}
          data-active={value === p.key}
          onClick={() => onChange(p.key)}
        >
          {SUPPORTED_REFRESH_PLATFORMS.includes(p.key) && (
            <span className={styles.live} />
          )}
          {p.label}
        </button>
      ))}
    </div>
  );
}
