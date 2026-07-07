import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import { ScriptReader } from "./ScriptReader";
import { useReader } from "./readerStore";
import { useComposition } from "../store";
import { useScript } from "../scriptStore";
import { useDive } from "../dive/diveStore";
import { makeAssetGraph, makeScene } from "../../../test/composition-fixtures";

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
  useScript.setState({ workId: null, script: "", loaded: false });
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
