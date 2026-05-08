import clsx from "clsx";
import { compactNumber } from "@/lib/format";
import styles from "./ProfileBar.module.css";

interface Props { nickname: string; followers: number; tags: string[] }

export function ProfileBar({ nickname, followers, tags }: Props) {
  // Initial = first character of nickname; supports CJK + emoji + ascii.
  // Array.from handles surrogate pairs (e.g. emoji avatars don't break).
  const initial = nickname ? Array.from(nickname.trim())[0] ?? "·" : "·";
  return (
    <section className={styles.profile}>
      <div
        className={styles.avatar}
        style={{
          display: "grid",
          placeItems: "center",
          fontFamily: "Instrument Serif, var(--font-serif)",
          fontStyle: "italic",
          fontSize: 36,
          color: "rgba(255,255,255,0.92)",
          textShadow: "0 1px 6px rgba(0,0,0,0.25)",
          userSelect: "none",
        }}
        aria-label={`${nickname} avatar`}
      >
        {initial}
      </div>
      <div>
        <h2 className={styles.h2}>{nickname}</h2>
        <div className={styles.handleMeta}>
          <span className={styles.pill}>▶ {compactNumber(followers)}</span>
        </div>
      </div>
      <div className={styles.tags}>
        {tags.slice(0, 5).map((t, i) => (
          <span key={t} className={clsx(styles.stag, i === 0 && styles.primary)}>{t}</span>
        ))}
      </div>
    </section>
  );
}
