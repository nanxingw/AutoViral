import { create } from "zustand";

// B6 (PRD-0010) — coordination store for the Dive canvas. It lifts three pieces
// of state that used to be trapped inside the Inspector-mounted DiveCanvas so
// the whole-composition view becomes a first-class, top-bar-reachable surface:
//
//   • open — the Studio top bar opens the canvas; a cluster-title click closes it
//   • view + unassignedCollapsed — the "按分镜聚簇 / 按衍生链" toggle and the
//     unassigned-cluster fold, remembered PER WORK (同 work 内记忆): reopening
//     the same work keeps the last choice; opening a different work resets to
//     the defaults so one work's layout preference never bleeds into another
//   • pendingSceneJump — a cluster title hands the sidebar a scene id: switch to
//     the Script tab and expand that 分镜 card. The consumer clears it after use.

export type ClusterView = "scene" | "lineage";

const DEFAULT_VIEW: ClusterView = "scene";
const DEFAULT_UNASSIGNED_COLLAPSED = true;

export interface DiveState {
  open: boolean;
  view: ClusterView;
  /** Whether the "未归属" cluster is folded (default true when scene clusters exist). */
  unassignedCollapsed: boolean;
  /** Item 4 — timestamp (ms) of the last EXPAND action. Newly-mounted member
   *  nodes play the entrance animation only within a short window after this, so
   *  onlyRenderVisibleElements remounts (pan/zoom) don't replay it as flicker. */
  lastExpandAt: number;
  /** Scene id the sidebar should jump to + expand; null = nothing pending. */
  pendingSceneJump: string | null;
  /** Tenancy — which work the view/fold memory belongs to. */
  memoWorkId: string | null;

  openCanvas: (workId: string) => void;
  closeCanvas: () => void;
  setView: (view: ClusterView) => void;
  toggleUnassignedCollapsed: () => void;
  /** Cluster title clicked: close the canvas and request a jump to `sceneId`. */
  jumpToScene: (sceneId: string) => void;
  /** The sidebar consumed the jump. */
  consumeSceneJump: () => void;
}

export const useDive = create<DiveState>((set) => ({
  open: false,
  view: DEFAULT_VIEW,
  unassignedCollapsed: DEFAULT_UNASSIGNED_COLLAPSED,
  lastExpandAt: 0,
  pendingSceneJump: null,
  memoWorkId: null,

  openCanvas: (workId) =>
    set((s) =>
      s.memoWorkId === workId
        ? { open: true }
        : {
            open: true,
            memoWorkId: workId,
            view: DEFAULT_VIEW,
            unassignedCollapsed: DEFAULT_UNASSIGNED_COLLAPSED,
          },
    ),
  closeCanvas: () => set({ open: false }),
  setView: (view) => set({ view }),
  toggleUnassignedCollapsed: () =>
    set((s) => {
      const next = !s.unassignedCollapsed;
      // Only stamp the entrance window on EXPAND (collapse has nothing to
      // animate in); collapsing leaves the last timestamp untouched.
      return next
        ? { unassignedCollapsed: next }
        : { unassignedCollapsed: next, lastExpandAt: Date.now() };
    }),
  jumpToScene: (sceneId) => set({ open: false, pendingSceneJump: sceneId }),
  consumeSceneJump: () => set({ pendingSceneJump: null }),
}));
