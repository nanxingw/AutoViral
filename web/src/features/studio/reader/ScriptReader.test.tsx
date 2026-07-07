import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, act, waitFor } from "@testing-library/react";
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
  useReader.setState({ open: true });
  useDive.setState({ pendingSceneJump: null, open: false });
  useComposition.setState({ comp: null, selection: null });
  useScript.setState({ workId: null, script: "", loaded: false, loading: false });
  loadScriptMock.mockReset();
  loadScriptMock.mockResolvedValue("");
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

  it("the per-card edit button jumps the sidebar to that scene and closes the reader", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const editBtn = screen.getByTestId("reader-edit-scene");
    editBtn.click();
    expect(useDive.getState().pendingSceneJump).toBe("sc1");
    expect(useReader.getState().open).toBe(false);
  });

  // ── regression net (codex review #2) ────────────────────────────────────────
  // ESC-close, ARIA dialog labelling, focus-trap (the aria-modal contract),
  // focus restore-on-close, and IntersectionObserver disconnect on unmount.

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

  it("marks the dialog aria-modal and labels it via aria-labelledby", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "reader-title");
    // The label target actually exists and carries the reader's title.
    expect(document.getElementById("reader-title")?.textContent).toBe(
      "Read-through",
    );
  });

  it("traps Tab focus inside the dialog: forward Tab wraps last→first", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const dialog = screen.getByRole("dialog");
    const buttons = Array.from(dialog.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(1);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("traps Tab focus inside the dialog: Shift+Tab wraps first→last", () => {
    seed({
      script: "# One\nBody.",
      sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
    });
    render(<ScriptReader />);
    const dialog = screen.getByRole("dialog");
    const buttons = Array.from(dialog.querySelectorAll("button"));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the opener when the reader closes", () => {
    vi.useFakeTimers();
    try {
      seed({
        script: "# One\nBody.",
        sceneIds: [{ id: "sc1", order: 0, title: "A", mdAnchor: "One" }],
      });
      const opener = document.createElement("button");
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      render(<ScriptReader />);
      // useModalFocus moves focus into the modal on a setTimeout(0).
      act(() => {
        vi.runOnlyPendingTimers();
      });
      expect(document.activeElement).not.toBe(opener);

      act(() => {
        useReader.setState({ open: false });
      });
      expect(document.activeElement).toBe(opener);
      opener.remove();
    } finally {
      vi.useRealTimers();
    }
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
