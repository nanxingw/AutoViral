import { useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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
  const [q, setQ] = useState("");
  const debounced = useDebouncedValue(q, debounceMs);

  const status = useClipIndexStatus(workId);
  const search = useClipSearch(workId, debounced);
  const build = useBuildClipIndex(workId);

  // Stub from either status (no index yet) or search itself (Python-side stub).
  const statusStub = status.data && status.data.stub === true ? status.data : null;
  const searchStub = search.data && search.data.stub === true ? search.data : null;
  const stub = statusStub ?? searchStub;

  const isInstallStub = stub?.reason?.includes("open_clip");
  const isNoIndex = stub?.reason === "no_index" || stub?.reason === "no_indexable_assets";

  const inputDisabled = !!isInstallStub;

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
        placeholder={inputDisabled ? "Semantic search unavailable" : "Search assets…"}
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
          <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>
            Semantic search unavailable
          </div>
          <code style={{ fontSize: 10 }}>
            pip install -r skills/autoviral/modules/research/scripts/clip_index/requirements.txt
          </code>
        </div>
      )}

      {/* No-index stub: surface the build button */}
      {!isInstallStub && (isNoIndex || !status.data || statusStub) && (
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
          {build.isPending ? "Building…" : "Build index"}
        </button>
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
