import { Link } from "react-router-dom";
import { format } from "date-fns";
import clsx from "clsx";
import type { WorkSummary } from "@/queries/works";
import styles from "./WorksGrid.module.css";

interface Props {
  works: WorkSummary[];
  filter: "all" | "draft" | "published" | "archived";
}

export function WorksGrid({ works, filter }: Props) {
  const visible = filter === "all" ? works : works.filter((w) => w.status === filter);
  return (
    <div className={styles.grid}>
      {visible.map((w) => (
        <Link
          key={w.id}
          to={w.type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`}
          className={styles.card}
        >
          <div className={styles.thumb} />
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
      ))}
    </div>
  );
}
