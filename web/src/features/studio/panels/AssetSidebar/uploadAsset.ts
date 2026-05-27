import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

// #91 — import the creator's own media. The server endpoint
// POST /api/works/:id/assets/upload (FormData: file + subdir) has existed all
// along but was an orphan — no UI ever called it. apiFetch can't be reused
// because it JSON.stringify's the body + forces application/json; multipart
// needs raw fetch (the browser sets the multipart boundary itself).

// Mirror the server's shared cap (src/server/api.ts MAX_UPLOAD_BYTES) so the UI
// can reject oversized files instantly instead of round-tripping a 413.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);
// Limits the OS file picker to the kinds the server accepts.
export const ACCEPTED_UPLOAD = "video/*,image/*,audio/*";

export interface UploadResult {
  success: boolean;
  path: string;
  url: string;
}

// Organise uploads into kind-based subdirs (cosmetic — the asset list groups
// by extension, not folder). Falls back to extension when the browser doesn't
// set a MIME type.
function subdirFor(file: File): string {
  const type = file.type;
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "images";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(ext)) return "audio";
  return "images";
}

export async function uploadAsset(workId: string, file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("subdir", subdirFor(file));
  const res = await fetch(`/api/works/${workId}/assets/upload`, {
    method: "POST",
    body: fd,
  });
  const ct = res.headers.get("content-type") ?? "";
  const payload: unknown = ct.includes("application/json")
    ? await res.json()
    : await res.text();
  // Throw ApiError so the caller's localizeApiError maps errorCode
  // (asset_too_large / unsupported_asset_type / work_not_found) to a message.
  if (!res.ok) {
    throw new ApiError(`${res.status} ${res.statusText}`, res.status, payload);
  }
  return payload as UploadResult;
}

/**
 * Uploads a batch of files sequentially, then invalidates the work's asset
 * list so the new items appear. Sequential (not parallel) keeps memory bounded
 * and surfaces the first failing file's error deterministically.
 */
export function useUploadAssets(workId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: File[]): Promise<UploadResult[]> => {
      const out: UploadResult[] = [];
      for (const f of files) out.push(await uploadAsset(workId, f));
      return out;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["assets", workId] });
    },
  });
}
