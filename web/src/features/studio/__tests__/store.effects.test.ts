import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import type { AudioClip, VideoClip } from "../types";
import { useToastStore } from "@/stores/toast";
import { useLocaleStore } from "@/i18n/store";
import { MESSAGES } from "@/i18n/messages";

// PRD-0014 S14 review-fix (finding #9) — the effect-stack + blend store actions
// (remove / reorder / toggle / updateParams / setBlend) used to SILENTLY swallow
// a rejected CompositionOpError with a bare `return` — no toast, no log — while
// the sibling addClipEffect DID surface one. They now all route through the same
// warn-toast path, so a rejected effect edit tells the user WHY it landed nowhere.

function videoClip(id: string): VideoClip {
  return {
    id,
    kind: "video",
    src: "x.mp4",
    in: 0,
    out: 3,
    trackOffset: 0,
    fitMode: "cover",
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  };
}

function audioClip(id: string): AudioClip {
  return {
    id,
    kind: "audio",
    src: "a.mp3",
    in: 0,
    out: 3,
    trackOffset: 0,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    type: "bgm",
  };
}

function videoTrack() {
  return useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
}
function audioTrack() {
  return useComposition.getState().comp!.tracks.find((t) => t.kind === "audio")!;
}
function lastToast() {
  const entries = useToastStore.getState().entries;
  return entries[entries.length - 1];
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w-fx" }));
  useComposition.getState().addClip(videoTrack().id, videoClip("v1"));
  useComposition.getState().addClip(audioTrack().id, audioClip("a1"));
  useToastStore.getState().clear();
});

describe("store effect-op error paths surface a warn toast (finding #9)", () => {
  const locale = () => useLocaleStore.getState().locale;

  it("removeClipEffect on an unknown effect id pushes a warn toast", () => {
    useComposition.getState().removeClipEffect("v1", "no_such_effect");
    const t = lastToast();
    expect(t?.variant).toBe("warn");
    expect(t.message).toBe(MESSAGES[locale()].studio.toast.effectFailed);
  });

  it("reorderClipEffect on an unknown effect id pushes a warn toast", () => {
    useComposition.getState().reorderClipEffect("v1", "nope", 0);
    expect(lastToast()?.variant).toBe("warn");
  });

  it("toggleClipEffect on an unknown effect id pushes a warn toast", () => {
    useComposition.getState().toggleClipEffect("v1", "nope");
    expect(lastToast()?.variant).toBe("warn");
  });

  it("updateClipEffectParams on an unknown effect id pushes a warn toast", () => {
    useComposition.getState().updateClipEffectParams("v1", "nope", { brightness: 0.2 });
    expect(lastToast()?.variant).toBe("warn");
  });

  it("setClipBlendMode on a kind that can't carry a blend (audio) pushes a warn toast", () => {
    useComposition.getState().setClipBlendMode("a1", "screen");
    expect(lastToast()?.variant).toBe("warn");
    // composition untouched — the audio clip gains no blendMode.
    const live = useComposition
      .getState()
      .comp!.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === "a1") as { blendMode?: string };
    expect(live.blendMode).toBeUndefined();
  });

  it("a SUCCESSFUL effect add does NOT push a toast (control)", () => {
    useComposition.getState().addClipEffect("v1", "grade");
    expect(useToastStore.getState().entries).toHaveLength(0);
  });
});
