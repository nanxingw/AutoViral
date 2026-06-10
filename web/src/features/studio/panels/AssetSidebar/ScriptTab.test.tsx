import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScriptTab } from "./ScriptTab";
import { useComposition } from "../../store";
import { useScript } from "../../scriptStore";
import { makeEmptyComposition } from "../../types";
import type { Scene } from "@shared/composition";
import { useLocaleStore } from "@/i18n/store";
import { ApiError } from "@/lib/api";

// S4 — mock the bridge transport so we can assert scene edits go through the
// per-intent route (PATCH/POST /scene/…) and never touch the store/autosave.
// S5 also routes the 剧本 GET (loadScript) through apiFetch, so the mount-load
// resolves through this same mock.
const apiFetch = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

// PRD-0008 T1 lands `addSceneRemote` / `removeSceneRemote` in sceneEdit.ts in a
// SEPARATE slice (another agent). To keep T2/T3 tests independent of that file's
// state, partially-mock sceneEdit: pass every real function through (patch /
// generate / reorder / moveInOrder still hit the apiFetch mock) but stub the two
// add/remove wrappers so we can assert ScriptTab calls them with the right args.
const addSceneRemote = vi.fn();
const removeSceneRemote = vi.fn();
vi.mock("./sceneEdit", async () => {
  const actual =
    await vi.importActual<typeof import("./sceneEdit")>("./sceneEdit");
  return {
    ...actual,
    addSceneRemote: (...args: unknown[]) => addSceneRemote(...args),
    removeSceneRemote: (...args: unknown[]) => removeSceneRemote(...args),
  };
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

// S5 — the 剧本 read/write (loadScript / saveScript) use raw `fetch` (a plain
// text/markdown channel, OFF the mocked bridge `apiFetch`). We stub fetch so the
// ScriptTab mount-load resolves to a controllable markdown body and so we can
// assert the editor's PUT. The default body is "" (empty plan).
let scriptFetch: ReturnType<typeof vi.fn>;
function fakeRes(ct: string, body: string): Partial<Response> {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (): string => ct } as unknown as Headers,
    json: async (): Promise<unknown> => ({ ok: true }),
    text: async (): Promise<string> => body,
  };
}
function stubScriptFetch(getBody = "") {
  scriptFetch = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "PUT"
      ? fakeRes("application/json", "")
      : fakeRes("text/markdown; charset=utf-8", getBody),
  );
  vi.stubGlobal("fetch", scriptFetch);
  return scriptFetch;
}

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null });
  useScript.getState().reset();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true });
  addSceneRemote.mockReset();
  // The real addSceneRemote resolves to the new scene's id (string).
  addSceneRemote.mockResolvedValue("s_new");
  removeSceneRemote.mockReset();
  removeSceneRemote.mockResolvedValue({ ok: true });
  stubScriptFetch("");
  useLocaleStore.setState({ locale: "en" });
  try {
    localStorage.removeItem("autoviral.scriptFold.collapsed");
  } catch {
    /* jsdom always has localStorage; guard for safety */
  }
});

