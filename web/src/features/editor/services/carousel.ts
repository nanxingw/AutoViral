import { apiFetch, ApiError } from "@/lib/api";
import { CarouselSchema, type Carousel } from "../types";

export async function loadCarousel(workId: string): Promise<Carousel | null> {
  try {
    const raw = await apiFetch<unknown>(`/api/works/${workId}/carousel`);
    return CarouselSchema.parse(raw);
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function saveCarousel(
  workId: string,
  car: Carousel,
): Promise<void> {
  await apiFetch(`/api/works/${workId}/carousel`, {
    method: "PUT",
    body: car,
  });
}
