import { apiFetch, ApiError } from "@/lib/api";
import { CarouselSchema, type Carousel } from "../types";

// Normalise an asset path so the browser can actually GET it. The agent
// (autoviral skill) tends to write disk-relative paths like
// `assets/images/01_entry.png` straight into carousel.yaml — those resolve
// against the page URL (e.g. `/editor/<workId>/assets/...`) which the dev
// server doesn't serve. Prepend the work's asset endpoint so they hit the
// real backend route.
function resolveAssetUrl(value: string, workId: string): string {
  if (!value) return value;
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith("/api/")) return value;
  if (value.startsWith("/")) return value; // already an absolute path the dev server might handle
  return `/api/works/${workId}/assets/${value}`;
}

function resolveCarouselAssets(car: Carousel): Carousel {
  return {
    ...car,
    slides: car.slides.map((s) => ({
      ...s,
      bg:
        s.bg.type === "image"
          ? { ...s.bg, value: resolveAssetUrl(s.bg.value, car.workId) }
          : s.bg,
      layers: s.layers.map((l) =>
        l.kind === "image"
          ? { ...l, src: resolveAssetUrl(l.src, car.workId) }
          : l,
      ),
    })),
  };
}

export async function loadCarousel(workId: string): Promise<Carousel | null> {
  try {
    const raw = await apiFetch<unknown>(`/api/works/${workId}/carousel`);
    const parsed = CarouselSchema.parse(raw);
    return resolveCarouselAssets(parsed);
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
