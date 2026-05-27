import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useT } from "@/i18n/useT";
import { localizeApiError } from "@/i18n/serverError";

export interface Checkpoint {
  file: string;
  deliverable: "carousel.yaml" | "composition.yaml";
  ts: string;
  sha: string;
  bytes: number;
  /** #90 — optional user-supplied name (manual snapshots only). */
  label?: string;
}

/**
 * Shared checkpoints data + restore action. CheckpointsMenu (header
 * dropdown) and ChatRollbackChip (per-message rollback button) both
 * consume this. Restore reloads the page after a short delay so every
 * page-level yaml load happens fresh.
 *
 * `enabled` controls the underlying useQuery — pass false until the
 * consumer actually needs the list (e.g. dropdown not yet open).
 *
 * R101 F422 — manual snapshot. The CheckpointsMenu header comment
 * promised this since day one, but the trigger button only toggled the
 * dropdown — `createManual` plugs that gap by calling the server-side
 * `POST /api/works/:id/checkpoints` endpoint (existed all along).
 *
 * R101 F426 — restore failures used to leak raw `e.message` strings
 * straight to the user. Now they pass through `localizeApiError` to
 * pick up locale + server-error-code i18n routing.
 */
export function useCheckpoints(workId: string, enabled = true) {
  const t = useT();
  const [restoring, setRestoring] = useState<string | null>(null);
  // R22: previously restore failures only console.error'd — user saw the
  // spinner clear and nothing else, no clue why the rollback didn't take.
  // Surface as state so the dropdown can render an inline error.
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  // R101 F422 — `null` means no recent action; "created" / "unchanged"
  // drives the inline status hint after a manual snapshot.
  const [snapshotResult, setSnapshotResult] = useState<
    "created" | "unchanged" | null
  >(null);
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
      // R101 F426 — route through localizeApiError so server errorCodes
      // resolve to i18n keys; falls back to err.message for unmapped.
      setRestoreError(localizeApiError(e, t));
    } finally {
      setRestoring(null);
    }
  };

  const createManual = async (label?: string) => {
    setCreatingSnapshot(true);
    setSnapshotError(null);
    setSnapshotResult(null);
    try {
      // #90 — forward the optional label; the server trims/caps it and
      // treats empty as an unlabelled snapshot.
      const trimmed = label?.trim();
      const out = await apiFetch<{ written: string[] }>(
        `/api/works/${workId}/checkpoints`,
        { method: "POST", body: trimmed ? { label: trimmed } : {} },
      );
      const created = Array.isArray(out.written) && out.written.length > 0;
      setSnapshotResult(created ? "created" : "unchanged");
      if (created) {
        qc.invalidateQueries({ queryKey: ["checkpoints", workId] });
      }
    } catch (e) {
      console.error("[checkpoints] manual snapshot failed", e);
      setSnapshotError(localizeApiError(e, t));
    } finally {
      setCreatingSnapshot(false);
    }
  };

  return {
    items: list.data?.items ?? [],
    isLoading: list.isLoading,
    restore,
    restoring,
    restoreError,
    clearRestoreError: () => setRestoreError(null),
    createManual,
    creatingSnapshot,
    snapshotError,
    snapshotResult,
    clearSnapshotStatus: () => {
      setSnapshotError(null);
      setSnapshotResult(null);
    },
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
