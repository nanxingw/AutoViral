import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlow, type Node } from "@xyflow/react";
import { SceneGroupNode, type SceneGroupNodeData } from "./SceneGroupNode";
import { useLocaleStore } from "@/i18n/store";
import { MESSAGES } from "@/i18n/messages";
import { STATUS_KEY, INTENT_KEY, SHOT_KEY } from "../../sceneI18n";
import { makeScene } from "../../../../test/composition-fixtures";

// B6 (PRD-0010) — the cluster title bar. It reuses the SAME 分镜-list i18n maps
// as ScriptTab (STATUS_KEY / INTENT_KEY / SHOT_KEY, both now imported from the
// shared sceneI18n module) so status / intent / shot copy is single-sourced,
// and it multi-encodes the "需重生 / stale" state (colour + icon + text — never
// colour alone, per e2e Hard rule 5).

function renderNode(data: SceneGroupNodeData) {
  return render(<SceneGroupNode {...({ id: data.scene?.id ?? "__unassigned__", data } as any)} />);
}

beforeEach(() => {
  // Deterministic copy — assert against the English message table.
  useLocaleStore.setState({ locale: "en" });
});

describe("SceneGroupNode — cluster title bar (B6)", () => {
  it("renders 镜号 / title / intent / shot / status from the shared i18n maps", () => {
    const scene = makeScene({
      id: "sc1",
      order: 2,
      title: "The reveal",
      status: "generated",
      intent: "hook",
      shotSize: "closeup",
    });
    renderNode({
      isUnassigned: false,
      label: scene.title!,
      scene,
      shotNo: scene.order + 1,
      onJump: vi.fn(),
    });

    const en = MESSAGES.en;
    // 镜号 — the zero-padded editorial numeric badge (visual); screen-reader
    // semantics live on the title button's jumpToSceneAria label instead.
    expect(screen.getByTestId("dive-cluster-shotno").textContent).toBe("03");
    expect(screen.getByText("The reveal")).toBeInTheDocument();
    // status / intent / shot copy is the EXACT ScriptTab-sourced string.
    const walk = (k: string) =>
      k.split(".").reduce((n: any, p) => n?.[p], en as any) as string;
    expect(screen.getByText(walk(STATUS_KEY.generated))).toBeInTheDocument();
    expect(screen.getByText(walk(INTENT_KEY.hook))).toBeInTheDocument();
    expect(screen.getByText(walk(SHOT_KEY.closeup))).toBeInTheDocument();
  });

  it("multi-encodes the stale (需重生) status — colour + icon + text, not colour alone", () => {
    const scene = makeScene({
      id: "sc1",
      order: 0,
      title: "Needs a redo",
      status: "stale",
    });
    renderNode({
      isUnassigned: false,
      label: scene.title!,
      scene,
      shotNo: 1,
      onJump: vi.fn(),
    });

    // TEXT channel — the same staleBadge label ScriptTab shows.
    const badge = screen.getByTestId("dive-cluster-stale");
    expect(badge.textContent ?? "").toContain(MESSAGES.en.studio.scriptPanel.staleBadge);
    // ICON channel — a glyph inside the badge (not colour-only).
    expect(badge.querySelector("[aria-hidden]")).not.toBeNull();
    // STATE channel — a data attribute survives colour-blind / greyscale.
    const dot = screen.getByTestId("dive-cluster-status-dot");
    expect(dot.getAttribute("data-status")).toBe("stale");
  });

  it("shows NO stale badge for a non-stale cluster", () => {
    const scene = makeScene({ id: "sc1", order: 0, title: "Fine", status: "generated" });
    renderNode({ isUnassigned: false, label: "Fine", scene, shotNo: 1, onJump: vi.fn() });
    expect(screen.queryByTestId("dive-cluster-stale")).toBeNull();
  });

  it("clicking the title bar invokes onJump (back to the storyboard card)", () => {
    const onJump = vi.fn();
    const scene = makeScene({ id: "sc1", order: 0, title: "Tap me", status: "planned" });
    renderNode({ isUnassigned: false, label: "Tap me", scene, shotNo: 1, onJump });
    fireEvent.click(screen.getByTestId("dive-cluster-title"));
    expect(onJump).toHaveBeenCalledOnce();
  });

  it("the unassigned cluster shows a fold toggle with its member count and NO jump", () => {
    const onToggleCollapse = vi.fn();
    renderNode({
      isUnassigned: true,
      label: "Unassigned",
      scene: null,
      shotNo: null,
      collapsed: true,
      memberCount: 4,
      onToggleCollapse,
    });
    // No clickable scene title for the unassigned bucket.
    expect(screen.queryByTestId("dive-cluster-title")).toBeNull();
    const toggle = screen.getByTestId("dive-unassigned-toggle");
    expect(toggle.textContent ?? "").toContain("4");
    fireEvent.click(toggle);
    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });
});