// PRD-0008 — each SceneCard is COLLAPSED by default (a read-only summary row);
// the editing controls only exist once expanded (accordion). Click the row's
// expand button to mount the in-card Inspector before asserting on its fields.
async function expandCard(sceneId: string) {
  const card = screen
    .getAllByTestId("scene-card")
    .find((el) => el.getAttribute("data-scene-id") === sceneId)!;
  if (card.getAttribute("data-expanded") === "true") return card;
  // The expand toggle is the row button labelled "Expand shot N".
  const toggle = within(card).getByRole("button", { name: /expand shot/i });
  await userEvent.click(toggle);
  return card;
}

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("seeds the title control and renders a human-friendly shot number (order+1)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    // PRD-0008: the title input lives in the expanded Inspector now.
    await expandCard("s1");
    expect(
      (screen.getByLabelText("Edit shot title") as HTMLInputElement).value,
    ).toBe("Open on the kitchen");
    // order 0 → "Shot 1" (shown in the always-visible summary row).
    expect(screen.getByText(/shot 1/i)).toBeInTheDocument();
  });

  it("renders localised intent / status / shot / camera labels (EN catalog)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    // intent: hook → "Hook" (summary chip). shotSize: long → "Wide" (summary).
    // status: generated → "Generated" (dot aria-label/title, in the summary row).
    expect(screen.getByText("Hook")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Generated" })).toBeInTheDocument();
    expect(screen.getByText("Wide")).toBeInTheDocument();
    // cameraMovement: push → "Push in" — lives in the Inspector; expand to see.
    await expandCard("s1");
    expect(screen.getByText("Push in")).toBeInTheDocument();
  });

  it("seeds prompt, narration, and duration controls from the scene", async () => {
    // PRD-0008: these editable controls live in the expanded Inspector.
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    await expandCard("s1");
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

  it("leaves optional controls UNSET on a sparse scene (no leaked defaults)", async () => {
    // On a sparse scene the Inspector controls must read as unset — empty
    // selects / inputs, never a value leaked from a sibling scene.
    loadScenes([SPARSE_SCENE]);
    render(<ScriptTab />);
    // status: planned → hollow dot, aria-label "Planned" (summary row).
    expect(screen.getByRole("img", { name: "Planned" })).toBeInTheDocument();
    await expandCard("s2");
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

  it("shows the 'no linked script section' note when mdAnchor is missing", async () => {
    loadScenes([SPARSE_SCENE]);
    render(<ScriptTab />);
    await expandCard("s2");
    expect(
      screen.getByText(/no linked script section/i),
    ).toBeInTheDocument();
  });

  it("does NOT show the 'no linked' note when mdAnchor is present", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    await expandCard("s1");
    expect(screen.queryByText(/no linked script section/i)).toBeNull();
  });

  it("shows the onboarding empty state with an add-shot button when the work has no scenes", () => {
    // Existing work, no scenes. PRD-0008 T3 replaces the dead "autoviral scene
    // add" copy with a real PRIMARY add button.
    loadScenes([]);
    render(<ScriptTab />);
    expect(screen.getByText(/no storyboard yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new shot/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scene-card")).toBeNull();
  });

  it("EN locale renders the panel (incl. placeholders + aria) with no Chinese characters", async () => {
    // A SPARSE scene leaves prompt/narration/duration empty so their
    // placeholders render — and we assert over innerHTML (not textContent) so
    // attribute values (placeholder=…, aria-label=…) are covered too.
    loadScenes([SPARSE_SCENE, FULL_SCENE]);
    const { container } = render(<ScriptTab />);
    await expandCard("s2"); // mount the Inspector so its placeholders are checked
    expect(container.innerHTML).not.toMatch(/[一-鿿]/);
  });
});

// ── PRD-0008 T2 — collapsed shot-row + accordion expansion ───────────────────
describe("ScriptTab (T2) — folding shot sheet (collapsed row ↔ inspector)", () => {
  function inCard(sceneId: string) {
    const card = screen
      .getAllByTestId("scene-card")
      .find((el) => el.getAttribute("data-scene-id") === sceneId)!;
    return within(card);
  }

  it("collapsed by default: NO form controls (no textarea / select / edit inputs)", () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);
    // Zero scene-editing controls visible while every card is collapsed.
    expect(screen.queryByLabelText("Edit shot title")).toBeNull();
    expect(screen.queryByLabelText("Edit visual description")).toBeNull();
    expect(screen.queryByLabelText("Set intent")).toBeNull();
    expect(screen.queryByLabelText("Set shot size")).toBeNull();
    expect(screen.queryByLabelText("Set camera movement")).toBeNull();
    expect(screen.queryByLabelText("Edit duration (seconds)")).toBeNull();
    // No <textarea>/<select> anywhere in the card list (the ScriptEditor's own
    // textarea lives above; scope the query to the cards).
    for (const card of screen.getAllByTestId("scene-card")) {
      expect(card.querySelector("textarea")).toBeNull();
      expect(card.querySelector("select")).toBeNull();
      expect(card.querySelector('input[type="text"]')).toBeNull();
    }
  });

  it("clicking a row expands its Inspector (the edit controls appear)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    expect(screen.queryByLabelText("Edit shot title")).toBeNull();
    await expandCard("s1");
    expect(screen.getByLabelText("Edit shot title")).toBeInTheDocument();
  });

  it("accordion: opening a second card collapses the first (only one open)", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);

    await expandCard("s1");
    expect(inCard("s1").getByLabelText("Edit shot title")).toBeInTheDocument();

    await expandCard("s2");
    // s2 now open…
    expect(inCard("s2").getByLabelText("Edit shot title")).toBeInTheDocument();
    // …and s1 collapsed (its inspector controls gone).
    expect(inCard("s1").queryByLabelText("Edit shot title")).toBeNull();
  });

  it("clicking an open row's header collapses it (toggle off)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const card = await expandCard("s1");
    expect(within(card).getByLabelText("Edit shot title")).toBeInTheDocument();
    // Click the (now "Collapse shot 1") header to close.
    await userEvent.click(
      within(card).getByRole("button", { name: /collapse shot/i }),
    );
    expect(within(card).queryByLabelText("Edit shot title")).toBeNull();
  });

  it("a stale scene shows a 'Needs regen' TEXT badge (asserted by text, not colour)", () => {
    loadScenes([{ ...SPARSE_SCENE, status: "stale" }]);
    render(<ScriptTab />);
    // The badge is read by its textContent — never by hue (e2e Hard rule 5).
    expect(screen.getByTestId("stale-badge")).toHaveTextContent(/needs regen/i);
    // And the status dot's accessible name is "Stale".
    expect(screen.getByRole("img", { name: "Stale" })).toBeInTheDocument();
  });

  it("non-stale scenes do NOT show the 'Needs regen' badge", () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]); // generated + planned
    render(<ScriptTab />);
    expect(screen.queryByTestId("stale-badge")).toBeNull();
  });

  it("a successful field edit shows the ✓ saved micro-feedback", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    await expandCard("s1");
    const input = screen.getByLabelText("Edit shot title") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed");
    input.blur();
    // After the PATCH resolves, the ✓ saved status appears (we assert presence,
    // not the fade animation).
    expect(await screen.findByText(/✓ saved/i)).toBeInTheDocument();
  });

  it("the collapsed summary row carries the duration / shot / intent at a glance", () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    const card = inCard("s1");
    // durationSec 4 → "4.0s"
    expect(card.getByTestId("summary-duration")).toHaveTextContent("4.0s");
    expect(card.getByTestId("summary-shot")).toHaveTextContent("Wide");
    expect(card.getByTestId("summary-intent")).toHaveTextContent("Hook");
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
    await expandCard("s1");

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
    await expandCard("s1");
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
    await expandCard("s1");
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
    await expandCard("s1");

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
    await expandCard("s1");
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
    await expandCard("s1");
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
    await expandCard("s1");
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
    await expandCard("s1");
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
    await expandCard("s1"); // ↑↓ controls live in the Inspector

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
    await expandCard("s2");

    const up = screen.getByLabelText("Move shot 2 earlier");
    await userEvent.click(up);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = lastCall();
    expect(path).toBe("/api/bridge/v1/scene/reorder");
    expect(opts.body).toEqual({ orderedSceneIds: ["s2", "s1"] });
  });

  it("move-up is absent on the first card, move-down absent on the last (Inspector)", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);
    // first card (s1): no move-up in its Inspector.
    await expandCard("s1");
    expect(screen.queryByLabelText("Move shot 1 earlier")).toBeNull();
    // last card (s2): no move-down (expanding s2 collapses s1).
    await expandCard("s2");
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
    await expandCard("s1");
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
    await expandCard("s1");

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
    await expandCard("s1");

    const input = screen.getByLabelText("Edit shot title") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "boom");
    input.blur();

    expect(await screen.findByRole("alert")).toHaveTextContent(/scene gone/i);
  });
});

