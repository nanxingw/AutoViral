import clsx from "clsx";
import { compactNumber } from "@/lib/format";
import styles from "./ProfileBar.module.css";

interface Props { nickname: string; followers: number; tags: string[] }

export function ProfileBar({ nickname, followers, tags }: Props) {
  return (
    <section className={styles.profile}>
      <div className={styles.avatar} />
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
