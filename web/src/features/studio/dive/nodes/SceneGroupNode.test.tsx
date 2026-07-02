import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    // 镜号 (shot number) — same shotNumber key ScriptTab uses.
    expect(screen.getByText(/Shot 3/)).toBeInTheDocument();
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