describe("ScriptTab (S7) — generate / reshoot through the per-intent bridge", () => {
  // Reuse the S4 helpers: last apiFetch call + per-card label scoping.
  function lastCall(): [string, { method?: string; headers?: Record<string, string>; body?: any }] {
    const calls = apiFetch.mock.calls;
    return calls[calls.length - 1] as any;
  }
  function inCard(sceneId: string) {
    const card = screen
      .getAllByTestId("scene-card")
      .find((el) => el.getAttribute("data-scene-id") === sceneId)!;
    return within(card);
  }

  it("a planned scene shows '生成此幕' and clicking it POSTs /scene/:id/generate (empty body + work-id header)", async () => {
    // SPARSE_SCENE (s2) is planned → the generate button (not reshoot).
    loadScenes([SPARSE_SCENE]);
    render(<ScriptTab />);
    await expandCard("s2"); // generate CTA lives in the Inspector

    const btn = inCard("s2").getByRole("button", { name: "Generate this shot" });
    await userEvent.click(btn);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = lastCall();
    expect(path).toBe("/api/bridge/v1/scene/s2/generate");
    expect(opts.method).toBe("POST");
    expect(opts.headers?.["X-AutoViral-Work-Id"]).toBe("w1");
    // Prompt is built server-side from the scene's own fields — body is empty.
    expect(opts.body).toEqual({});
  });

  it("a GENERATED scene shows '重拍' (reshoot), and clicking it hits the SAME generate route again", async () => {
    // FULL_SCENE (s1) is generated → reshoot label, not "Generate this shot".
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    await expandCard("s1");

    // The generate label must be absent on a generated scene.
    expect(
      screen.queryByRole("button", { name: "Generate this shot" }),
    ).toBeNull();
    const reshoot = inCard("s1").getByRole("button", { name: "Reshoot" });
    await userEvent.click(reshoot);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = lastCall();
    expect(path).toBe("/api/bridge/v1/scene/s1/generate");
    expect(opts.method).toBe("POST");
  });

  it("a generated scene whose selectedAssetId ∈ comp.assets renders the thumbnail <img> with the works-route src", () => {
    // Build a comp with an image asset and a scene that selects it. The
    // selectedAssetId resolves to comp.assets → a thumbnail <img> is rendered.
    const comp = makeEmptyComposition({ workId: "w1" });
    (comp as any).assets = [
      { id: "gen_abc", uri: "scene_s1_1.png", kind: "image", status: "ready", metadata: {} },
    ];
    (comp as { scenes?: Scene[] }).scenes = [
      {
        ...FULL_SCENE,
        generatedAssetIds: ["gen_abc"],
        selectedAssetId: "gen_abc",
        status: "generated",
      },
    ];
    useComposition.getState().loadComposition(comp);
    render(<ScriptTab />);

    const img = inCard("s1").getByTestId("scene-thumb") as HTMLImageElement;
    // resolveAssetUrl turns the bare-filename uri into the works-route src.
    expect(img.getAttribute("src")).toBe("/api/works/w1/assets/scene_s1_1.png");
  });

  it("a generated scene whose selectedAssetId is NOT in comp.assets shows NO broken <img> (just the dot)", () => {
    const comp = makeEmptyComposition({ workId: "w1" });
    (comp as any).assets = []; // registry empty → unresolved
    (comp as { scenes?: Scene[] }).scenes = [
      { ...FULL_SCENE, selectedAssetId: "gen_missing", status: "generated" },
    ];
    useComposition.getState().loadComposition(comp);
    render(<ScriptTab />);

    expect(screen.queryByTestId("scene-thumb")).toBeNull();
    // The status dot still encodes the generated state.
    expect(screen.getByRole("img", { name: "Generated" })).toBeInTheDocument();
  });

  it("generate/reshoot goes through apiFetch (the per-intent bridge), NEVER the store/autosave", async () => {
    loadScenes([SPARSE_SCENE]);
    // Spy on loadComposition — the ONLY store action that may rewrite scenes.
    const loadSpy = vi.spyOn(useComposition.getState(), "loadComposition");
    render(<ScriptTab />);
    await expandCard("s2");

    await userEvent.click(
      inCard("s2").getByRole("button", { name: "Generate this shot" }),
    );
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());

    // The write rode the bridge…
    expect(apiFetch.mock.calls[0][0]).toBe("/api/bridge/v1/scene/s2/generate");
    // …and NOTHING wrote the store locally (no autosave / no loadComposition).
    expect(loadSpy).not.toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  it("surfaces a friendly error (role=alert) when generation fails", async () => {
    apiFetch.mockReset();
    apiFetch.mockRejectedValue(
      new ApiError("500", 500, { error: "provider down" }),
    );
    loadScenes([SPARSE_SCENE]);
    render(<ScriptTab />);
    await expandCard("s2");

    await userEvent.click(
      inCard("s2").getByRole("button", { name: "Generate this shot" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/provider down/i);
  });
});

describe("ScriptTab (S5) — 剧本 plan/script.md editor above the cards", () => {
  // The editor lives ABOVE the storyboard cards (PRD §7). It reads the markdown
  // from the on-disk plan/script.md (loadScript on mount → useScript store) and
  // commits edits straight to disk via saveScript (raw text/markdown PUT) — the
  // SAME write path the agent's `autoviral script edit` CLI uses (ADR-009).

  function lastPut(): RequestInit | undefined {
    const put = scriptFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    return put?.[1] as RequestInit | undefined;
  }

  it("seeds the script textarea from the on-disk markdown (loadScript on mount)", async () => {
    stubScriptFetch("# Theme\n\nThe whole arc.\n");
    loadScenes([]);
    render(<ScriptTab />);

    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    expect(ta.value).toBe("# Theme\n\nThe whole arc.\n");
    // The GET hit the works-route plain-text channel, NOT the bridge apiFetch.
    const [getUrl] = scriptFetch.mock.calls[0]!;
    expect(getUrl).toBe("/api/works/w1/plan/script.md");
  });

  it("editing the script then blurring PUTs the RAW markdown body (not JSON)", async () => {
    loadScenes([]);
    render(<ScriptTab />);

    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    await userEvent.clear(ta);
    await userEvent.type(ta, "# New outline");
    ta.blur();

    await waitFor(() => expect(lastPut()).toBeDefined());
    const put = lastPut()!;
    expect(put.method).toBe("PUT");
    // RAW string — never JSON.stringify'd (which would quote + break c.req.text()).
    expect(put.body).toBe("# New outline");
    const ct = (put.headers as Record<string, string>)["content-type"];
    expect(ct).toContain("text/markdown");
    // Targets the works route plain-text channel.
    const putUrl = scriptFetch.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === "PUT",
    )![0];
    expect(putUrl).toBe("/api/works/w1/plan/script.md");
  });

  it("does NOT PUT when the script is blurred unchanged", async () => {
    stubScriptFetch("# unchanged\n");
    loadScenes([]);
    render(<ScriptTab />);

    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    expect(ta.value).toBe("# unchanged\n");
    ta.focus();
    ta.blur();
    await new Promise((r) => setTimeout(r, 0));
    expect(lastPut()).toBeUndefined();
  });

  it("toggles between edit (textarea) and react-markdown preview", async () => {
    stubScriptFetch("# Heading One\n\nbody text here\n");
    loadScenes([]);
    render(<ScriptTab />);

    // Starts in edit mode: textarea present.
    await screen.findByLabelText("Edit script");

    // Switch to preview → textarea gone, rendered markdown shown (the heading
    // text appears as real HTML, not the raw "# Heading One").
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.queryByLabelText("Edit script")).toBeNull();
    const preview = screen.getByTestId("script-preview");
    expect(within(preview).getByText("Heading One")).toBeInTheDocument();
    // The "#" markdown syntax must NOT survive into the rendered preview.
    expect(preview.textContent).not.toContain("# Heading One");

    // Switch back to edit → textarea returns, still seeded.
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      (screen.getByLabelText("Edit script") as HTMLTextAreaElement).value,
    ).toBe("# Heading One\n\nbody text here\n");
  });

  it("shows a localized placeholder when the script is empty (NOT a hardcoded template)", async () => {
    stubScriptFetch(""); // empty plan → "" from disk, no template
    loadScenes([]);
    render(<ScriptTab />);

    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    // The textarea VALUE is empty — the empty-state copy is a placeholder
    // ATTRIBUTE, never written into the data (avoids #73/#83).
    expect(ta.value).toBe("");
    expect(ta.placeholder.length).toBeGreaterThan(0);
    expect(ta.placeholder).toMatch(/script|outline|narrative/i);
    // No PUT was fired just by rendering the empty editor (we never persist a
    // template).
    expect(lastPut()).toBeUndefined();
  });

  it("renders the honest drift notice (剧本与分镜独立维护、可能不同步)", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    await screen.findByLabelText("Edit script");
    // The notice warns the two surfaces are independently maintained.
    expect(
      screen.getByText(/independently|may drift|separately/i),
    ).toBeInTheDocument();
  });

  it("external plan-changed → store refresh reflows the textarea when NOT focused", async () => {
    stubScriptFetch("first\n");
    loadScenes([]);
    render(<ScriptTab />);

    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    expect(ta.value).toBe("first\n");

    // Simulate the refetchScript path landing a new on-disk value (an external
    // editor / the agent's CLI wrote plan/script.md → plan-changed → setScript).
    // The editor is NOT focused, so it must reflow to the fresh value. The
    // landing is stamped with this work's id (w1) — its rightful tenant.
    useScript.getState().setScript("w1", "second (external edit)\n");
    await waitFor(() => expect(ta.value).toBe("second (external edit)\n"));
  });

  it("external plan-changed does NOT clobber an in-flight edit while focused", async () => {
    stubScriptFetch("first\n");
    loadScenes([]);
    render(<ScriptTab />);

    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    await userEvent.clear(ta);
    await userEvent.type(ta, "user is typing");
    expect(document.activeElement).toBe(ta);

    // A store refresh arrives MID-edit. Because the field is focused, the
    // user's draft must survive (mirror S4 EditableText reflow guard).
    useScript.getState().setScript("w1", "server overwrote\n");
    await new Promise((r) => setTimeout(r, 0));
    expect(ta.value).toBe("user is typing");
  });

  it("hasScript and hasScenes are independent — no-script + no-scenes shows both states without implying each other", async () => {
    // Existing work: empty plan AND zero scenes. The editor still renders its
    // (empty) textarea with placeholder, AND the cards area shows its own
    // storyboard onboarding — neither fabricates the other.
    stubScriptFetch("");
    loadScenes([]);
    render(<ScriptTab />);

    // Script side: an editable empty textarea (placeholder, no fake content).
    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    expect(ta.value).toBe("");
    // Storyboard side: its OWN onboarding, unchanged from S3.
    expect(screen.getByText(/no storyboard yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("scene-card")).toBeNull();
  });

  it("EN locale renders the editor (incl. placeholder + drift notice + aria) with no Chinese characters", async () => {
    stubScriptFetch(""); // empty → placeholder shows
    loadScenes([]);
    const { container } = render(<ScriptTab />);
    await screen.findByLabelText("Edit script");
    // innerHTML (not textContent) so placeholder=… / aria-label=… attributes are
    // covered too — a Chinese leak in a placeholder would slip past textContent.
    expect(container.innerHTML).not.toMatch(/[一-鿿]/);
  });

  it("ZH locale localizes the editor chrome (placeholder + drift notice)", async () => {
    useLocaleStore.setState({ locale: "zh" });
    stubScriptFetch("");
    loadScenes([]);
    render(<ScriptTab />);
    const ta = await screen.findByLabelText<HTMLTextAreaElement>("编辑剧本");
    // Placeholder is the ZH copy (Chinese chars present).
    expect(ta.placeholder).toMatch(/[一-鿿]/);
    // Drift notice localized.
    expect(screen.getByText(/独立维护|可能不同步/)).toBeInTheDocument();
  });
});