// ── pointer-events escape hatch (E2E R2: BE2-画布聚簇-F1) ─────────────────────
// This is the CONTRACT test behind that fix, and it deliberately does NOT stub
// xyflow. It mounts a REAL <ReactFlow> holding a `sceneGroup` node configured
// exactly as DiveCanvas configures it (selectable:false, draggable:false, no
// node-level mouse handler) and then asserts BOTH halves of the chain:
//
//   1. PREMISE — the actual `.react-flow__node` wrapper xyflow renders around
//      our node gets inline `pointer-events: none`. This is not our own style;
//      it is xyflow's NodeWrapper reacting to our node config. If someone made
//      the group node selectable, or xyflow changed this behaviour, THIS
//      assertion (and the reason the escape hatch exists) breaks — so the test
//      is not tautological, it verifies the condition the fix responds to.
//   2. FIX — the interactive control inside (cluster title / unassigned toggle)
//      carries `pointer-events: auto`, re-opening itself as a hit target under
//      the pointer-events:none wrapper. Drop GROUP_NODE_HIT_TARGET and this goes
//      red.
//
// The one thing we CANNOT assert here is that a real mouse click physically
// lands on the button rather than falling through to the react-flow__pane —
// happy-dom has no layout or hit-testing (getComputedStyle does not even resolve
// inherited pointer-events). That final "the click reaches the button" proof is
// browser-only and lives in the E2E dimension BE2-画布聚簇-F1.

// xyflow measures nodes with a ResizeObserver that happy-dom lacks.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderGroupInReactFlow(data: SceneGroupNodeData): HTMLElement {
  const node: Node = {
    id: data.scene?.id ?? "__unassigned__",
    type: "sceneGroup",
    position: { x: 0, y: 0 },
    data,
    // The exact non-interactive config DiveCanvas hands group nodes.
    selectable: false,
    draggable: false,
    style: { width: 320, height: 120 },
  };
  const { container } = render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlow nodes={[node]} edges={[]} nodeTypes={{ sceneGroup: SceneGroupNode }} />
    </div>,
  );
  return container as HTMLElement;
}

describe("SceneGroupNode — pointer-events escape hatch (E2E R2: BE2-画布聚簇-F1)", () => {
  let realRO: typeof ResizeObserver | undefined;
  beforeEach(() => {
    realRO = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      realRO as unknown as typeof ResizeObserver;
  });

  it("xyflow really stamps pointer-events:none on the group node wrapper (the premise)", () => {
    const scene = makeScene({ id: "sc1", order: 0, title: "Tap me", status: "planned" });
    const container = renderGroupInReactFlow({
      isUnassigned: false,
      label: "Tap me",
      scene,
      shotNo: 1,
      onJump: vi.fn(),
    });
    const wrapper = container.querySelector<HTMLElement>('.react-flow__node[data-id="sc1"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.pointerEvents).toBe("none");
    // …and because the group node is draggable:false, xyflow does NOT put the
    // `nopan` class on the wrapper (it only adds it to draggable wrappers — see
    // @xyflow/react NodeWrapper `[noPanClassName]: isDraggable`). So the pane's
    // pan/zoom filter (@xyflow/system createFilter) will START A CANVAS PAN on a
    // pointerdown anywhere in this subtree unless the control opts out itself.
    // This is the second half of the bug both prior fixes (ab2599a, 90c0300)
    // missed: pointer-events:auto alone re-opens the hit target, but the ensuing
    // pointerdown still gets hijacked into a pan that eats the click.
    expect(wrapper!.classList.contains("nopan")).toBe(false);
  });

  it("the scene cluster title re-opens itself as a hit target under that wrapper", () => {
    const scene = makeScene({ id: "sc1", order: 0, title: "Tap me", status: "planned" });
    const container = renderGroupInReactFlow({
      isUnassigned: false,
      label: "Tap me",
      scene,
      shotNo: 1,
      onJump: vi.fn(),
    });
    const wrapper = container.querySelector<HTMLElement>('.react-flow__node[data-id="sc1"]');
    const title = container.querySelector<HTMLElement>('[data-testid="dive-cluster-title"]');
    // Guard the whole chain, not the style line in isolation: wrapper is none…
    expect(wrapper!.style.pointerEvents).toBe("none");
    // …and the control inside overrides it back to auto.
    expect(title).not.toBeNull();
    expect(title!.style.pointerEvents).toBe("auto");
    // …AND opts out of the pane's pan + node-drag so a real pointerdown reaches
    // it instead of starting a canvas pan that swallows the click. (This is the
    // constraint browser E2E BE2-画布聚簇-F1 proves at the hit-test level; here
    // we lock the two classes the fix must carry — nopan/nodrag are what
    // @xyflow/system createFilter + NodeWrapper check for.)
    expect(title!.classList.contains("nopan")).toBe(true);
    expect(title!.classList.contains("nodrag")).toBe(true);
  });

  it("the unassigned fold toggle re-opens itself as a hit target under that wrapper", () => {
    const container = renderGroupInReactFlow({
      isUnassigned: true,
      label: "Unassigned",
      scene: null,
      shotNo: null,
      collapsed: true,
      memberCount: 3,
      onToggleCollapse: vi.fn(),
    });
    const wrapper = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="__unassigned__"]',
    );
    const toggle = container.querySelector<HTMLElement>('[data-testid="dive-unassigned-toggle"]');
    expect(wrapper!.style.pointerEvents).toBe("none");
    expect(toggle).not.toBeNull();
    expect(toggle!.style.pointerEvents).toBe("auto");
    // Same pan/drag opt-out as the scene title.
    expect(toggle!.classList.contains("nopan")).toBe(true);
    expect(toggle!.classList.contains("nodrag")).toBe(true);
  });
});
