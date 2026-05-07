import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lipSyncProcessor } from "./lip-sync.js";

describe("lipSyncProcessor (stub mode)", () => {
  let tmp: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "av-ls-"));
    savedEnv = process.env.WAV2LIP_MODEL_PATH;
    delete process.env.WAV2LIP_MODEL_PATH;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.WAV2LIP_MODEL_PATH;
    else process.env.WAV2LIP_MODEL_PATH = savedEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("throws when opts.audioPath is missing", async () => {
    const input = join(tmp, "in.mp4");
    const output = join(tmp, "out.mp4");
    await writeFile(input, "video-bytes");

    await expect(
      lipSyncProcessor.process(input, output),
    ).rejects.toThrow(/audioPath/);
  });

  it("returns stub=true when WAV2LIP_MODEL_PATH is unset and copies input → output", async () => {
    const input = join(tmp, "in.mp4");
    const output = join(tmp, "out.mp4");
    const audio = join(tmp, "voice.wav");
    await writeFile(input, "video-bytes");
    await writeFile(audio, "audio-bytes");

    const result = await lipSyncProcessor.process(input, output, {
      audioPath: audio,
    });

    expect(result.stub).toBe(true);
    expect(result.outputPath).toBe(output);
    await expect(access(output)).resolves.toBeUndefined();
    expect(await readFile(output, "utf-8")).toBe("video-bytes");
  });

  it("returns stub=false when WAV2LIP_MODEL_PATH points to an existing file (still copies, no real model run)", async () => {
    const fakeModel = join(tmp, "wav2lip.pth");
    await writeFile(fakeModel, "weights");
    process.env.WAV2LIP_MODEL_PATH = fakeModel;
    const input = join(tmp, "in.mp4");
    const output = join(tmp, "out.mp4");
    const audio = join(tmp, "voice.wav");
    await writeFile(input, "video");
    await writeFile(audio, "audio");

    const result = await lipSyncProcessor.process(input, output, {
      audioPath: audio,
    });

    expect(result.stub).toBe(false);
    expect(result.outputPath).toBe(output);
    expect(await readFile(output, "utf-8")).toBe("video");
  });

  it("reports a numeric durationMs >= 0", async () => {
    const input = join(tmp, "in.mp4");
    const output = join(tmp, "out.mp4");
    const audio = join(tmp, "voice.wav");
    await writeFile(input, "video");
    await writeFile(audio, "audio");

    const result = await lipSyncProcessor.process(input, output, {
      audioPath: audio,
    });

    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
