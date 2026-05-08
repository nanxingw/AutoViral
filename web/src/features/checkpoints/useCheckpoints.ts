import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface Checkpoint {
  file: string;
  deliverable: "carousel.yaml" | "composition.yaml";
  ts: string;
  sha: string;
  bytes: number;
}

/**
 * Shared checkpoints data + restore action. CheckpointsMenu (header
 * dropdown) and ChatRollbackChip (per-message rollback button) both
 * consume this. Restore reloads the page after a short delay so every
 * page-level yaml load happens fresh.
 *
 * `enabled` controls the underlying useQuery — pass false until the
 * consumer actually needs the list (e.g. dropdown not yet open).
 */
export function useCheckpoints(workId: string, enabled = true) {
  const [restoring, setRestoring] = useState<string | null>(null);
  // R22: previously restore failures only console.error'd — user saw the
  // spinner clear and nothing else, no clue why the rollback didn't take.
  // Surface as state so the dropdown can render an inline error.
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["checkpoints", workId],
    queryFn: () =>
      apiFetch<{ items: Checkpoint[] }>(`/api/works/${workId}/checkpoints`),
    enabled,
    staleTime: 5_000,
  });

  const restore = async (file: string) => {
    setRestoring(file);
    setRestoreError(null);
    try {
      await apiFetch<{ deliverable: string }>(
        `/api/works/${workId}/checkpoints/restore`,
        { method: "POST", body: { file } },
      );
      qc.invalidateQueries({ queryKey: ["carousel", workId] });
      qc.invalidateQueries({ queryKey: ["composition", workId] });
      setTimeout(() => location.reload(), 80);
    } catch (e) {
      console.error("[checkpoints] restore failed", e);
      setRestoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(null);
    }
  };

  return {
    items: list.data?.items ?? [],
    isLoading: list.isLoading,
    restore,
    restoring,
    restoreError,
    clearRestoreError: () => setRestoreError(null),
  };
}

/**
 * Pure helper: given a chat-block timestamp (browser Date.now() ms) and
 * the checkpoint list, return the snapshot that corresponds to the
 * agent turn that produced the block — i.e. the *earliest* checkpoint
 * whose ts is `>= blockTs - tolerance`. Returns null if no checkpoint
 * was written for this turn (yaml didn't change).
 */
export function findRollbackTarget(
  blockTs: number,
  items: Checkpoint[],
  toleranceMs = 500,
): Checkpoint | null {
  let best: Checkpoint | null = null;
  let bestT = Infinity;
  for (const c of items) {
    const t = Date.parse(c.ts);
    if (Number.isNaN(t)) continue;
    if (t < blockTs - toleranceMs) continue;
    if (t < bestT) {
      bestT = t;
      best = c;
    }
  }
  return best;
}
