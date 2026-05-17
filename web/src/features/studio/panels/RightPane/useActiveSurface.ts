/**
 * Right-pane active-surface persistence.
 *
 * Lives in `localStorage` per ADR-005 with two keys:
 *
 *   autoviral.rightPane.surface.<workId>  — per-work selection (primary)
 *   autoviral.rightPane.defaultSurface    — global fallback (set on first
 *                                            explicit switch away from default)
 *
 * Default surface for a brand-new user/work: `"chat"` (lower cognitive load
 * for non-technical users per ADR-005).
 */

import { useCallback, useEffect, useState } from "react";

export type Surface = "chat" | "terminal";

const SURFACE_KEY = (workId: string) =>
  `autoviral.rightPane.surface.${workId}`;
const GLOBAL_KEY = "autoviral.rightPane.defaultSurface";

const DEFAULT_SURFACE: Surface = "chat";

function readSurface(workId: string): Surface {
  try {
    const perWork = localStorage.getItem(SURFACE_KEY(workId));
    if (perWork === "chat" || perWork === "terminal") return perWork;
    const global = localStorage.getItem(GLOBAL_KEY);
    if (global === "chat" || global === "terminal") return global;
  } catch {
    // localStorage can throw in private-mode browsers; just fall through.
  }
  return DEFAULT_SURFACE;
}

function writeSurface(workId: string, surface: Surface): void {
  try {
    localStorage.setItem(SURFACE_KEY(workId), surface);
    // Global fallback is written on first explicit switch — so the next new
    // work this user opens defaults to their preference, not the hardcoded
    // "chat".
    localStorage.setItem(GLOBAL_KEY, surface);
  } catch {
    // ignore
  }
}

export interface ActiveSurfaceApi {
  active: Surface;
  setActive: (next: Surface) => void;
  toggle: () => void;
}

export function useActiveSurface(workId: string): ActiveSurfaceApi {
  const [active, setActiveState] = useState<Surface>(() => readSurface(workId));

  // If workId changes (rare — workspace switch in the same Studio mount)
  // re-read from storage.
  useEffect(() => {
    setActiveState(readSurface(workId));
  }, [workId]);

  const setActive = useCallback(
    (next: Surface) => {
      setActiveState(next);
      writeSurface(workId, next);
    },
    [workId],
  );

  const toggle = useCallback(() => {
    setActiveState((prev) => {
      const next: Surface = prev === "chat" ? "terminal" : "chat";
      writeSurface(workId, next);
      return next;
    });
  }, [workId]);

  return { active, setActive, toggle };
}
