import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface AssetGroup {
  group: string;
  count: number;
  items: AssetItem[];
}

export interface AssetItem {
  /** Path relative to the work dir, e.g. "assets/clips/intro.mp4" or "output/final.mp4" */
  path: string;
  /** URL to fetch the file. */
  url: string;
  /** Bucketed kind for UI grouping. */
  kind: "video" | "audio" | "image" | "text" | "other";
  /** File extension without dot, lowercased. */
  ext: string;
  /** Stable filename for display. */
  name: string;
  /** True for a finished deliverable — `output/final-<ms>.mp4` or
   *  `output/proxy-<ms>.mp4` — which the library groups into EXPORTS
   *  instead of CLIPS (issue #027 / PRD-0012 S4). */
  isExport?: boolean;
  /** True when `isExport` and the file is the half-res/24fps review proxy
   *  (Phase 7.C `output/proxy-<ms>.mp4`) rather than the full deliverable. */
  isProxyExport?: boolean;
  /** Epoch-ms parsed from the export filename's timestamp, when isExport. */
  exportedAt?: number;
}

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i;
const TEXT_EXT = /\.(txt|md|srt|vtt|json|yaml|yml)$/i;

function classify(path: string): AssetItem["kind"] {
  if (VIDEO_EXT.test(path)) return "video";
  if (IMAGE_EXT.test(path)) return "image";
  if (AUDIO_EXT.test(path)) return "audio";
  if (TEXT_EXT.test(path)) return "text";
  return "other";
}

// A7 (PRD-0010) — files the render/audio pipeline scatters through assets/ +
// output/ that are NOT creator-facing media. The library filters these out
// BEFORE classification; otherwise e.g. a per-audio `.peaks.json` waveform
// cache lands in TEXT and its raw JSON gets rendered as a "content" snippet.
//
// This is FRONTEND-ONLY hygiene. The CLI bridge's asset projection
// (server-side `listAssets`) is deliberately left untouched so agents keep
// seeing the raw work tree — the filtering is purely a human-UI concern.
const PIPELINE_INTERNAL: RegExp[] = [
  /\.peaks\.json$/i, // waveform cache written next to each audio file
  // separator class [-_.] covers concat.txt / concat-0.txt / concat_list.txt /
  // concat.list.txt without eating creator files like concatenation-notes.txt
  /(^|\/)concat([-_.][^/]*)?\.txt$/i, // ffmpeg concat / file list
  /(^|\/)filelist([-_.][^/]*)?\.txt$/i, // ffmpeg concat / file list (alt name)
  /\.labels\.json$/i, // checkpoint label sidecar (#90)
  // the work's composition document itself — video works write composition.yaml
  // and carousel works write carousel.yaml (works.ts), both to the work dir.
  // Filtered symmetrically so a carousel work's carousel.yaml never renders its
  // raw YAML as a TEXT "content" snippet (AE3-F3).
  /(^|\/)(composition|carousel)\.ya?ml$/i,
  /(^|\/)chat(-[^/]*)?\.jsonl?$/i, // agent chat log / per-session log
  /(^|\/)\.DS_Store$/i, // macOS filesystem cruft
  /\.(tmp|part|crdownload)$/i, // partial upload / download temp files
  // S5/#027 — render-pipeline derived intermediates. Best-effort cleanup in
  // render-pipeline.ts deletes these on a successful export, but this filter
  // also covers legacy files written before that fix (or the rare unlink
  // failure). Deliberately anchored to `output/` so a creator's own file —
  // e.g. "assets/my-ducked-track.mp4" — is never swept up; only the render
  // pipeline writes into output/.
  /^output\/autoviral-export-[^/]*\.mp4$/i, // Stage 1 raw Remotion render
  /^output\/[^/]*-ducked\.mp4$/i, // Stage 2 ducking pass
  /^output\/[^/]*-burned\.mp4$/i, // Stage 3 subtitle burn-in pass
  /^output\/[^/]*-normalized\.mp4$/i, // Stage 4 loudnorm pass
  // codex review (S5 finding, medium) — the PRE-Remotion ffmpeg pre-passes
  // (speed-ramp / timewarp / crop-flip) write keyed CACHE mp4s into output/
  // ahead of Stage 1 (src/server/speed-ramp-ffmpeg.ts / transforms-ffmpeg.ts).
  // These are deliberately NOT deleted by S5's post-export cleanup — each
  // pre-pass `stat()`s its cache path first and skips the ffmpeg re-run on a
  // hit, so deleting them would defeat the cache on every subsequent export.
  // Hide them from CLIPS instead (visibility filter, not deletion).
  // codex review (S3×S6 finding, medium) — the server-side cache key grew a
  // `-fps<N>` suffix (src/server/speed-ramp-ffmpeg.ts speedRampCacheName)
  // once comp.fps became part of the signature (PRD-0011 made fps
  // user-editable; S3's -g/-keyint_min GOP fix bakes fps into the cache).
  // The suffix is OPTIONAL in the regex so pre-fix cache files already on a
  // creator's disk (written before this change, no `-fps` segment) keep
  // matching too — they must stay hidden, not suddenly leak into CLIPS.
  /^output\/clip-[^/]*-speed-\d+(-fps\d+)?\.mp4$/i, // static speed-ramp pre-pass cache
  // S4 (PRD-0014) — variable-speed segmented concat + AudioClip atempo caches.
  // Both are content-hashed like the timewarp/cropflip caches (the curve /
  // speed+span+fps folded into a sha1), so they follow the same hidden pattern.
  /^output\/clip-[^/]*-speedvar-[0-9a-f]+\.mp4$/i, // variable-speed concat pre-pass cache
  /^output\/clip-[^/]*-speedaud-[0-9a-f]+\.m4a$/i, // AudioClip static-speed atempo cache
  /^output\/clip-[^/]*-timewarp-[0-9a-f]+\.mp4$/i, // time-warp (reverse/freeze) pre-pass cache
  /^output\/clip-[^/]*-cropflip-[0-9a-f]+\.mp4$/i, // crop/flip pre-pass cache
];

