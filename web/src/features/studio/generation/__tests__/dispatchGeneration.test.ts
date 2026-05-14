import { describe, it, expect } from "vitest";
import {
  buildGenerationNotification,
  type GenerationRequest,
} from "../dispatchGeneration";

describe("buildGenerationNotification — create image", () => {
  const req: GenerationRequest = {
    mode: "create",
    params: { kind: "image", prompt: "panda eating bamboo", aspectRatio: "9:16" },
  };
  const n = buildGenerationNotification(req);

  it("uses the autoviral:create-asset tag", () => {
    expect(n.type).toBe("autoviral:create-asset");
    expect(n.summary).toBe("/autoviral:create-asset");
  });
  it("embeds a fenced JSON block with the script + script_args", () => {
    expect(n.message).toContain("```json");
    expect(n.message).toContain('"script": "modules/assets/scripts/openrouter_generate.py"');
    expect(n.message).toContain('"executable_kind": "python"');
    expect(n.message).toContain('"--aspect-ratio": "9:16"');
  });
  it("provenance_hint has from_asset_id=null + operation_type=generate", () => {
    expect(n.message).toContain('"operation_type": "generate"');
    expect(n.message).toContain('"from_asset_id": null');
  });
  it("provenance_hint.model matches gpt-5.4-image-2", () => {
    expect(n.message).toContain('"model": "openai/gpt-5.4-image-2"');
  });
});

describe("buildGenerationNotification — variant video", () => {
  const req: GenerationRequest = {
    mode: "variant",
    params: {
      kind: "video", prompt: "(frozen)", changeDirection: "slower droop",
      duration: "4", aspectRatio: "9:16",
    },
    source: {
      id: "asset-panda-v1", name: "Panda v1",
      uri: "/api/works/w_x/assets/clips/panda-v1.mp4",
      sourcePrompt: "panda drooping head", sourceModel: "bytedance/seedance-2.0",
      sourceWidth: 1080, sourceHeight: 1920, sourceAspectRatio: "9:16",
      sourceDuration: 4, sourceVoice: null,
    },
  };
  const n = buildGenerationNotification(req);

  it("uses the autoviral:generate-variant tag", () => {
    expect(n.type).toBe("autoviral:generate-variant");
  });
  it("auto-wires source.uri as --image-url for the seedance script", () => {
    expect(n.message).toContain('"--image-url": "/api/works/w_x/assets/clips/panda-v1.mp4"');
    expect(n.message).toContain('"script": "modules/assets/scripts/seedance_generate.py"');
    expect(n.message).toContain('"executable_kind": "python"');
  });
  it("operation_type=derive + from_asset_id=source.id", () => {
    expect(n.message).toContain('"operation_type": "derive"');
    expect(n.message).toContain('"from_asset_id": "asset-panda-v1"');
  });
  it("provenance_hint.model is bytedance/seedance-2.0 (same id for t2v and i2v)", () => {
    expect(n.message).toContain('"model": "bytedance/seedance-2.0"');
  });
  it("uses the same bytedance/seedance-2.0 id in pure t2v mode but omits --image-url", () => {
    const t2v: GenerationRequest = {
      mode: "create",
      params: {
        kind: "video", prompt: "panda eating bamboo, cinematic",
        duration: "4", aspectRatio: "9:16",
      },
    };
    const m = buildGenerationNotification(t2v);
    expect(m.message).toContain('"model": "bytedance/seedance-2.0"');
    expect(m.message).toContain('"script": "modules/assets/scripts/seedance_generate.py"');
    // No source / no explicit imageUrl → no --image-url arg.
    expect(m.message).not.toContain('"--image-url"');
  });
});

describe("buildGenerationNotification — TTS", () => {
  const req: GenerationRequest = {
    mode: "create",
    params: {
      kind: "audio", subKind: "tts",
      prompt: "你好，这是测试旁白",
      voice: "zh-CN-XiaoxiaoNeural", changeDirection: undefined,
    },
  };
  const n = buildGenerationNotification(req);
  it("routes to the TTS script with --voice", () => {
    expect(n.message).toContain('"script": "modules/assets/scripts/tts_generate.py"');
    expect(n.message).toContain('"--voice": "zh-CN-XiaoxiaoNeural"');
  });
  it("model label is edge-tts/multilingual", () => {
    expect(n.message).toContain('"model": "edge-tts/multilingual"');
  });
});

describe("buildGenerationNotification — BGM", () => {
  const req: GenerationRequest = {
    mode: "create",
    params: {
      kind: "audio", subKind: "bgm",
      prompt: "warm cinematic ambient pad",
      durationSeconds: 30,
    },
  };
  const n = buildGenerationNotification(req);
  it("routes to the music script with --duration", () => {
    expect(n.message).toContain('"script": "modules/assets/scripts/music_generate.py"');
    expect(n.message).toContain('"--duration": 30');
  });
  it("model label is google/lyria-3-pro-preview", () => {
    expect(n.message).toContain('"model": "google/lyria-3-pro-preview"');
  });
});
