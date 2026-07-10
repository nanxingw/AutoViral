import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, act, waitFor } from "@testing-library/react";
import { ScriptReader } from "./ScriptReader";
import { useReader } from "./readerStore";
import { useComposition } from "../store";
import { useScript } from "../scriptStore";
import { useDive } from "../dive/diveStore";
import { loadScript } from "../services/script";
import { makeAssetGraph, makeScene } from "../../../test/composition-fixtures";

// F1 — the reader must load the 剧本 itself when opened from a surface where the
// SCRIPT tab (the other loadScript caller) was never mounted. Mock the plain-text
// script service so we can assert the reader fires (or dedups) the fetch.
vi.mock("../services/script", () => ({
  loadScript: vi.fn(),
  saveScript: vi.fn(),
}));
const loadScriptMock = vi.mocked(loadScript);

// ScriptReader render contract — under mocked store data, assert the single
// interleaved flow: prose segment → its anchored scene card, unmatched scenes in
// the 分镜册 section, the right-edge mini-TOC has one entry per scene, and the
// empty state shows when there's nothing to read.

function seed(opts: { script: string; sceneIds?: Parameters<typeof makeScene>[0][] }) {
  const comp = makeAssetGraph({ ids: ["a1"], workId: "w1" });
  comp.scenes = (opts.sceneIds ?? []).map((o) => makeScene(o));
  useComposition.setState({ comp, selection: null });
  useScript.setState({ workId: "w1", script: opts.script, loaded: true });
}

beforeEach(() => {
  useReader.setState({ open: true, focusSceneId: null });
  useDive.setState({ pendingSceneJump: null, open: false });
  useComposition.setState({ comp: null, selection: null });
  useScript.setState({ workId: null, script: "", loaded: false, loading: false });
  loadScriptMock.mockReset();
  loadScriptMock.mockResolvedValue("");
});

// The focus-scroll tests stub Element.prototype.scrollIntoView — restore the
// original (possibly undefined in this DOM) so other suites aren't polluted.
const origScrollIntoView = Element.prototype.scrollIntoView;
afterEach(() => {
  Element.prototype.scrollIntoView = origScrollIntoView;
});

