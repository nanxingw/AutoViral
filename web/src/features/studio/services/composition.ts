import { apiFetch, ApiError } from "@/lib/api";
import { CompositionSchema, type Composition } from "../types";

export async function loadComposition(
  workId: string,
): Promise<Composition | null> {
  try {
    const raw = await apiFetch<unknown>(
      `/api/works/${workId}/composition`,
    );
    return CompositionSchema.parse(raw);
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveComposition(
  workId: string,
  comp: Composition,
): Promise<void> {
  await apiFetch(`/api/works/${workId}/composition`, {
    method: "PUT",
    body: comp,
  });
}
