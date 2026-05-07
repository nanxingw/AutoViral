import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interpolateProcessor } from "./interpolate.js";

describe("interpolateProcessor (stub mode)", () => {
  let tmp: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "av-interp-"));
    savedEnv = process.env.RIFE_MODEL_PATH;
    delete process.env.RIFE_MODEL_PATH;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.RIFE_MODEL_PATH;
    else process.env.RIFE_MODEL_PATH = savedEnv;
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns stub=true when RIFE_MODEL_PATH is unset and copies input → output", async () => {
    const input = join(tmp, "in.mp4");
    const output = join(tmp, "out.mp4");
    await writeFile(input, "fake-video-bytes");

    const result = await interpolateProcessor.process(input, output);

    expect(result.stub).toBe(true);
    expect(result.outputPath).toBe(output);
    await expect(access(output)).resolves.toBeUndefined();
    expect(await readFile(output, "utf-8")).toBe("fake-video-bytes");
    expect(typeof result.durationMs).toBe("number");
  });

  it("returns stub=true when RIFE_MODEL_PATH points to a nonexistent path", async () => {
    process.env.RIFE_MODEL_PATH = join(tmp, "does-not-exist.bin");
    const input = join(tmp, "in.mp4");
    const output = join(tmp, "out.mp4");
    await writeFile(input, "x");

    const result = await interpolateProcessor.process(input, output);

    expect(result.stub).toBe(true);
    await expect(access(output)).resolves.toBeUndefined();
  });

  it("returns stub=false when RIFE_MODEL_PATH points to an existing file (still copies, no real model run)", async () => {
    const fakeModel = join(tmp, "fake.bin");
    await writeFile(fakeModel, "model-weights");
    process.env.RIFE_MODEL_PATH = fakeModel;
    const input = join(tmp, "in.mp4");
    const output = join(tmp, "out.mp4");
    await writeFile(input, "video");

    const result = await interpolateProcessor.process(input, output);

    expect(result.stub).toBe(false);
    expect(result.outputPath).toBe(output);
    expect(await readFile(output, "utf-8")).toBe("video");
  });
});
