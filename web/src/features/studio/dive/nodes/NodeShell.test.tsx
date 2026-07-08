import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
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

// ── Item 2: frameless media nodes + Item 5: busy (generating) nodes ──────────
// NodeShell renders an xyflow <Handle>, which needs ReactFlow store context, so
// (like the escape-hatch test above) we mount each variant as a real node.
function renderShellVariant(
  props: Omit<ComponentProps<typeof NodeShell>, "children">,
): HTMLElement {
  function Variant() {
    return (
      <NodeShell {...props}>
        <div />
      </NodeShell>
    );
  }
  const node: Node = {
    id: props.assetId,
    type: "variant",
    position: { x: 0, y: 0 },
    data: {},
    style: { width: 180, height: 120 },
  };
  const { container } = render(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlow nodes={[node]} edges={[]} nodeTypes={{ variant: Variant }} />
    </div>,
  );
  return container as HTMLElement;
}

describe("NodeShell — frameless media + busy state", () => {
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

  it("a frameless idle node has NO border/fill (the image is the subject) + a paint-containment guard", () => {
    const container = renderShellVariant({ assetId: "v1", isCurrent: false, frameless: true, onUse: vi.fn() });
    const shell = container.querySelector<HTMLElement>('[data-testid="dive-node-v1"]')!;
    expect(shell.getAttribute("data-frameless")).toBe("true");
    expect(shell.style.border).toContain("transparent");
    expect(shell.style.background).toBe("transparent");
    expect(shell.style.contain).toBe("layout");
  });

  it("a NON-frameless (audio/text) node keeps its frame + SOLID canvas fill", () => {
    // (happy-dom drops var() colours from the `border` shorthand, so we test the
    // OBSERVABLE difference: a non-frameless idle border is a visible line, NOT
    // transparent, and the card carries the OPAQUE canvas plane fill — the
    // translucent --surface-* glass is banned on the canvas, see
    // tokens.contrast.test.ts "canvas solid tokens".)
    const container = renderShellVariant({ assetId: "a1", isCurrent: false, onUse: vi.fn() });
    const shell = container.querySelector<HTMLElement>('[data-testid="dive-node-a1"]')!;
    expect(shell.getAttribute("data-frameless")).toBeNull();
    expect(shell.style.border).not.toContain("transparent");
    expect(shell.style.background).toBe("var(--canvas-surface-hi)");
  });

  it("a frameless node still gets the accent ring (glow) when it is the current take", () => {
    const container = renderShellVariant({ assetId: "v2", isCurrent: true, frameless: true, onUse: vi.fn() });
    const shell = container.querySelector<HTMLElement>('[data-testid="dive-node-v2"]')!;
    // The accent glow (a longhand box-shadow — var() survives) is the ring signal;
    // a current node is no longer transparent-bordered.
    expect(shell.style.boxShadow).toContain("var(--accent-glow)");
    expect(shell.style.border).not.toContain("transparent");
  });

  it("a busy (generating) node hides the USE pill — there is no take to use yet", () => {
    const container = renderShellVariant({ assetId: "v3", isCurrent: false, frameless: true, busy: true, onUse: vi.fn() });
    expect(container.querySelector('[data-testid="dive-use-v3"]')).toBeNull();
  });

  it("a non-busy node shows the USE pill", () => {
    const container = renderShellVariant({ assetId: "v4", isCurrent: false, frameless: true, onUse: vi.fn() });
    expect(container.querySelector('[data-testid="dive-use-v4"]')).not.toBeNull();
  });
});