describe("ScriptReader", () => {
  it("interleaves anchored scene cards after their heading, unmatched under 分镜册", () => {
    seed({
      script: ["# Opening", "Hook.", "## Payoff", "End."].join("\n"),
      sceneIds: [
        { id: "sc1", order: 0, title: "Hook shot", mdAnchor: "Opening" },
        { id: "sc2", order: 1, title: "Loose shot" }, // no anchor → trailing
      ],
    });
    render(<ScriptReader />);
    // Both cards render.
    const cards = screen.getAllByTestId("reader-scene-card");
    expect(cards).toHaveLength(2);
    // The anchored card is present with its scene id + title.
    expect(screen.getByText("Hook shot")).toBeTruthy();
    // The unmatched card lives in the storyboard (分镜册) trailing section.
    expect(screen.getByTestId("reader-storyboard-section")).toBeTruthy();
    const trailing = screen.getByTestId("reader-storyboard-section");
    expect(within(trailing).getByText("Loose shot")).toBeTruthy();
  });

  it("gives the mini-TOC one entry per scene, in reading order", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [
        { id: "sc1", order: 0, title: "A", mdAnchor: "One" },
        { id: "sc2", order: 1, title: "B" },
        { id: "sc3", order: 2, title: "C" },
      ],
    });
    render(<ScriptReader />);
    expect(screen.getAllByTestId("reader-toc-item")).toHaveLength(3);
  });

  it("renders pure prose (no cards, no TOC) when there are no scenes", () => {
    seed({ script: "# Only prose\nNo shots here.", sceneIds: [] });
    render(<ScriptReader />);
    expect(screen.queryAllByTestId("reader-scene-card")).toHaveLength(0);
    expect(screen.queryAllByTestId("reader-toc-item")).toHaveLength(0);
    expect(screen.queryByTestId("reader-empty")).toBeNull();
  });

  it("shows the empty state when there's no script AND no scenes", () => {
    seed({ script: "", sceneIds: [] });
    render(<ScriptReader />);
    expect(screen.getByTestId("reader-empty")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    seed({ script: "# X\nY.", sceneIds: [{ id: "sc1", order: 0, title: "A" }] });
    useReader.setState({ open: false });
    render(<ScriptReader />);
    expect(screen.queryByTestId("reader-scene-card")).toBeNull();
  });

  it("the per-card edit button jumps the sidebar to that scene and KEEPS the reader open", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const editBtn = screen.getByTestId("reader-edit-scene");
    editBtn.click();
    expect(useDive.getState().pendingSceneJump).toBe("sc1");
    // Docked panel: sidebar editing and center reading COEXIST — the jump must
    // not tear down the reading surface the user is standing in.
    expect(useReader.getState().open).toBe(true);
  });

  // ── docked-panel contract ────────────────────────────────────────────────────
  // The reader is a center-column DOCKED panel now, not a fullscreen modal: no
  // backdrop, no aria-modal, no focus trap. It's a labelled region so assistive
  // tech can land on it, and ESC still closes — except while the user is typing
  // in an editable field (the sidebar edit surface stays live alongside).

  it("closes on Escape", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    expect(useReader.getState().open).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useReader.getState().open).toBe(false);
  });

  it("closes on Escape bubbled from a focused BUTTON (E2E false-positive net)", () => {
    // E2E R1 reported "ESC ignored while the theme-toggle button is focused";
    // source audit found NO stopPropagation anywhere on that path, pointing to
    // an occluded-tab focus-theft artifact. This pins the contract at the unit
    // level: a keydown dispatched ON a focused non-editable button must bubble
    // to the window listener and close the panel.
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Switch to light theme");
    document.body.appendChild(btn);
    btn.focus();
    act(() => {
      btn.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(useReader.getState().open).toBe(false);
    btn.remove();
  });

  it("does NOT close on Escape while focus is in an editable field", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useReader.getState().open).toBe(true);
    input.remove();
  });

  it("renders as a non-modal labelled region — no backdrop, no aria-modal, no dialog role", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    expect(screen.queryByTestId("reader-backdrop")).toBeNull();
    expect(document.querySelector("[aria-modal]")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // A labelled region whose accessible name is the reader title.
    const region = screen.getByRole("region", { name: "Read-through" });
    expect(region).toBeTruthy();
  });

  // ── focus-scene deep link (sidebar ⤢ → docked panel) ───────────────────────
  // Opening from a scene card carries focusSceneId; the reader scrolls that
  // card into view and consumes the request. A second ⤢ while already open
  // must scroll again (the panel follows the sidebar).

  it("scrolls the focused card into view on open and consumes the focus request", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    seed({
      script: "# One\nBody.",
      sceneIds: [
        { id: "sc1", order: 0, title: "A", mdAnchor: "One" },
        { id: "sc2", order: 1, title: "B" },
      ],
    });
    useReader.setState({ open: true, focusSceneId: "sc2" });
    render(<ScriptReader />);
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(useReader.getState().focusSceneId).toBeNull();
  });

  it("a new focus target arriving while already open scrolls again", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    seed({
      script: "# One\nBody.",
      sceneIds: [
        { id: "sc1", order: 0, title: "A", mdAnchor: "One" },
        { id: "sc2", order: 1, title: "B" },
      ],
    });
    render(<ScriptReader />);
    act(() => {
      useReader.getState().openReader("w1", { focusSceneId: "sc1" });
    });
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1));
    act(() => {
      useReader.getState().openReader("w1", { focusSceneId: "sc2" });
    });
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(2));
  });

  // ── F1: self-load when opened from a surface where ScriptTab never mounted ──
  // Regression: opening READ from the LIBRARY sidebar tab (ScriptTab unmounted)
  // left the useScript store empty, so scriptText was "" and every scene fell
  // into the trailing 分镜册 bucket — a silent non-interleaved degradation.

  // Set up the exact broken state: a comp with an anchored scene is present, but
  // the script store is FRESH (no ScriptTab ever loaded it).
  function seedUnloaded() {
    const comp = makeAssetGraph({ ids: ["a1"], workId: "w1" });
    comp.scenes = [
      makeScene({ id: "sc1", order: 0, title: "Hook shot", mdAnchor: "Opening" }),
    ];
    useComposition.setState({ comp, selection: null });
    useScript.setState({ workId: null, script: "", loaded: false, loading: false });
  }

  it("self-loads the script when opened for a work whose script isn't in the store", async () => {
    loadScriptMock.mockResolvedValue("# Opening\nHook.");
    seedUnloaded();
    render(<ScriptReader />);
    // Fetched through the shared plain-text service, stamped with this work's id.
    await waitFor(() => expect(loadScriptMock).toHaveBeenCalledWith("w1"));
    // Once it resolves the prose + anchored card interleave — NOT the degraded
    // all-trailing 分镜册 view the bug produced.
    await screen.findByText("Hook shot");
    expect(screen.queryByTestId("reader-storyboard-section")).toBeNull();
  });

  it("shows a lightweight loading state while the self-load is in flight (not the degraded view)", async () => {
    let resolve!: (md: string) => void;
    loadScriptMock.mockReturnValue(new Promise<string>((r) => (resolve = r)));
    seedUnloaded();
    render(<ScriptReader />);
    // Before the fetch resolves: a loading placeholder, and crucially NOT the
    // trailing 分镜册 bucket (which is the silent-degradation symptom).
    expect(await screen.findByTestId("reader-loading")).toBeTruthy();
    expect(screen.queryByTestId("reader-storyboard-section")).toBeNull();
    // Resolve → the loading state gives way to the interleaved flow.
    act(() => resolve("# Opening\nHook."));
    await screen.findByText("Hook shot");
    expect(screen.queryByTestId("reader-loading")).toBeNull();
  });

  it("does NOT re-fetch when the store already holds this work's script (isMine)", async () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    await screen.findByText("A");
    expect(loadScriptMock).not.toHaveBeenCalled();
  });

  it("does NOT re-fetch when a load is already in flight (ScriptTab mounted) — dedup", async () => {
    const comp = makeAssetGraph({ ids: ["a1"], workId: "w1" });
    comp.scenes = [makeScene({ id: "sc1", order: 0, title: "A" })];
    useComposition.setState({ comp, selection: null });
    // ScriptTab already kicked off a load: loading:true, not yet loaded.
    useScript.setState({ workId: "w1", script: "", loaded: false, loading: true });
    render(<ScriptReader />);
    await new Promise((r) => setTimeout(r, 0));
    expect(loadScriptMock).not.toHaveBeenCalled();
    // While that other load is in flight we still show the loading state, not the
    // degraded all-trailing flow.
    expect(screen.getByTestId("reader-loading")).toBeTruthy();
  });

  // ── S2 (PRD-0013): icon-button collection ──────────────────────────────────
  // The header close button is the截图 defect本体 — a 28×28 icon control that the
  // leaked global pill padding shoved off-centre. It must now be an IconButton:
  // an SVG glyph (not the Unicode "×" text node) inside the shared data-icon-button
  // shell. Behaviour (closeReader on click) is unchanged.
  it("close button is a shared IconButton (data-icon-button + SVG, not a text ×)", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const closeBtn = screen.getByRole("button", { name: "Close the reader" });
    expect(closeBtn).toHaveAttribute("data-icon-button");
    expect(closeBtn.querySelector("svg")).not.toBeNull();
    // The bare Unicode glyph must no longer be a text child.
    expect(closeBtn.textContent).not.toContain("×");
    closeBtn.click();
    expect(useReader.getState().open).toBe(false);
  });

  // Reverse assertions — the collection must NOT swallow every aria-labelled
  // button. The mini-TOC entries render镜号 numbers and the per-card edit button
  // renders localized text; both would break under line-height:0 / SVG-only
  // IconButton chrome, so they must stay plain buttons.
  it("does NOT convert the mini-TOC number buttons or the edit text button to IconButton", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    for (const toc of screen.getAllByTestId("reader-toc-item")) {
      expect(toc).not.toHaveAttribute("data-icon-button");
    }
    expect(screen.getByTestId("reader-edit-scene")).not.toHaveAttribute(
      "data-icon-button",
    );
  });

  it("disconnects the IntersectionObserver on unmount", () => {
    const disconnect = vi.fn();
    class MockIO {
      constructor(_cb: IntersectionObserverCallback) {}
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnect;
      takeRecords = () => [];
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    vi.stubGlobal("IntersectionObserver", MockIO as unknown as typeof IntersectionObserver);
    try {
      seed({
        script: "# One\nBody.",
        sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
      });
      const { unmount } = render(<ScriptReader />);
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
