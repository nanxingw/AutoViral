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
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|flac|ogg)$/i;
const TEXT_EXT = /\.(txt|md|srt|vtt|json|yaml|yml)$/i;

function classify(path: string): AssetItem["kind"] {
  if (VIDEO_EXT.test(path)) return "video";
  if (IMAGE_EXT.test(path)) return "image";
  if (AUDIO_EXT.test(path)) return "audio";
  if (TEXT_EXT.test(path)) return "text";
  return "other";
}

export function useWorkAssets(workId: string | null) {
  return useQuery({
    queryKey: ["assets", workId],
    enabled: !!workId,
    queryFn: async (): Promise<AssetGroup[]> => {
      if (!workId) return [];
      const res = await apiFetch<{ assets: string[] }>(`/api/works/${workId}/assets`);
      const items: AssetItem[] = res.assets.map((p) => {
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
