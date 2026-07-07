import { describe, it, expect, beforeEach } from "vitest";
import { useDive } from "./diveStore";

// B6 (PRD-0010) — the Dive canvas coordination store. It lifts three pieces of
// cross-component state out of the (previously Inspector-local) DiveCanvas:
//   • open — so the Studio top bar can open the canvas from anywhere
//   • view + unassignedCollapsed — the "按分镜聚簇 / 按衍生链" toggle + the
//     unassigned-cluster fold, REMEMBERED per work (同 work 内记忆)
//   • pendingSceneJump — a cluster-title click closes the canvas and asks the
//     AssetSidebar to jump to the matching 分镜 card

function reset() {
  useDive.setState({
    open: false,
    view: "scene",
    unassignedCollapsed: true,
    lastExpandAt: 0,
    pendingSceneJump: null,
    memoWorkId: null,
  });
}

beforeEach(reset);

describe("diveStore", () => {
  it("defaults to the scene-cluster view with the unassigned cluster collapsed", () => {
    const s = useDive.getState();
    expect(s.view).toBe("scene");
    expect(s.unassignedCollapsed).toBe(true);
    expect(s.open).toBe(false);
  });

  it("openCanvas opens the canvas", () => {
    useDive.getState().openCanvas("w1");
    expect(useDive.getState().open).toBe(true);
  });

  it("setView switches views and persists within the same work", () => {
    useDive.getState().openCanvas("w1");
    useDive.getState().setView("lineage");
    // Close + reopen the SAME work — the chosen view survives (同 work 内记忆).
    useDive.getState().closeCanvas();
    useDive.getState().openCanvas("w1");
    expect(useDive.getState().view).toBe("lineage");
  });

  it("remembers the unassigned-fold state within the same work", () => {
    useDive.getState().openCanvas("w1");
    useDive.getState().toggleUnassignedCollapsed(); // → expanded (false)
    expect(useDive.getState().unassignedCollapsed).toBe(false);
    useDive.getState().closeCanvas();
    useDive.getState().openCanvas("w1");
    expect(useDive.getState().unassignedCollapsed).toBe(false);
  });

  it("resets view + fold to defaults when a DIFFERENT work opens the canvas", () => {
    useDive.getState().openCanvas("w1");
    useDive.getState().setView("lineage");
    useDive.getState().toggleUnassignedCollapsed();
    // Switch work — memory must NOT bleed across works.
    useDive.getState().openCanvas("w2");
    expect(useDive.getState().view).toBe("scene");
    expect(useDive.getState().unassignedCollapsed).toBe(true);
  });

  it("stamps lastExpandAt on EXPAND only, never on collapse (Item 4 entrance window)", () => {
    expect(useDive.getState().lastExpandAt).toBe(0);
    const before = Date.now();
    useDive.getState().toggleUnassignedCollapsed(); // collapsed(true) → expanded(false)
    const afterExpand = useDive.getState().lastExpandAt;
    expect(afterExpand).toBeGreaterThanOrEqual(before);
    // Collapsing again must NOT refresh the window (nothing enters on collapse).
    useDive.getState().toggleUnassignedCollapsed(); // expanded(false) → collapsed(true)
    expect(useDive.getState().lastExpandAt).toBe(afterExpand);
  });

  it("jumpToScene closes the canvas and records the pending jump", () => {
    useDive.getState().openCanvas("w1");
    useDive.getState().jumpToScene("sc-3");
    const s = useDive.getState();
    expect(s.open).toBe(false);
    expect(s.pendingSceneJump).toBe("sc-3");
  });

  it("consumeSceneJump clears the pending jump", () => {
    useDive.getState().jumpToScene("sc-3");
    useDive.getState().consumeSceneJump();
    expect(useDive.getState().pendingSceneJump).toBeNull();
  });
});
