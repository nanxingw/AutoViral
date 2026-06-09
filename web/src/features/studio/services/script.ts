// S5 (PRD-0007 §4.5) — read/write the planning-layer 剧本 (plan/script.md), the
// narrative outline that twins the storyboard. The body is RAW markdown
// (text/markdown), NOT a structured composition — so these target the works
// route `/api/works/:id/plan/script.md` as plain text.
//
// When no script has been written yet the server returns an EMPTY string (200),
// never a hardcoded template in any language (#73/#83 i18n-string-as-data鐵律).
// The empty-state copy is the frontend's responsibility, rendered from "".

import { ApiError } from "@/lib/api";

export async function loadScript(workId: string): Promise<string> {
  // GET returns text/markdown → we want the RAW string, NOT apiFetch (which is
  // the bridge/JSON transport). A brand-new work with no plan/script.md yet
  // returns "" (200), so there is no 404 to special-case for the empty plan.
  // Using fetch directly (not apiFetch) also keeps this read OFF the bridge
  // transport that the scene-edit path mocks — the 剧本 read/write is its own
  // plain-text channel, symmetric with saveScript below.
  const res = await fetch(`/api/works/${workId}/plan/script.md`);
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    const payload: unknown = ct.includes("application/json")
      ? await res.json()
      : await res.text();
    throw new ApiError(`${res.status} ${res.statusText}`, res.status, payload);
  }
  return res.text();
}

export async function saveScript(workId: string, md: string): Promise<void> {
  // The PUT route reads the body via `c.req.text()`, so we must send the RAW
  // markdown bytes — NOT apiFetch's JSON.stringify path (which would quote the
  // text and set application/json). Use fetch directly with a text/markdown
  // body, mirroring apiFetch's error contract (throw ApiError on !ok) so
  // callers handle failures the same way.
  const res = await fetch(`/api/works/${workId}/plan/script.md`, {
    method: "PUT",
    headers: { "content-type": "text/markdown; charset=utf-8" },
    body: md,
  });
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    const payload: unknown = ct.includes("application/json")
      ? await res.json()
      : await res.text();
    throw new ApiError(`${res.status} ${res.statusText}`, res.status, payload);
  }
}
