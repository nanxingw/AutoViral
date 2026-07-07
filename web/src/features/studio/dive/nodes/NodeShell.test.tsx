import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useLocaleStore } from "@/i18n/store";

// NodeShell pulls in xyflow's <Handle>, which needs a ReactFlowProvider to
// render. We stub it (and Position) so the shell can be unit-tested in isolation
// — the assertion here is about the USE button's hit-target style, not xyflow.
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

import { NodeShell } from "./NodeShell";

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" });
});

describe("NodeShell — take USE button (E2E R2: BE2-画布聚簇-F1)", () => {
  // A take's USE button lives inside a dive node. Provenance nodes can be handed
  // to xyflow non-interactive (selectable:false/draggable:false) which stamps
  // `pointer-events: none` on the `.react-flow__node` wrapper; the button must
  // set `pointer-events: auto` so a real mouse click can still select the take
  // instead of falling through to the react-flow__pane. Defensive + explicit.
  it("the USE button re-enables pointer-events:auto", () => {
    render(
      <NodeShell assetId="gen_1" isCurrent={false} onUse={vi.fn()}>
        <div />
      </NodeShell>,
    );
    expect(screen.getByTestId("dive-use-gen_1").style.pointerEvents).toBe("auto");
  });

  it("keeps pointer-events:auto even when the take is the current binding", () => {
    render(
      <NodeShell assetId="gen_2" isCurrent onUse={vi.fn()}>
        <div />
      </NodeShell>,
    );
    expect(screen.getByTestId("dive-use-gen_2").style.pointerEvents).toBe("auto");
  });
});