/** True for pipeline-internal files that should never appear in the library. */
export function isPipelineInternal(path: string): boolean {
  return PIPELINE_INTERNAL.some((re) => re.test(path));
}

// #027 — a finished deliverable's on-disk name IS its type + a stem:
// `output/final-<stem>.mp4` (full export) or `output/proxy-<stem>.mp4`
// (Phase 7.C half-res review proxy). render-pipeline.ts's Stage 5 always
// writes `${filePrefix}-${Date.now()}.mp4` (an epoch-ms stem), but E2E gap 3
// (2026-07-09) found the stem-restricted-to-digits regex missed hand-renamed
// or historical deliverables (e.g. `final-30fps.mp4`) — those fell out of
// EXPORTS and drowned in CLIPS with source clips. The `final-`/`proxy-`
// prefix alone already disambiguates from render-pipeline intermediates:
// autoviral-export-*, *-ducked/-burned/-normalized never start with that
// prefix (render-pipeline.ts's filePrefix/Date.now() naming), so the stem
// can be any non-empty non-numeric string too. classifyExport() below
// already degrades exportedAt to undefined when the stem doesn't parse as a
// number — that's the "no timestamp badge" fallback, not a new code path.
const EXPORT_RE = /^output\/(final|proxy)-([^/]+)\.mp4$/i;

export interface ExportClassification {
  isExport: boolean;
  isProxyExport: boolean;
  exportedAt?: number;
}

/** Pure classifier: is `path` a finished export, and if so which kind +
 *  when. Returns `{ isExport: false, isProxyExport: false }` for anything
 *  else (including plain `assets/**.mp4` source clips, which stay in
 *  CLIPS). */
export function classifyExport(path: string): ExportClassification {
  const m = path.match(EXPORT_RE);
  if (!m) return { isExport: false, isProxyExport: false };
  const ms = Number(m[2]);
  return {
    isExport: true,
    isProxyExport: m[1]!.toLowerCase() === "proxy",
    exportedAt: Number.isFinite(ms) ? ms : undefined,
  };
}

/** Format an export's epoch-ms timestamp for the mono badge, e.g. "07/09
 *  14:32". Uses UTC getters (not local wall-clock) so the string is
 *  deterministic across machines/timezones — this is a rough "when", not a
 *  precise local clock, and determinism matters more than locale-accuracy
 *  for a small mono badge. */
export function formatExportedAt(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function useWorkAssets(workId: string | null) {
  return useQuery({
    queryKey: ["assets", workId],
    enabled: !!workId,
    queryFn: async (): Promise<AssetGroup[]> => {
      if (!workId) return [];
      const res = await apiFetch<{ assets: string[] }>(`/api/works/${workId}/assets`);
      const items: AssetItem[] = res.assets
        .filter((p) => !isPipelineInternal(p))
        .map((p) => {
        const m = p.match(/\.([^.]+)$/);
        const ext = (m?.[1] ?? "").toLowerCase();
        const name = p.split("/").pop() ?? p;
        return {
          path: p,
          url: `/api/works/${workId}/assets/${p.split("/").map(encodeURIComponent).join("/")}`,
          kind: classify(p),
          ext,
          name,
          ...classifyExport(p),
        };
      });
      // #027 — finished deliverables (final-*/proxy-*) get their own EXPORTS
      // group ahead of CLIPS instead of drowning in the same bucket as raw
      // source clips. Everything else buckets exactly as before.
      const groups: { [k: string]: AssetItem[] } = {
        EXPORTS: items.filter((i) => i.isExport),
        CLIPS: items.filter((i) => i.kind === "video" && !i.isExport),
        IMAGES: items.filter((i) => i.kind === "image"),
        AUDIO: items.filter((i) => i.kind === "audio"),
        TEXT: items.filter((i) => i.kind === "text"),
      };
      return Object.entries(groups)
        .filter(([, list]) => list.length > 0)
        .map(([group, list]) => ({ group, count: list.length, items: list }));
    },
  });
}