describe("ScriptTab (S5·review fixes) — cross-work tenancy + honest load errors", () => {
  // Build a comp for an arbitrary workId (the shared loadScenes helper hardcodes
  // "w1"; these tests need to SWITCH works to prove no bleed).
  function loadWork(workId: string) {
    const comp = makeEmptyComposition({ workId });
    (comp as { scenes?: Scene[] }).scenes = [];
    useComposition.getState().loadComposition(comp);
  }

  it("HIGH: switching works clears the previous work's 剧本 (no cross-work bleed)", async () => {
    // Work w1 loads its own outline.
    stubScriptFetch("A-only outline\n");
    loadWork("w1");
    const { rerender } = render(<ScriptTab />);
    const ta = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    await waitFor(() => expect(ta.value).toBe("A-only outline\n"));

    // Switch to work w2 with a DIFFERENT on-disk script. The editor must reflow
    // to w2's script — never show w1's — even though useScript is one global store.
    stubScriptFetch("B-only outline\n");
    loadWork("w2");
    rerender(<ScriptTab />);

    const taB = await screen.findByLabelText<HTMLTextAreaElement>("Edit script");
    await waitFor(() => expect(taB.value).toBe("B-only outline\n"));
    expect(taB.value).not.toContain("A-only");
  });

  it("HIGH: editor stays read-only with NO foreign content until THIS work's script loads", async () => {
    // Pre-seed the store as work "wOther"'s, then mount the editor for w1 with a
    // GET that never resolves. The editor must NOT leak wOther's content and must
    // be read-only (so a foreign-work draft can never be committed into w1).
    scriptFetch = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? Promise.resolve(fakeRes("application/json", ""))
        : new Promise<Partial<Response>>(() => {}),
    ) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", scriptFetch);
    useScript.setState({
      workId: "wOther",
      script: "wOther secret outline",
      loaded: true,
    });
    loadWork("w1");
    render(<ScriptTab />);

    const ta = screen.getByLabelText("Edit script") as HTMLTextAreaElement;
    expect(ta.value).not.toContain("wOther secret");
    expect(ta.value).toBe("");
    expect(ta.readOnly).toBe(true);
  });

  it("MEDIUM: a mount-load failure surfaces an error (role=alert), not a silent blank editor", async () => {
    // GET fails (500). Previously the .catch swallowed it and the editor sat
    // blank with no signal; now it must show a localized load-error alert.
    scriptFetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? fakeRes("application/json", "")
        : ({
            ok: false,
            status: 500,
            statusText: "Server Error",
            headers: { get: (): string => "application/json" } as unknown as Headers,
            json: async (): Promise<unknown> => ({ error: "disk on fire" }),
            text: async (): Promise<string> => "",
          } as Partial<Response>),
    ) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", scriptFetch);
    loadWork("w1");
    render(<ScriptTab />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/disk on fire/i);
  });
});

