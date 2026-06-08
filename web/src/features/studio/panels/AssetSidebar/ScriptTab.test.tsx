import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScriptTab } from "./ScriptTab";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { Scene } from "@shared/composition";

// S3 (PRD-0007) — ScriptTab renders comp.scenes as a read-only card list,
// sorted by `order`, localising every enum/field label. This test isolates the
// read path: we inject scenes into the store and assert the rendered cards.

function loadScenes(scenes: Scene[]) {
  const comp = makeEmptyComposition({ workId: "w1" });
  (comp as { scenes?: Scene[] }).scenes = scenes;
  useComposition.getState().loadComposition(comp);
}

const FULL_SCENE: Scene = {
  id: "s1",
  order: 0,
  title: "Open on the kitchen",
  prompt: "Wide shot of a sunlit kitchen, steam rising from a mug",
  memberClipIds: [],
  memberAssetIds: [],
  intent: "hook",
  narration: "It started with one cup of coffee.",
  durationSec: 4,
  shotSize: "long",
  cameraMovement: "push",
  generatedAssetIds: [],
  status: "generated",
  mdAnchor: "#scene-1",
};

const SPARSE_SCENE: Scene = {
  id: "s2",
  order: 1,
  title: "The reveal",
  memberClipIds: [],
  memberAssetIds: [],
  generatedAssetIds: [],
  status: "planned",
  // no prompt / narration / durationSec / shotSize / cameraMovement / intent
  // and no mdAnchor → "no linked section" note must show.
};

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null });
});

describe("ScriptTab (S3) — read-only storyboard cards", () => {
  it("renders one card per scene, sorted ascending by order", () => {
    // Inject out of order to prove the component sorts by `order`.
    loadScenes([SPARSE_SCENE, FULL_SCENE]);
    render(<ScriptTab />);
    const cards = screen.getAllByTestId("scene-card");
    expect(cards).toHaveLength(2);
    // order 0 (FULL_SCENE) must render before order 1 (SPARSE_SCENE).
    expect(cards[0].getAttribute("data-scene-id")).toBe("s1");
    expect(cards[1].getAttribute("data-scene-id")).toBe("s2");
  });

  it("renders the title and a human-friendly shot number (order+1)", () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    expect(screen.getByText("Open on the kitchen")).toBeInTheDocument();
    // order 0 → "Shot 1"
    expect(screen.getByText(/shot 1/i)).toBeInTheDocument();
  });

  it("renders localised intent / status / shot / camera labels (EN catalog)", () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    // intent: hook → "Hook"
    expect(screen.getByText("Hook")).toBeInTheDocument();
    // status: generated → "Generated" (on the status dot's aria-label/title)
    expect(screen.getByRole("img", { name: "Generated" })).toBeInTheDocument();
    // shotSize: long → "Wide"
    expect(screen.getByText("Wide")).toBeInTheDocument();
    // cameraMovement: push → "Push in"
    expect(screen.getByText("Push in")).toBeInTheDocument();
  });

  it("renders prompt, narration, and duration when present", () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    expect(
      screen.getByText(/sunlit kitchen, steam rising/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("It started with one cup of coffee."),
    ).toBeInTheDocument();
    // durationSec 4 → "4s"
    expect(screen.getByText("4s")).toBeInTheDocument();
  });

  it("does NOT render optional fields that are absent on a sparse scene", () => {
    loadScenes([SPARSE_SCENE]);
    render(<ScriptTab />);
    const card = screen.getByTestId("scene-card");
    // No intent badge.
    expect(card.querySelector("[data-intent]")).toBeNull();
    // status: planned → hollow dot, aria-label "Planned".
    expect(screen.getByRole("img", { name: "Planned" })).toBeInTheDocument();
    // No "Wide"/"Push in"/duration leaked from FULL_SCENE.
    expect(screen.queryByText("Wide")).toBeNull();
    expect(screen.queryByText("Push in")).toBeNull();
    expect(screen.queryByText(/\ds$/)).toBeNull();
  });

  it("shows the 'no linked script section' note when mdAnchor is missing", () => {
    loadScenes([SPARSE_SCENE]);
    render(<ScriptTab />);
    expect(
      screen.getByText(/no linked script section/i),
    ).toBeInTheDocument();
  });

  it("does NOT show the 'no linked' note when mdAnchor is present", () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    expect(screen.queryByText(/no linked script section/i)).toBeNull();
  });

  it("shows the onboarding empty state when the work has no scenes", () => {
    // Existing work, no scenes key at all.
    loadScenes([]);
    render(<ScriptTab />);
    expect(screen.getByText(/no storyboard yet/i)).toBeInTheDocument();
    expect(screen.getByText(/autoviral scene add/i)).toBeInTheDocument();
    expect(screen.queryByTestId("scene-card")).toBeNull();
  });

  it("EN locale renders the panel with no Chinese characters", () => {
    loadScenes([FULL_SCENE]);
    const { container } = render(<ScriptTab />);
    expect(container.textContent ?? "").not.toMatch(/[一-鿿]/);
  });
});
