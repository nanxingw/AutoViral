import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { NodeShell } from "./NodeShell";
import { useLocaleStore } from "@/i18n/store";

// ── take USE button — pan/drag escape hatch (E2E R2: BE2-画布聚簇-F1) ──────────
// The take's USE button lives inside a dive node. A dive node can be handed to
// xyflow non-interactive (selectable:false / draggable:false), in which case
// xyflow's NodeWrapper (1) stamps `pointer-events:none` on the `.react-flow__node`
// wrapper AND (2) does NOT add the `nopan` class (it only adds it to draggable
// wrappers — `[noPanClassName]: isDraggable`). Under that wrapper a real mouse
// click on the USE button would (a) not be a hit target and (b) even re-opened,
// its pointerdown would start a canvas pan (see @xyflow/system createFilter,
// which only skips panning when the target is wrapped with `nopan`) that eats the
// click. The button therefore has to be SELF-SUFFICIENT: pointer-events:auto to
// re-open itself as a hit target, plus nopan/nodrag to opt out of pan+drag —
// regardless of whether its enclosing node happens to be draggable today.
// fireEvent.click bypasses all of this, so the real proof is browser-only; here
// we lock the style + classes the fix must carry.

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function ShellNode(_props: NodeProps) {
  return (
    <NodeShell assetId="gen_1" isCurrent={false} onUse={vi.fn()}>
      <div />
    </NodeShell>
  );
}

function renderShellInReactFlow(): HTMLElement {
  const node: Node = {
    id: "gen_1",
    type: "shell",
    position: { x: 0, y: 0 },
    data: {},
    // Worst case: a non-interactive wrapper (pointer-events:none, no nopan).
    selectable: false,
    draggable: false,
    style: { width: 180, height: 120 },
  };
  const { container } = render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlow nodes={[node]} edges={[]} nodeTypes={{ shell: ShellNode }} />
    </div>,
  );
  return container as HTMLElement;
}

describe("NodeShell — take USE button pan/drag escape hatch (E2E R2: BE2-画布聚簇-F1)", () => {
  let realRO: typeof ResizeObserver | undefined;
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    realRO = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      realRO as unknown as typeof ResizeObserver;
  });

  it("re-opens itself as a hit target and opts out of pan/drag even under a non-interactive wrapper", () => {
    const container = renderShellInReactFlow();
    const wrapper = container.querySelector<HTMLElement>('.react-flow__node[data-id="gen_1"]');
    const useBtn = container.querySelector<HTMLElement>('[data-testid="dive-use-gen_1"]');
    // Premise: the wrapper is pointer-events:none and carries no nopan.
    expect(wrapper!.style.pointerEvents).toBe("none");
    expect(wrapper!.classList.contains("nopan")).toBe(false);
    // Fix: the button carries the full escape hatch itself.
    expect(useBtn).not.toBeNull();
    expect(useBtn!.style.pointerEvents).toBe("auto");
    expect(useBtn!.classList.contains("nopan")).toBe(true);
    expect(useBtn!.classList.contains("nodrag")).toBe(true);
  });
});
