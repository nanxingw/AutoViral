import { describe, it, expect } from "vitest";
import {
  describeClip,
  describeLayer,
  type ClipNouns,
  type LayerNouns,
} from "./describeElement";
import type { Clip } from "@/features/studio/types";
import type { Layer } from "@/features/editor/types";

const CLIP_NOUNS: ClipNouns = {
  video: "视频",
  audio: "音频",
  text: "字幕",
  overlay: "叠加",
};
const LAYER_NOUNS: LayerNouns = {
  text: "文字图层",
  image: "图片图层",
  shape: "形状图层",
  sticker: "贴纸图层",
};

describe("describeClip", () => {
  it("text clip → noun + truncated text + offset", () => {
    const clip = {
      id: "c1",
      kind: "text",
      text: "樱花季的味道，一口入魂的限定",
      trackOffset: 3.2,
      duration: 2,
    } as unknown as Clip;
    expect(describeClip(clip, CLIP_NOUNS)).toBe("字幕「樱花季的味道，一口入魂的限定」(3.2s)");
  });

  it("video clip → basename without extension + offset", () => {
    const clip = {
      id: "c2",
      kind: "video",
      src: "assets/video/sakura_b-roll.mp4",
      in: 0,
      out: 5,
      trackOffset: 0,
    } as unknown as Clip;
    expect(describeClip(clip, CLIP_NOUNS)).toBe("视频「sakura_b-roll」(0.0s)");
  });

  it("audio clip → basename + offset (distinguishes by time)", () => {
    const clip = {
      id: "c3",
      kind: "audio",
      src: "assets/audio/bgm.mp3",
      in: 0,
      out: 10,
      trackOffset: 12.5,
      type: "bgm",
    } as unknown as Clip;
    expect(describeClip(clip, CLIP_NOUNS)).toBe("音频「bgm」(12.5s)");
  });

  it("truncates a long basename to 24 chars", () => {
    const clip = {
      id: "c4",
      kind: "video",
      src: "/x/this_is_a_really_long_source_filename_indeed.mov",
      in: 0,
      out: 1,
      trackOffset: 1,
    } as unknown as Clip;
    const out = describeClip(clip, CLIP_NOUNS);
    // 24-char name cap between the brackets
    const name = out.slice(out.indexOf("「") + 1, out.indexOf("」"));
    expect(name.length).toBe(24);
  });
});

describe("describeLayer", () => {
  it("text layer → noun + truncated text", () => {
    const layer = {
      id: "l1",
      kind: "text",
      box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      text: "标题",
      style: {
        font: "sans",
        size: 48,
        weight: 700,
        italic: false,
        color: "#111",
        align: "center",
        tracking: 0,
      },
    } as unknown as Layer;
    expect(describeLayer(layer, LAYER_NOUNS)).toBe("文字图层「标题」");
  });

  it("shape layer → noun + shape kind in parens", () => {
    const layer = {
      id: "l2",
      kind: "shape",
      box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      shape: "circle",
      fill: "#000",
      stroke: null,
      strokeWidth: 0,
    } as unknown as Layer;
    expect(describeLayer(layer, LAYER_NOUNS)).toBe("形状图层(circle)");
  });

  it("image layer → bare noun (no name)", () => {
    const layer = {
      id: "l3",
      kind: "image",
      box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      src: "/x.png",
      filters: {},
    } as unknown as Layer;
    expect(describeLayer(layer, LAYER_NOUNS)).toBe("图片图层");
  });
});
