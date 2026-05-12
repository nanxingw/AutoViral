import { useT } from "@/i18n/useT";
import styles from "./WorksHero.module.css";

interface Props {
  draftCount: number;
  unfinishedSceneCount: number;
}

export function WorksHero({ draftCount, unfinishedSceneCount }: Props) {
  const t = useT();
  const payoffSuffix = unfinishedSceneCount === 1
    ? t("worksHero.payoffSuffixSingular")
    : t("worksHero.payoffSuffixPlural");
  return (
    <section className={styles.wrap}>
      <div className={styles.eyebrow}>
        <span className={styles.dot} />
        <span className="eyebrow">{t("worksHero.eyebrow")}</span>
      </div>
      <h1 className={styles.h1}>
        <span className={styles.num}>{draftCount}</span> {t("worksHero.draftsLabel")}
        ,<br />
        {t("worksHero.payoffPrefix")} <em>{unfinishedSceneCount}</em> {payoffSuffix}
      </h1>
      <div className={styles.sub}>
        <span>{t("worksHero.subtitle")}</span>
      </div>
    </section>
  );
}
