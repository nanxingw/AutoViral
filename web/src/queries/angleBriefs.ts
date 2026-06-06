// web/src/queries/angleBriefs.ts
//
// PRD-0006 S9 — the honest replacement for the old hard-coded 3-sample 起手切角
// card. GET /api/coach/angle-briefs/:platform assembles the SAME grounded
// context the coach reads (works + selected-platform trends + interests) and
// runs it through a PURE deterministic shaper server-side, so this is instant
// (no LLM round-trip on page load) and never fabricates. The card honours each
// brief's `grounding` honestly instead of showing fake samples.
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import type { Platform } from "@/queries/trends";

/** What a brief is grounded in — drives the honest UI chip. Mirrors the
 *  server's AngleGrounding union (src/domain/angle-briefs.ts). */
export type AngleGrounding = "trend+interest" | "trend" | "interest" | "thin";

export interface AngleBrief {
  id: string;
  /** The selection's name — also the new work's title + the brief lead line. */
  title: string;
  /** A concrete opening hook the creator can shoot. */
  hook: string;
  /** Why this is worth doing now — grounded in the real trend/interest. */
  why: string;
  /** What this brief is grounded in — the UI shows an honest chip from this. */
  grounding: AngleGrounding;
}

const VALID_GROUNDINGS: readonly AngleGrounding[] = [
  "trend+interest", "trend", "interest", "thin",
];

function toBrief(raw: unknown, i: number): AngleBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title : "";
  if (!title.trim()) return null;
  const grounding = VALID_GROUNDINGS.includes(r.grounding as AngleGrounding)
    ? (r.grounding as AngleGrounding)
    : "thin";
  return {
    id: typeof r.id === "string" && r.id ? r.id : `brief-${i}`,
    title,
    hook: typeof r.hook === "string" ? r.hook : "",
    why: typeof r.why === "string" ? r.why : "",
    grounding,
  };
}

/**
 * Fetch the grounded angle briefs for `platform`. The server shaper is pure +
 * deterministic, so this resolves instantly. A 404 (route absent) resolves to an
 * empty feed rather than an error — the card then renders its honest empty state.
 */
export function useAngleBriefs(platform: Platform) {
  return useQuery({
    queryKey: ["angle-briefs", platform],
    queryFn: async (): Promise<AngleBrief[]> => {
      try {
        const raw = await apiFetch<{ briefs?: unknown[] }>(
          `/api/coach/angle-briefs/${platform}`,
        );
        const list = Array.isArray(raw?.briefs) ? raw.briefs : [];
        return list
          .map((b, i) => toBrief(b, i))
          .filter((b): b is AngleBrief => b != null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}
