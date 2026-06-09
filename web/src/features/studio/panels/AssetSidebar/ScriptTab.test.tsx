import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScriptTab } from "./ScriptTab";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { Scene } from "@shared/composition";
import { useLocaleStore } from "@/i18n/store";
import { ApiError } from "@/lib/api";

// S4 — mock the bridge transport so we can assert scene edits go through the
// per-intent route (PATCH/POST /scene/…) and never touch the store/autosave.
const apiFetch = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

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
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true });
  useLocaleStore.setState({ locale: "en" });
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

  it("seeds the title control and renders a human-friendly shot number (order+1)", () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    // S4: title is an editable input now → assert its seeded value.
    expect(
      (screen.getByLabelText("Edit shot title") as HTMLInputElement).value,
    ).toBe("Open on the kitchen");
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

  it("seeds prompt, narration, and duration controls from the scene", () => {
    // S4: these are now editable controls, so we assert the seeded VALUE rather
    // than read-only text. prompt → textarea value, duration → number input.
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    expect(
      (screen.getByLabelText("Edit visual description") as HTMLTextAreaElement)
        .value,
    ).toMatch(/sunlit kitchen, steam rising/i);
    expect(
      (screen.getByLabelText("Edit narration") as HTMLTextAreaElement).value,
    ).toBe("It started with one cup of coffee.");
    // durationSec 4 → the number input is seeded with "4".
    expect(
      (screen.getByLabelText("Edit duration (seconds)") as HTMLInputElement)
        .value,
    ).toBe("4");
  });

  it("leaves optional controls UNSET on a sparse scene (no leaked defaults)", () => {
    // S4: the controls are always present (they're how you fill an empty scene),
    // but on a sparse scene they must read as unset — empty selects / inputs,
    // never a value leaked from a sibling scene.
    loadScenes([SPARSE_SCENE]);
    render(<ScriptTab />);
    // status: planned → hollow dot, aria-label "Planned".
    expect(screen.getByRole("img", { name: "Planned" })).toBeInTheDocument();
    // intent / shotSize / camera selects sit on the "—" (empty) option.
    expect((screen.getByLabelText("Set intent") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Set shot size") as HTMLSelectElement).value).toBe("");
    expect(
      (screen.getByLabelText("Set camera movement") as HTMLSelectElement).value,
    ).toBe("");
    // duration input empty (no fake 0).
    expect(
      (screen.getByLabelText("Edit duration (seconds)") as HTMLInputElement).value,
    ).toBe("");
    // prompt / narration textareas empty.
    expect(
      (screen.getByLabelText("Edit visual description") as HTMLTextAreaElement).value,
    ).toBe("");
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

  it("EN locale renders the panel (incl. placeholders + aria) with no Chinese characters", () => {
    // A SPARSE scene leaves prompt/narration/duration empty so their
    // placeholders render — and we assert over innerHTML (not textContent) so
    // attribute values (placeholder=…, aria-label=…) are covered too. A
    // textContent-only check would miss a Chinese leak in a placeholder (#73/#83).
    loadScenes([SPARSE_SCENE, FULL_SCENE]);
    const { container } = render(<ScriptTab />);
    expect(container.innerHTML).not.toMatch(/[一-鿿]/);
  });
});

describe("ScriptTab (S4) — inline edit goes through the per-intent bridge", () => {
  // The single helper every edit assertion uses: pull the most recent apiFetch
  // call and return [path, opts] typed loosely so we can read body/headers.
  function lastCall(): [string, { method?: string; headers?: Record<string, string>; body?: any }] {
    const calls = apiFetch.mock.calls;
    return calls[calls.length - 1] as any;
  }

  // Scope a label query to one card so a 2-scene render isn't ambiguous.
  function inCard(sceneId: string) {
    const card = screen
      .getAllByTestId("scene-card")
      .find((el) => el.getAttribute("data-scene-id") === sceneId)!;
    return within(card);
  }

  it("editing the title → blur PATCHes /scene/:id with {title} + work-id header", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);

    const input = inCard("s1").getByLabelText("Edit shot title") as HTMLInputElement;
    // jsdom: clear + type, then blur to commit.
    await userEvent.clear(input);
    await userEvent.type(input, "Open on the diner");
    input.blur();

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = lastCall();
    expect(path).toBe("/api/bridge/v1/scene/s1");
    expect(opts.method).toBe("PATCH");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    expect(opts.body).toEqual({ title: "Open on the diner" });
  });

  it("does NOT PATCH when the field is left unchanged (blur with no edit)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const input = screen.getByLabelText("Edit shot title") as HTMLInputElement;
    input.focus();
    input.blur();
    // Give any async commit a tick to (not) fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("changing the intent select PATCHes {intent: <enum literal>}", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const select = screen.getByLabelText("Set intent") as HTMLSelectElement;
    await userEvent.selectOptions(select, "payoff");

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = lastCall();
    expect(path).toBe("/api/bridge/v1/scene/s1");
    expect(opts.body).toEqual({ intent: "payoff" });
  });

  it("changing shotSize / cameraMovement selects PATCH the enum literal", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);

    await userEvent.selectOptions(
      screen.getByLabelText("Set shot size") as HTMLSelectElement,
      "close",
    );
    await waitFor(() =>
      expect(lastCall()[1].body).toEqual({ shotSize: "close" }),
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Set camera movement") as HTMLSelectElement,
      "pan",
    );
    await waitFor(() =>
      expect(lastCall()[1].body).toEqual({ cameraMovement: "pan" }),
    );
  });

  it("clearing an optional enum (— option) PATCHes the field as null (survives JSON, op deletes it)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const select = screen.getByLabelText("Set shot size") as HTMLSelectElement;
    // empty value = the "—" placeholder option = clear. Must travel as null,
    // NOT undefined: JSON.stringify drops undefined keys, so an undefined clear
    // never reaches the bridge (the dead-clear bug this asserts against).
    await userEvent.selectOptions(select, "");
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [, opts] = lastCall();
    expect(opts.body).toEqual({ shotSize: null });
  });

  it("editing durationSec → blur PATCHes {durationSec: <number>}", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const input = screen.getByLabelText("Edit duration (seconds)") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "3");
    input.blur();

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [, opts] = lastCall();
    expect(opts.body).toEqual({ durationSec: 3 });
  });

  it("clearing durationSec PATCHes the field as null (no fake 0; survives JSON)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const input = screen.getByLabelText("Edit duration (seconds)") as HTMLInputElement;
    await userEvent.clear(input);
    input.blur();

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [, opts] = lastCall();
    expect(opts.body).toEqual({ durationSec: null });
  });

  it("a negative durationSec is clamped to 0 (never persists a negative)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const input = screen.getByLabelText("Edit duration (seconds)") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "-5");
    input.blur();

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [, opts] = lastCall();
    expect(opts.body).toEqual({ durationSec: 0 });
  });

  it("move-down on shot 1 POSTs /scene/reorder with the full new order", async () => {
    // FULL_SCENE (s1, order 0) + SPARSE_SCENE (s2, order 1).
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);

    const down = screen.getByLabelText("Move shot 1 later");
    await userEvent.click(down);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = lastCall();
    expect(path).toBe("/api/bridge/v1/scene/reorder");
    expect(opts.method).toBe("POST");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    expect(opts.body).toEqual({ orderedSceneIds: ["s2", "s1"] });
  });

  it("move-up on shot 2 POSTs the complete expected sequence", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);

    const up = screen.getByLabelText("Move shot 2 earlier");
    await userEvent.click(up);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = lastCall();
    expect(path).toBe("/api/bridge/v1/scene/reorder");
    expect(opts.body).toEqual({ orderedSceneIds: ["s2", "s1"] });
  });

  it("move-up is absent on the first card, move-down absent on the last", () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);
    // first card (s1): no move-up.
    expect(screen.queryByLabelText("Move shot 1 earlier")).toBeNull();
    // last card (s2): no move-down.
    expect(screen.queryByLabelText("Move shot 2 later")).toBeNull();
  });

  // ── THE INVARIANT: scene edits never touch the store / never autosave ──────
  it("INVARIANT: editing a scene does NOT mutate the store's comp.scenes locally", async () => {
    loadScenes([FULL_SCENE]);
    // Spy on loadComposition — the ONLY action that may rewrite comp.scenes,
    // and only via the composition-changed refetch (never from an edit).
    const loadSpy = vi.spyOn(useComposition.getState(), "loadComposition");
    const before = useComposition.getState().comp!.scenes;

    render(<ScriptTab />);
    const input = screen.getByLabelText("Edit shot title") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Mutated locally?");
    input.blur();

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    // The edit went out over the bridge…
    expect(apiFetch.mock.calls[0][0]).toBe("/api/bridge/v1/scene/s1");
    // …but the store array is byte-for-byte the same object, untouched (no
    // local mutation, no loadComposition / setState write).
    const after = useComposition.getState().comp!.scenes;
    expect(after).toBe(before);
    expect(after![0].title).toBe("Open on the kitchen");
    expect(loadSpy).not.toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  it("INVARIANT: every scene write targets /api/bridge/v1/scene (never PUT /comp)", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);

    const input = inCard("s1").getByLabelText("Edit shot title") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "X");
    input.blur();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    await userEvent.click(screen.getByLabelText("Move shot 1 later"));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));

    for (const [path, opts] of apiFetch.mock.calls as [string, any][]) {
      expect(path.startsWith("/api/bridge/v1/scene")).toBe(true);
      // No call carries a PUT (the autosave verb) — only PATCH / POST.
      expect(["PATCH", "POST"]).toContain(opts.method);
    }
  });

  it("surfaces a friendly error (not a crash) when the bridge write fails", async () => {
    apiFetch.mockReset();
    apiFetch.mockRejectedValue(new ApiError("400", 400, { error: "scene gone" }));
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);

    const input = screen.getByLabelText("Edit shot title") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "boom");
    input.blur();

    expect(await screen.findByRole("alert")).toHaveTextContent(/scene gone/i);
  });
});
