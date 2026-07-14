import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StaticPropsPanel } from "./StaticPropsPanel";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";
import type { Composition, VideoClip } from "../../types";

// PRD-0014 S5 — Inspector source-audio controls (原声 switch + volume + Detach).
// The switch/volume are static edits through updateClip (spread-guarded); Detach
// runs the shared `detachClipAudio` store action (→ ops.detachAudio) so the human
// "Detach" button and `autoviral clip detach-audio` converge on ONE op.

function compWithVideoClip(id: string, overrides: Partial<VideoClip> = {}): Composition {
  const c = makeEmptyComposition({ workId: "w-sa" });
  const clip: VideoClip = {
    id,
    kind: "video",
    src: "/x.mp4",
    in: 0,
    out: 5,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
    ...overrides,
  };
  (c.tracks.find((t) => t.kind === "video")!.clips as VideoClip[]).push(clip);
  return c;
}

function liveVideo(id: string) {
  return useComposition
    .getState()
    .comp!.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === id) as VideoClip;
}
function audioClipCount() {
  return useComposition
    .getState()
    .comp!.tracks.filter((t) => t.kind === "audio")
    .flatMap((t) => t.clips).length;
}

beforeEach(() => {
  useComposition.setState({ comp: null, selection: null });
});

describe("<StaticPropsPanel /> — source audio (S5)", () => {
  it("shows a 原声 switch + Detach button for a video clip", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    // switch (checkbox) — default checked (source audio enabled)
    const toggle = screen.getByRole("checkbox", { name: /原声|source audio/i });
    expect(toggle).toBeChecked();
    // Detach button present
    expect(screen.getByRole("button", { name: /拆分原声|detach/i })).toBeInTheDocument();
  });

  it("toggling the switch off writes sourceAudio.enabled=false (spread-guarded)", () => {
    useComposition.setState({
      comp: compWithVideoClip("v1", { sourceAudio: { enabled: true, volume: 0.6 } }),
      selection: "v1",
    });
    render(<StaticPropsPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: /原声|source audio/i }));
    const live = liveVideo("v1");
    expect(live.sourceAudio?.enabled).toBe(false);
    // sibling volume preserved (spread-guard)
    expect(live.sourceAudio?.volume).toBe(0.6);
  });

  it("Detach button runs the shared op: adds an audio clip + mutes the source", () => {
    useComposition.setState({ comp: compWithVideoClip("v1"), selection: "v1" });
    render(<StaticPropsPanel />);
    const before = audioClipCount();
    fireEvent.click(screen.getByRole("button", { name: /拆分原声|detach/i }));
    expect(audioClipCount()).toBe(before + 1);
    expect(liveVideo("v1").sourceAudio?.enabled).toBe(false);
  });
});
