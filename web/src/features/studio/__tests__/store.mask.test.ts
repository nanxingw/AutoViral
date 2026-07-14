import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";
import type { VideoClip } from "../types";
import { useToastStore } from "@/stores/toast";
import { useLocaleStore } from "@/i18n/store";
import { MESSAGES } from "@/i18n/messages";

// PRD-0014 S13 review-fix (finding #5) — the store's `setClipMask` used to
// SILENTLY swallow the op's CompositionOpError, so a rejected mask edit landed
// nowhere with ZERO user feedback while the CLI/bridge returned code:4 for the
// SAME call. It now SURFACES a localized warn toast (identical to the transition
// family) AND still leaves the composition untouched. These assert both.

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

function videoTrack() {
  return useComposition.getState().comp!.tracks.find((t) => t.kind === "video")!;
}

function liveClip(id: string) {
  return useComposition
    .getState()
    .comp!.tracks.flatMap((t) => t.clips)
    .find((c) => c.id === id) as VideoClip;
}

function lastToast() {
  const entries = useToastStore.getState().entries;
  return entries[entries.length - 1];
}

beforeEach(() => {
  useComposition.getState().loadComposition(makeEmptyComposition({ workId: "w1" }));
  useComposition.getState().addClip(videoTrack().id, videoClip("c1"));
  useToastStore.getState().clear();
});

describe("store.setClipMask error path surfaces a warn toast (finding #5)", () => {
  it("an illegal feather pushes a warn toast AND leaves the clip mask untouched", () => {
    expect(useToastStore.getState().entries).toHaveLength(0);
    // feather 9 is out of [0,1] → the op throws CompositionOpError{4}.
    useComposition.getState().setClipMask("c1", { type: "rect", feather: 9 });
    expect(liveClip("c1").mask).toBeUndefined(); // composition untouched

    const t = lastToast();
    expect(t).toBeDefined();
    expect(t.variant).toBe("warn");
    const locale = useLocaleStore.getState().locale;
    expect(t.message).toBe(MESSAGES[locale].studio.toast.maskFailed);
    // the op's technical reason rides along on the detail line.
    expect(t.detail).toMatch(/feather/);
  });

  it("an unknown preset pushes a warn toast", () => {
    useComposition.getState().setClipMask("c1", { preset: "letterbox-nope" });
    const t = lastToast();
    expect(t?.variant).toBe("warn");
    const locale = useLocaleStore.getState().locale;
    expect(t.message).toBe(MESSAGES[locale].studio.toast.maskFailed);
    expect(liveClip("c1").mask).toBeUndefined();
  });

  it("a SUCCESSFUL mask set does NOT push a toast", () => {
    useComposition.getState().setClipMask("c1", { type: "ellipse", feather: 0.2 });
    expect(liveClip("c1").mask?.type).toBe("ellipse");
    expect(useToastStore.getState().entries).toHaveLength(0);
  });
});
