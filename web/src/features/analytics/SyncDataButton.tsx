import { useRefreshAnalytics } from "@/queries/config";
import { useSettingsPanelStore } from "@/stores/settings";
import { useT } from "@/i18n/useT";
import { localizeApiError } from "@/i18n/serverError";
import styles from "./SyncDataButton.module.css";

/**
 * SyncDataButton — the 数据 page's own sync affordance.
 *
 * The S5 refresh control lives in Settings (next to the Douyin URL + the
 * cookie-consent disclosure, deliberately). But a creator standing on the 数据
 * page — the most natural place to think "refresh my numbers" — had no entry
 * point and would only discover the requirement by hitting a 401. This surfaces
 * the SAME refresh mutation here, and on the honest failure paths gives an
 * ACTIONABLE next step instead of a bare error:
 *   · collector_relogin (401, expired/absent Douyin cookie) → localized
 *     "log into douyin.com first" copy + a one-click jump to the Settings
 *     Douyin section.
 *   · douyin_url_missing → jump to Settings to fill the URL.
 * It reuses useRefreshAnalytics (which invalidates the analytics query on
 * success) so a successful sync re-renders the page with fresh data.
 */
export function SyncDataButton({ lastSyncedAt }: { lastSyncedAt?: string }) {
  const t = useT();
  const refreshMut = useRefreshAnalytics();
  const openPanel = useSettingsPanelStore((s) => s.openPanel);

  const isError = refreshMut.isError;
  // A relogin / missing-URL failure is fixable in Settings — offer the jump.
  const errorCode =
    isError && refreshMut.error && typeof refreshMut.error === "object" && "errorCode" in refreshMut.error
      ? (refreshMut.error as { errorCode?: string }).errorCode
      : undefined;
  const isActionable = errorCode === "collector_relogin" || errorCode === "douyin_url_missing";

  const lastSyncedDisplay = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString()
    : null;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.syncBtn}
        disabled={refreshMut.isPending}
        onClick={() => refreshMut.mutate()}
        aria-label={t("analytics.sync.button")}
      >
        <span className={refreshMut.isPending ? styles.spinning : undefined} aria-hidden="true">↻</span>
        {refreshMut.isPending ? t("analytics.sync.syncing") : t("analytics.sync.button")}
      </button>

      {lastSyncedDisplay && !isError && (
        <span className={styles.lastSynced}>
          {t("analytics.sync.lastSynced")} {lastSyncedDisplay}
        </span>
      )}

      {isError && (
        <p role="alert" className={styles.error}>
          {localizeApiError(refreshMut.error, t)}
          {isActionable && (
            <button
              type="button"
              className={styles.jumpBtn}
              onClick={() => openPanel("douyin")}
              aria-label={t("analytics.sync.openSettings")}
            >
              {t("analytics.sync.openSettings")}
            </button>
          )}
        </p>
      )}
    </div>
  );
}
