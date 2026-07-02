import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// B4 (PRD-0010) — per-work cost badge query. Mirrors the shape the B1 endpoint
// (GET /api/works/:id/cost) returns from src/server/cost-ledger/types.ts. Kept
// as a thin structural copy (not a shared import) because the web bundle can't
// pull server-only modules; the endpoint's route test locks the wire contract.

export interface CostKindGroup {
  kind: string;
  usd: number;
  count: number;
  /** True when ANY event in this kind was estimated (flat-rate / token-based). */
  estimated: boolean;
}

export interface CostSummary {
  workId: string;
  totalUsd: number;
  /** True when ANY event in the work was estimated. */
  estimated: boolean;
  count: number;
  byKind: CostKindGroup[];
}

/** The react-query key for a work's cost summary. Shared by the badge query and
 *  the WS-driven invalidation (useBridgeEvents / RightPane turn_complete). */
export function costKey(workId: string | null | undefined) {
  return ["cost", workId] as const;
}

/**
 * Format a USD amount for the badge + breakdown. Two decimals for normal
 * amounts; sub-cent amounts keep extra precision so a $0.003 agent turn doesn't
 * collapse to "$0.00" and read as free. Zero / non-finite → "$0.00".
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) {
    // Trim trailing zeros so 0.0030 → "0.003" but keep at least one digit.
    const s = usd.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return `$${s}`;
  }
  return `$${usd.toFixed(2)}`;
}

export function useCostSummary(workId: string | null | undefined) {
  return useQuery({
    queryKey: costKey(workId),
    enabled: !!workId,
    queryFn: () => apiFetch<CostSummary>(`/api/works/${workId}/cost`),
  });
}
