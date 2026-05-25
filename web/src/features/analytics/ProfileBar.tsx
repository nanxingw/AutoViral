import clsx from "clsx";
import { compactNumber } from "@/lib/format";
import styles from "./ProfileBar.module.css";

interface Props { nickname: string; followers: number; tags: string[] }

// e2e-report F3 (Round 02): the pill previously used ▶ which on creator
// platforms reads as "plays / video count" — semantically wrong for a
// followers metric. Swap to a Users icon (Lucide-style) so the icon matches
// what the number represents.
function UsersIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: "-1px" }}
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

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
          // e2e-report F97: use --accent-fg so the initial reads on every
          // accent variant (was rgba(255,255,255,0.92) which sank into the
          // pale steel-light gradient).
          color: "var(--accent-fg)",
          textShadow: "0 1px 6px rgba(0,0,0,0.18)",
          userSelect: "none",
        }}
        aria-label={`${nickname} avatar`}
      >
        {initial}
      </div>
      <div>
        <h2 className={styles.h2}>{nickname}</h2>
        <div className={styles.handleMeta}>
          <span className={styles.pill}><UsersIcon /> {compactNumber(followers)}</span>
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
