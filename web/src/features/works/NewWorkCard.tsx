import { useNavigate } from "react-router-dom";
import { useCreateWork } from "@/queries/works";
import styles from "./NewWorkCard.module.css";

export function NewWorkCard() {
  const navigate = useNavigate();
  const create = useCreateWork();

  async function pick(type: "short-video" | "image-text") {
    const w = await create.mutateAsync({ title: "Untitled", type });
    navigate(type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`);
  }

  return (
    <div className={styles.card}>
      <button type="button" className={styles.opt} onClick={() => pick("short-video")}>
        <div className={styles.ico}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        </div>
        <div className={styles.lbl}>短视频</div>
        <div className={styles.sub}>SHORT VIDEO · 9:16</div>
      </button>
      <button type="button" className={styles.opt} onClick={() => pick("image-text")}>
        <div className={styles.ico}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <div className={styles.lbl}>图文</div>
        <div className={styles.sub}>CAROUSEL · 4:5</div>
      </button>
    </div>
  );
}
