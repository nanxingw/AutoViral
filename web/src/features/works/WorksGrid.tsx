import { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { useDeleteWork, type WorkSummary } from "@/queries/works";
import styles from "./WorksGrid.module.css";
import { useT, type MessageKey } from "@/i18n/useT";
import { useLocaleStore } from "@/i18n/store";
import { WorkCardMenu } from "./WorkCardMenu";
import { DeleteWorkConfirm } from "./DeleteWorkConfirm";

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
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const dateFmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
  });
  const visible = filter === "all" ? works : works.filter((w) => w.status === filter);
  const STATUSES = new Set(["draft", "creating", "ready", "failed", "published", "archived"]);

  // Delete flow state — `pendingDelete` doubles as both the "is dialog open"
  // flag (truthy → open) and the work payload the dialog needs for its title +
  // creating-state warning. Setting null both closes and clears.
  const [pendingDelete, setPendingDelete] = useState<WorkSummary | null>(null);
  const deleteMut = useDeleteWork();

  return (
    <>
      <div className={styles.grid}>
        {visible.map((w) => {
          const typeLabel = t(
            (w.type === "short-video" ? "works.type.video" : "works.type.image") as MessageKey,
          );
          const statusLabel = t(
            (`works.status.${STATUSES.has(w.status) ? w.status : "draft"}`) as MessageKey,
          );
          return (
            // Wrapper div is positioning anchor for the absolutely-positioned
            // WorkCardMenu. Menu trigger button is a SIBLING of <Link>, never
            // nested inside it — <button> inside <a> is invalid HTML5 (Safari
            // tab-order glitches; a11y tools flag it).
            //
            // `cardHover` is a plain class (NOT CSS-module-scoped) so
            // WorkCardMenu.module.css's `:global(.cardHover):hover .trigger`
            // selector can reach across module boundaries.
            <div key={w.id} className={clsx(styles.card, "cardHover")}>
              <WorkCardMenu onDelete={() => setPendingDelete(w)} />
              <Link
                to={w.type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`}
                className={styles.cardInner}
              >
                <WorkCover work={w} />
                <div className={clsx(styles.badge, w.status === "draft" && styles.badgeDraft)}>
                  {typeLabel} · {statusLabel}
                </div>
                <div className={styles.typeTag}>{statusLabel}</div>
                <div className={styles.meta}>
                  <h3>{w.title}</h3>
                  <div className={styles.subline}>
                    <span>{dateFmt.format(new Date(w.updatedAt))}</span>
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>
      <DeleteWorkConfirm
        open={!!pendingDelete}
        work={pendingDelete}
        pending={deleteMut.isPending}
        errored={deleteMut.isError}
        onCancel={() => {
          deleteMut.reset();
          setPendingDelete(null);
        }}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMut.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
          });
        }}
      />
    </>
  );
}

/**
 * R34: covers used to silently render broken icons when src 404'd or
 * CORS'd. Per-card local state catches onError → swap to deterministic
 * fallback gradient (same one used for no-cover works). User sees a
 * stable card instead of a glitched thumbnail.
 *
 * Extracted as a sub-component because each card needs independent
 * error state — couldn't keep it inline in the .map() above.
 */
function WorkCover({ work }: { work: WorkSummary }) {
  const cover = work.coverImage ?? null;
  const [failed, setFailed] = useState(false);
  if (!cover || failed) {
    return <div className={styles.thumb} style={{ background: fallbackGradient(work.id) }} />;
  }
  if (work.coverIsVideo) {
    return (
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
        onError={() => setFailed(true)}
        style={{ objectFit: "cover" }}
      />
    );
  }
  return (
    <img
      className={styles.thumb}
      src={cover}
      alt=""
      // `loading="lazy"` was preventing thumbnails from ever
      // initiating a fetch — every <img> stayed at complete:false,
      // naturalW:0 even though the card was visible in viewport
      // and the URL returned 200. The IntersectionObserver Chrome
      // uses for native lazy must not be triggering for our
      // glass-styled cards. Eager is fine — works grid renders
      // ~9 cards above the fold and the rest are needed once
      // user scrolls anyway.
      loading="eager"
      onError={() => setFailed(true)}
      style={{ objectFit: "cover" }}
    />
  );
}
