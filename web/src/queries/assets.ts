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
  /(^|\/)concat(-[^/]*)?\.txt$/i, // ffmpeg concat / file list
  /(^|\/)filelist(-[^/]*)?\.txt$/i, // ffmpeg concat / file list (alt name)
  /\.labels\.json$/i, // checkpoint label sidecar (#90)
  /(^|\/)composition\.ya?ml$/i, // the composition document itself
  /(^|\/)chat(-[^/]*)?\.jsonl?$/i, // agent chat log / per-session log
  /(^|\/)\.DS_Store$/i, // macOS filesystem cruft
  /\.(tmp|part|crdownload)$/i, // partial upload / download temp files
];

/** True for pipeline-internal files that should never appear in the library. */
export function isPipelineInternal(path: string): boolean {
  return PIPELINE_INTERNAL.some((re) => re.test(path));
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
        };
      });
      const groups: { [k: string]: AssetItem[] } = {
        CLIPS: items.filter((i) => i.kind === "video"),
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
