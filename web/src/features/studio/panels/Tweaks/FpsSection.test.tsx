// PRD-0011 F3 — canvas-fps segmented control. Mirrors the PlatformPresetSection
// test pattern (same file, same fixtures), but the setFps store action is a
// PURE local immer write (no fetch/bridge — see store.ts setFps for the
// architecture note), so unlike PlatformPresetSection's tests we do NOT mock
// `fetch` here: we assert directly against `useComposition.getState().comp`.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FpsSection } from "./FpsSection";
import { useComposition } from "../../store";
import { useToastStore } from "@/stores/toast";
import { makeCompositionWithClips } from "../../../../test/composition-fixtures";

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null, currentFrame: 0, isPlaying: false });
  useToastStore.getState().clear();
});

describe("FpsSection (PRD-0011 F3)", () => {
  it("renders all four fps options and highlights the current value", () => {
    const comp = makeCompositionWithClips([]);
    comp.fps = 30;
    useComposition.setState({ comp });
    render(<FpsSection />);
    expect(screen.getByRole("group", { name: /frame rate/i })).toBeInTheDocument();
    const active = screen.getByRole("button", { name: "30" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    for (const v of ["24", "25", "60"]) {
      expect(screen.getByRole("button", { name: v })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("clicking 24 updates comp.fps via the store action (no fetch — pure local write)", () => {
    const comp = makeCompositionWithClips([]);
    comp.fps = 30;
    useComposition.setState({ comp });
    render(<FpsSection />);
    fireEvent.click(screen.getByRole("button", { name: "24" }));
    expect(useComposition.getState().comp!.fps).toBe(24);
  });

  it("renders the explanation copy about playback clock & export frame rate", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<FpsSection />);
    expect(screen.getByText(/playback clock/i)).toBeInTheDocument();
  });

  it("annotates the 24 option as the Seedance-recommended default", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<FpsSection />);
    expect(screen.getByText(/Seedance/i)).toBeInTheDocument();
  });
});