// ── PRD-0008 T3 — ⋯ menu (reorder/delete) + new/delete shot ──────────────────
describe("ScriptTab (T3) — ⋯ row menu, add & delete shots", () => {
  function inCard(sceneId: string) {
    const card = screen
      .getAllByTestId("scene-card")
      .find((el) => el.getAttribute("data-scene-id") === sceneId)!;
    return within(card);
  }
  async function openMenu(sceneId: string) {
    await userEvent.click(
      inCard(sceneId).getByRole("button", { name: /shot \d+ actions/i }),
    );
  }

  it("the empty-state add button calls addSceneRemote with the localized placeholder title", async () => {
    loadScenes([]);
    render(<ScriptTab />);
    await userEvent.click(screen.getByRole("button", { name: /new shot/i }));
    await waitFor(() => expect(addSceneRemote).toHaveBeenCalled());
    expect(addSceneRemote).toHaveBeenCalledWith("w1", { title: "Untitled shot" });
  });

  it("the footer add button (with existing scenes) also calls addSceneRemote", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    // There's exactly one "New shot" button (the footer) when scenes exist.
    await userEvent.click(screen.getByRole("button", { name: /new shot/i }));
    await waitFor(() => expect(addSceneRemote).toHaveBeenCalled());
    expect(addSceneRemote).toHaveBeenCalledWith("w1", { title: "Untitled shot" });
  });

  it("a freshly-added scene auto-expands once it appears via refetch", async () => {
    loadScenes([FULL_SCENE]);
    render(<ScriptTab />);
    await userEvent.click(screen.getByRole("button", { name: /new shot/i }));
    await waitFor(() => expect(addSceneRemote).toHaveBeenCalled());

    // Simulate the composition-changed → refetch landing the new scene (the
    // bridge appended it; the store mirror updates). It carries the placeholder
    // title the panel sent, so the panel must auto-expand it.
    const newScene: Scene = {
      id: "s_new",
      order: 1,
      title: "Untitled shot",
      memberClipIds: [],
      memberAssetIds: [],
      generatedAssetIds: [],
      status: "planned",
    };
    act(() => loadScenes([FULL_SCENE, newScene]));

    // The new card's Inspector is open (its title input is mounted + seeded).
    await waitFor(() =>
      expect(inCard("s_new").getByLabelText("Edit shot title")).toBeInTheDocument(),
    );
  });

  it("a failed add surfaces a role=alert error (does not crash)", async () => {
    addSceneRemote.mockReset();
    addSceneRemote.mockRejectedValue(
      new ApiError("500", 500, { error: "disk full" }),
    );
    loadScenes([]);
    render(<ScriptTab />);
    await userEvent.click(screen.getByRole("button", { name: /new shot/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/disk full/i);
  });

  it("the ⋯ menu reorder items call onMove (move up / move down) via the bridge", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);
    // Open shot 1's menu → only "Move down" (it's first).
    await openMenu("s1");
    await userEvent.click(screen.getByRole("menuitem", { name: /move down/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [path, opts] = apiFetch.mock.calls[apiFetch.mock.calls.length - 1] as [
      string,
      { body?: any },
    ];
    expect(path).toBe("/api/bridge/v1/scene/reorder");
    expect(opts.body).toEqual({ orderedSceneIds: ["s2", "s1"] });
  });

  it("delete is a TWO-STEP confirm: first click arms, second click removes", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);
    await openMenu("s1");

    // First click: arms confirm — does NOT delete yet.
    await userEvent.click(screen.getByRole("menuitem", { name: /^delete shot$/i }));
    expect(removeSceneRemote).not.toHaveBeenCalled();
    // The item now reads "Confirm delete?".
    const confirm = screen.getByRole("menuitem", { name: /confirm delete/i });
    // Second click: actually removes via the bridge.
    await userEvent.click(confirm);
    await waitFor(() => expect(removeSceneRemote).toHaveBeenCalledWith("w1", "s1"));
  });

  it("clicking away (outside the menu) cancels an armed delete — no removal", async () => {
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);
    await openMenu("s1");
    // Arm confirm.
    await userEvent.click(screen.getByRole("menuitem", { name: /^delete shot$/i }));
    expect(screen.getByRole("menuitem", { name: /confirm delete/i })).toBeInTheDocument();

    // Click outside the menu (the panel heading). The menu closes; nothing removed.
    await userEvent.click(screen.getByText(/script & storyboard/i));
    expect(removeSceneRemote).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: /confirm delete/i })).toBeNull();
  });

  it("a failed delete surfaces a role=alert error", async () => {
    removeSceneRemote.mockReset();
    removeSceneRemote.mockRejectedValue(
      new ApiError("404", 404, { error: "already gone" }),
    );
    loadScenes([FULL_SCENE, SPARSE_SCENE]);
    render(<ScriptTab />);
    await openMenu("s1");
    await userEvent.click(screen.getByRole("menuitem", { name: /^delete shot$/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /confirm delete/i }));
    // The wrapper copy must be the DELETE-specific key, not the generic
    // saveFailed fallback ("Couldn't save…") — a delete failure that claims a
    // save failure is misleading copy (review MED on PRD-0008).
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't delete the shot/i);
    expect(alert).toHaveTextContent(/already gone/i);
  });
});

