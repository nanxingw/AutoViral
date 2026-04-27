import { apiFetch } from "@/lib/api";

export interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

export interface CaptionsResponse {
  captions: CaptionLine[];
}

export async function fetchCaptions(opts: {
  workId: string;
  assetPath: string;
}): Promise<CaptionLine[]> {
  const res = await apiFetch<CaptionsResponse>("/api/audio/captions", {
    method: "POST",
    body: { workId: opts.workId, assetPath: opts.assetPath },
  });
  return res.captions ?? [];
}
