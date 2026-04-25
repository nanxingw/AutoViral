import styles from "./WorksHero.module.css";

interface Props {
  draftCount: number;
  ideaCount: number;
  unfinishedSceneCount: number;
}

export function WorksHero({ draftCount, ideaCount, unfinishedSceneCount }: Props) {
  return (
    <section className={styles.wrap}>
      <div className={styles.eyebrow}>
        <span className={styles.dot} />
        <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
      </div>
      <h1 className={styles.h1}>
        <span className={styles.num}>{draftCount}</span> drafts,{" "}
        <em>{ideaCount} ideas</em> in queue,
        <br />
        and <em>{unfinishedSceneCount}</em> unfinished payoff{" "}
        {unfinishedSceneCount === 1 ? "scene" : "scenes"} waiting for you.
      </h1>
      <div className={styles.sub}>
        <span>No autopilot, no schedule. You decide what to chase next.</span>
      </div>
    </section>
  );
}
