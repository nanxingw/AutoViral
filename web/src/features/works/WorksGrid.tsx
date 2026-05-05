import { Link } from "react-router-dom";
import { format } from "date-fns";
import clsx from "clsx";
import type { WorkSummary } from "@/queries/works";
import styles from "./WorksGrid.module.css";

interface Props {
  works: WorkSummary[];
  filter: "all" | "draft" | "published" | "archived";
}

// Deterministic palette per work id — keeps fallback covers visually distinct
// instead of every card getting the same blue/gold gradient.
const FALLBACK_PALETTES = [
  ["#1a2540", "#2a3a5a", "#d4a04a"],
  ["#2a1530", "#3d1f2a", "#c44a4a"],
  ["#1a1a1a", "#2a2010", "#d4a04a"],
  ["#0a0a0f", "#1a1530", "#4a2a5a"],
  ["#0a1a30", "#1a3a4a", "#4a8a8a"],
  ["#241830", "#3a224a", "#7a4a9a"],
  ["#0f1a1a", "#1a2a2a", "#4a8a7a"],
  ["#2a2a1a", "#3a3a1a", "#9a9a4a"],
];

function fallbackGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const [a, b, c] = FALLBACK_PALETTES[h % FALLBACK_PALETTES.length];
  return `linear-gradient(135deg, ${a} 0%, ${b} 50%, ${c} 100%)`;
}

export function WorksGrid({ works, filter }: Props) {
  const visible = filter === "all" ? works : works.filter((w) => w.status === filter);
  return (
    <div className={styles.grid}>
      {visible.map((w) => {
        const cover = w.coverImage ?? null;
        return (
          <Link
            key={w.id}
            to={w.type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`}
            className={styles.card}
          >
            {cover && w.coverIsVideo ? (
              <video
                className={styles.thumb}
                src={cover}
                muted
                loop
                playsInline
                preload="metadata"
                onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                onMouseLeave={(e) => {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = 0;
                }}
                style={{ objectFit: "cover" }}
              />
            ) : cover ? (
              <img
                className={styles.thumb}
                src={cover}
                alt=""
                loading="lazy"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <div className={styles.thumb} style={{ background: fallbackGradient(w.id) }} />
            )}
            <div className={clsx(styles.badge, w.status === "draft" && styles.badgeDraft)}>
              {w.type === "short-video" ? "VIDEO" : "IMAGE"} · {w.status === "draft" ? "DRAFT" : "READY"}
            </div>
            <div className={styles.typeTag}>{w.status.toUpperCase()}</div>
            <div className={styles.meta}>
              <h3>{w.title}</h3>
              <div className={styles.subline}>
                <span>{format(new Date(w.updatedAt), "MMM d")}</span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
