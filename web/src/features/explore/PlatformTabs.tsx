import type { Platform } from "@/queries/trends";
import styles from "./PlatformTabs.module.css";

const LIST: { key: Platform; label: string; live: boolean }[] = [
  { key: "youtube", label: "YouTube", live: true },
  { key: "tiktok", label: "TikTok", live: true },
  { key: "xiaohongshu", label: "小红书", live: false },
  { key: "douyin", label: "抖音", live: false },
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
          {p.live && <span className={styles.live} />}
          {p.label}
        </button>
      ))}
    </div>
  );
}