// ── PRD-0008 T4 — script fold toggle ─────────────────────────────────────────
describe("ScriptTab (T4) — script editor fold toggle", () => {
  it("the script editor is expanded by default (textarea present) with a collapse toggle", async () => {
    loadScenes([]);
    render(<ScriptTab />);
    // Default = expanded → the editor's textarea is mounted.
    await screen.findByLabelText("Edit script");
    // And there's a fold toggle (currently "Collapse script").
    expect(
      screen.getByRole("button", { name: /collapse script/i }),
    ).toBeInTheDocument();
  });

  it("clicking the fold toggle collapses the editor (textarea gone) and flips the label", async () => {
    loadScenes([]);
    render(<ScriptTab />);
    await screen.findByLabelText("Edit script");

    await userEvent.click(
      screen.getByRole("button", { name: /collapse script/i }),
    );
    // Collapsed: the editor textarea is unmounted; the toggle now says "Expand".
    expect(screen.queryByLabelText("Edit script")).toBeNull();
    expect(
      screen.getByRole("button", { name: /expand script/i }),
    ).toBeInTheDocument();

    // Toggle back → editor returns.
    await userEvent.click(screen.getByRole("button", { name: /expand script/i }));
    expect(await screen.findByLabelText("Edit script")).toBeInTheDocument();
  });

  it("remembers the collapsed state across remounts (localStorage)", async () => {
    localStorage.setItem("autoviral.scriptFold.collapsed", "1");
    loadScenes([]);
    render(<ScriptTab />);
    // Persisted collapsed → the editor starts collapsed (no textarea) and the
    // toggle offers to expand.
    expect(screen.queryByLabelText("Edit script")).toBeNull();
    expect(
      screen.getByRole("button", { name: /expand script/i }),
    ).toBeInTheDocument();
  });
});
