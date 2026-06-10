import { useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useT } from "@/i18n/useT";
import {
  useClipIndexStatus,
  useClipSearch,
  useBuildClipIndex,
} from "@/queries/clipSearch";

interface Props {
  workId: string;
  /** Override the debounce window — exposed for tests; defaults to D8 = 300ms. */
  debounceMs?: number;
}

/**
 * Phase 8.1.C — Semantic search box mounted at the top of LibraryTab.
 *
 * UX states (priority order — highest wins):
 *   1. Stub mode (server reports open_clip missing or no index): banner with
 *      either "install hint" or "Build index" button.
 *   2. Empty/short query: passive state, no fetch.
 *   3. Loading: "Searching…" indicator.
 *   4. No matches: empty hint.
 *   5. Results list with score chips.
 */
export function SearchBox({ workId, debounceMs = 300 }: Props) {
  const t = useT();
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, debounceMs);

  const status = useClipIndexStatus(workId);
  const search = useClipSearch(workId, debounced);
  const build = useBuildClipIndex(workId);

  // F129 root cause (closed 2026-05-12): we used to aggregate stubs from
  // only `status` + `search`, missing the **mutation result itself**. When
  // the user clicked the build button and the Python script reported
  // `{stub:true, reason:"open_clip_torch not installed"}`, the diagnostic
  // never reached the UI — looked like a silent-failure for 8 e2e rounds.
  // buildStub is checked last so it doesn't fight an already-built index.
  const statusStub = status.data && status.data.stub === true ? status.data : null;
  const searchStub = search.data && search.data.stub === true ? search.data : null;
  const buildStub = build.data && build.data.stub === true ? build.data : null;
  // Priority: buildStub > statusStub > searchStub. The most recent mutation
  // result is the most authoritative diagnostic — status only knows "no
  // index" but the build attempt knows *why* (e.g. "open_clip_torch not
  // installed"). Without this priority, the actionable install hint is
  // shadowed by status's generic no_index message.
  const stub = buildStub ?? statusStub ?? searchStub;

  const isInstallStub = stub?.reason?.includes("open_clip");
  const isNoIndex = stub?.reason === "no_index" || stub?.reason === "no_indexable_assets";
  // #55: feature was removed in the agentic-terminal refactor — server returns
  // {stub:true, reason:"clip_index_removed_in_refactor"} for build/search/status.
  // Without an explicit branch, all three feedback paths (install / buildOk /
  // isError) miss and the UI renders nothing → silent dead button. Honest
  // degrade: disable the input, hide the build button, surface a banner.
  const isRemoved = stub?.reason === "clip_index_removed_in_refactor";

  // Surface a one-line success when the build returns a non-stub result —
  // otherwise the button just disappears and the user has no confirmation
  // that anything happened. status.data refresh closes the affordance gap
  // but takes a tick; this is the immediate post-click signal.
  const buildOk = build.data && build.data.stub === false ? build.data : null;

  const inputDisabled = !!isInstallStub || isRemoved;
  const placeholderKey = isRemoved
    ? "studio.assetSearch.placeholderRemoved"
    : inputDisabled
      ? "studio.assetSearch.placeholderDisabled"
      : "studio.assetSearch.placeholder";

  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--divider)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <input
        type="text"
        aria-label="Search assets"
        placeholder={t(placeholderKey)}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={inputDisabled}
        style={{
          padding: "7px 10px",
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.02em",
          background: "var(--surface-0)",
          border: "1px solid var(--glass-border)",
          borderRadius: 8,
          color: "var(--text)",
          outline: "none",
          opacity: inputDisabled ? 0.5 : 1,
        }}
      />

      {/* Install-deps stub banner */}
      {isInstallStub && (
        <div
          role="status"
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dimmer)",
            lineHeight: 1.5,
            padding: "6px 8px",
            border: "1px dashed var(--glass-border)",
            borderRadius: 6,
          }}
        >
          {/* B3 — the old install hint pointed at a requirements.txt under
              skills/autoviral/modules/, a path deleted in the agentic-terminal
              refactor (29b9e96). The dead `pip install -r …` <code> block was
              removed; the i18n banner stays so the open_clip-missing state is
              still surfaced honestly (no actionable path until the search
              feature returns as a sibling skill). */}
          <div style={{ color: "var(--text-dim)" }}>
            {t("studio.assetSearch.stubInstall")}
          </div>
        </div>
      )}

      {/* #55: feature retired in refactor — honest-degrade banner instead of
          a dead button. Keep `data-testid` so QA/E2E can target it directly. */}
      {isRemoved && (
        <div
          role="status"
          data-testid="clip-index-removed-banner"
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dimmer)",
            lineHeight: 1.5,
            padding: "6px 8px",
            border: "1px dashed var(--glass-border)",
            borderRadius: 6,
          }}
        >
          <div style={{ color: "var(--text-dim)" }}>
            {t("studio.assetSearch.stubRemoved")}
          </div>
        </div>
      )}

      {/* No-index stub: surface the build button. #55: do NOT render this
          block when the feature is retired — otherwise the "Build index"
          button comes back as a no-op and we regress to the silent-dead UI
          state. The `!isRemoved` gate is load-bearing. */}
      {!isInstallStub && !isRemoved && (isNoIndex || !status.data || statusStub) && (
        <>
          <button
            type="button"
            data-bare
            onClick={() => build.mutate()}
            disabled={build.isPending}
            style={{
              alignSelf: "flex-start",
              padding: "5px 12px",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              background: build.isPending ? "transparent" : "var(--accent-glow)",
              color: build.isPending ? "var(--text-dim)" : "var(--accent-hi)",
              border: "1px solid var(--accent)",
              borderRadius: 999,
              cursor: build.isPending ? "default" : "pointer",
            }}
          >
            {build.isPending ? t("studio.assetSearch.btnBuilding") : t("studio.assetSearch.btnBuild")}
          </button>
          {/* R22: build.error from React Query was previously unused — failures
              were silent. Surface as an inline alert so users know to retry
              instead of staring at an unchanged button. */}
          {build.isError && (
            <div
              role="alert"
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--status-error, #d4756c)",
                padding: "4px 0",
                lineHeight: 1.5,
              }}
            >
              {t("studio.assetSearch.buildFailed", {
                msg:
                  build.error instanceof Error
                    ? build.error.message
                    : String(build.error),
              })}
            </div>
          )}
          {buildOk && (
            <div
              role="status"
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--accent-hi)",
                padding: "4px 0",
                lineHeight: 1.5,
                letterSpacing: "0.04em",
              }}
            >
              {t("studio.assetSearch.buildOk", {
                count: String(buildOk.assetCount),
                ms: String(buildOk.durationMs),
              })}
            </div>
          )}
        </>
      )}

      {/* Loading indicator while a search is in flight */}
      {!stub && search.isFetching && debounced.length >= 2 && (
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dimmer)",
            letterSpacing: "0.06em",
          }}
        >
          SEARCHING…
        </div>
      )}

      {/* No matches */}
      {!stub &&
        !search.isFetching &&
        debounced.length >= 2 &&
        search.data &&
        !search.data.stub &&
        search.data.results.length === 0 && (
          <div
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--text-dimmer)",
              letterSpacing: "0.06em",
            }}
          >
            NO MATCHES FOR “{debounced}”
          </div>
        )}

      {/* Results list */}
      {!stub &&
        search.data &&
        !search.data.stub &&
        search.data.results.length > 0 && (
          <ul
            data-testid="clip-search-results"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {search.data.results.map((hit) => {
              const name = hit.uri.split("/").pop() ?? hit.uri;
              const tight = hit.score >= 0.3;
              return (
                <li
                  key={hit.uri}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "4px 8px",
                    border: "1px solid var(--glass-border)",
                    borderRadius: 6,
                    background: "var(--surface-0)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: "var(--font-mono)",
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: tight ? "var(--accent-glow)" : "transparent",
                      color: tight ? "var(--accent-hi)" : "var(--text-dim)",
                      border: tight ? "1px solid var(--accent)" : "1px solid var(--glass-border)",
                      flexShrink: 0,
                    }}
                  >
                    {hit.score.toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
