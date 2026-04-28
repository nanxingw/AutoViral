import { describe, it, expect } from "vitest";
import { formStateToRequest, type FormState } from "../GenerationDialog";

const baseState: FormState = {
  kind: "image",
  prompt: "",
  aspectRatio: undefined,
  width: undefined,
  height: undefined,
  style: undefined,
  duration: "4",
  resolution: "720p",
  imageUrl: undefined,
  audioSubKind: "bgm",
  voice: undefined,
  durationSeconds: undefined,
  changeDirection: "",
};

describe("formStateToRequest — image create", () => {
  const state: FormState = {
    ...baseState,
    kind: "image",
    prompt: "panda eating bamboo",
    aspectRatio: "9:16",
  };
  it("maps to ImageParams with prompt + aspectRatio", () => {
    const r = formStateToRequest(state, undefined);
    expect(r.mode).toBe("create");
    expect(r.params.kind).toBe("image");
    if (r.params.kind === "image") {
      expect(r.params.prompt).toBe("panda eating bamboo");
      expect(r.params.aspectRatio).toBe("9:16");
    }
  });
});

describe("formStateToRequest — video variant", () => {
  const state: FormState = {
    ...baseState,
    kind: "video",
    prompt: "(unused in variant mode)",
    aspectRatio: "9:16",
    duration: "4",
    resolution: "720p",
    changeDirection: "slower droop, less aggressive lighting",
  };
  const source: NonNullable<Parameters<typeof formStateToRequest>[1]> = {
    id: "asset-panda-v1",
    name: "Panda v1",
    uri: "/api/works/w_x/assets/clips/panda-v1.mp4",
    sourcePrompt: "panda drooping head",
    sourceModel: "dreamina/seedance-pro/text-to-video",
    sourceWidth: 1080,
    sourceHeight: 1920,
    sourceAspectRatio: "9:16",
    sourceDuration: 4,
    sourceVoice: null,
  };
  it("flips to variant mode and carries change direction", () => {
    const r = formStateToRequest(state, source);
    expect(r.mode).toBe("variant");
    expect(r.source?.id).toBe("asset-panda-v1");
    if (r.params.kind === "video") {
      expect(r.params.changeDirection).toBe(
        "slower droop, less aggressive lighting",
      );
      expect(r.params.duration).toBe("4");
    }
  });
});

describe("formStateToRequest — audio TTS", () => {
  const state: FormState = {
    ...baseState,
    kind: "audio",
    prompt: "你好，欢迎来到 AutoViral",
    audioSubKind: "tts",
    voice: "zh-CN-XiaoxiaoNeural",
  };
  it("maps to TTS AudioParams", () => {
    const r = formStateToRequest(state, undefined);
    expect(r.params.kind).toBe("audio");
    if (r.params.kind === "audio") {
      expect(r.params.subKind).toBe("tts");
      expect(r.params.voice).toBe("zh-CN-XiaoxiaoNeural");
      expect(r.params.prompt).toBe("你好，欢迎来到 AutoViral");
    }
  });
});

describe("formStateToRequest — audio BGM", () => {
  const state: FormState = {
    ...baseState,
    kind: "audio",
    prompt: "warm cinematic ambient pad",
    audioSubKind: "bgm",
    durationSeconds: 30,
  };
  it("maps to BGM AudioParams with durationSeconds", () => {
    const r = formStateToRequest(state, undefined);
    if (r.params.kind === "audio") {
      expect(r.params.subKind).toBe("bgm");
      expect(r.params.durationSeconds).toBe(30);
    }
  });
});

describe("formStateToRequest — image with explicit width/height", () => {
  const state: FormState = {
    ...baseState,
    kind: "image",
    prompt: "editorial portrait",
    aspectRatio: "1:1",
    width: 1080,
    height: 1920,
    style: "editorial cool glass",
  };
  it("preserves width/height/style on ImageParams", () => {
    const r = formStateToRequest(state, undefined);
    if (r.params.kind === "image") {
      expect(r.params.width).toBe(1080);
      expect(r.params.height).toBe(1920);
      expect(r.params.style).toBe("editorial cool glass");
    }
  });
});
