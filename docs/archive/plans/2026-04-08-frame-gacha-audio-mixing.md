# Frame Gacha & Intelligent Audio Mixing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-candidate first-frame generation ("抽卡") and intelligent multi-track audio mixing to the video creation pipeline.

**Architecture:** Two independent features. Feature 1 adds a batch image generation endpoint and frame selection endpoint to the Hono API server. Feature 2 adds audio analysis and multi-track mixing utilities backed by FFmpeg child_process calls, exposed as API endpoints. Both features also update the corresponding skill markdown files with new methodology modules.

**Tech Stack:** TypeScript, Hono (API framework), FFmpeg/FFprobe (audio analysis & mixing), Node.js child_process.spawn

---

## File Structure

### New files:
- `src/audio-tools.ts` — `analyzeAudio()` and `mixAudioTracks()` utility functions (FFmpeg wrappers)
- `skills/asset-generation/modules/frame-gacha.md` — gacha methodology for agents
- `skills/content-assembly/modules/audio-mixing.md` — mixing decision tree for agents

### Modified files:
- `src/server/api.ts` — 4 new route handlers (batch image, frame select, audio analyze, audio mix)
- `skills/asset-generation/SKILL.md:501-524` — insert gacha phase reference
- `skills/content-assembly/SKILL.md:415-456` — replace audio handling with mixing reference

---

### Task 1: Batch Image Generation Route

**Files:**
- Modify: `src/server/api.ts:420` (insert after generate/video route)

- [ ] **Step 1: Add the batch image generation route**

Insert after line 420 in `src/server/api.ts` (after the `POST /api/generate/video` route, before the `GET /api/generate/providers` line):

```typescript
// POST /api/generate/image/batch — generate multiple candidate first-frames
apiRoutes.post("/api/generate/image/batch", async (c) => {
  const body = await c.req.json();
  const { workId, prompt, shotId, count, width, height, aspectRatio, provider: providerName } = body;
  if (!workId || !prompt || !shotId) {
    return c.json({ success: false, error: "Missing required fields (workId, prompt, shotId)", code: "INVALID_PARAMS" }, 400);
  }
  const provider = providerName ? getProvider(providerName) : getDefaultProvider("image");
  if (!provider) {
    return c.json({ success: false, error: "No image provider available", code: "INVALID_PARAMS" }, 400);
  }

  const n = count ?? 4;
  const candidatesDir = join(dataDir, "works", workId, "assets", "frames", "candidates", shotId);
  await mkdir(candidatesDir, { recursive: true });

  // Generate n candidates concurrently with different seeds
  const seeds = Array.from({ length: n }, () => Math.floor(Math.random() * 100000));
  const results = await Promise.allSettled(
    seeds.map((seed, i) =>
      provider.generateImage({
        prompt,
        width,
        height,
        aspectRatio,
        seed,
        workId,
        filename: `frames/candidates/${shotId}/seed-${seed}.png`,
      })
    )
  );

  const candidates = results
    .map((r, i) => {
      if (r.status === "fulfilled" && r.value.success) {
        return {
          path: `frames/candidates/${shotId}/seed-${seeds[i]}.png`,
          seed: seeds[i],
          previewUrl: `/api/works/${encodeURIComponent(workId)}/assets/frames/candidates/${encodeURIComponent(shotId)}/seed-${seeds[i]}.png`,
        };
      }
      return null;
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    const errors = results
      .map((r) => (r.status === "rejected" ? r.reason?.message : r.status === "fulfilled" && !r.value.success ? r.value.error : null))
      .filter(Boolean);
    return c.json({ success: false, candidates: [], errors }, 500);
  }

  return c.json({ success: true, candidates });
});
```

- [ ] **Step 2: Add required import**

At the top of `src/server/api.ts`, the `mkdir` import from `node:fs/promises` already exists at line 2. The `join` import from `node:path` already exists at line 5. The `dataDir` import already exists at line 8. No new imports needed.

- [ ] **Step 3: Verify the server starts**

Run: `cd /Users/nanjiayan/Desktop/AutoViral/autoviral && npx tsx src/server/index.ts &`

Then test with curl:

```bash
curl -s -X POST http://localhost:3271/api/generate/image/batch \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","prompt":"test","shotId":"shot-01"}' | jq .
```

Expected: Either success with candidates array or an error about no provider (which confirms the route is registered).

Kill the test server after.

- [ ] **Step 4: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add POST /api/generate/image/batch for frame gacha"
```

---

### Task 2: Frame Selection Route

**Files:**
- Modify: `src/server/api.ts` (insert after batch route from Task 1)

- [ ] **Step 1: Add the frame selection route**

Insert immediately after the batch image route added in Task 1:

```typescript
// POST /api/frames/select — pick a candidate frame for a shot
apiRoutes.post("/api/frames/select", async (c) => {
  const body = await c.req.json();
  const { workId, shotId, selectedSeed } = body;
  if (!workId || !shotId || selectedSeed === undefined) {
    return c.json({ success: false, error: "Missing required fields (workId, shotId, selectedSeed)", code: "INVALID_PARAMS" }, 400);
  }

  const candidatesDir = join(dataDir, "works", workId, "assets", "frames", "candidates", shotId);
  const framesDir = join(dataDir, "works", workId, "assets", "frames");

  // Read candidate files
  let files: string[];
  try {
    files = await readdir(candidatesDir);
  } catch {
    return c.json({ success: false, error: `No candidates found for ${shotId}`, code: "INVALID_PARAMS" }, 404);
  }

  const selectedFile = files.find((f) => f.includes(`seed-${selectedSeed}`) && !f.includes("_rejected"));
  if (!selectedFile) {
    return c.json({ success: false, error: `Candidate with seed ${selectedSeed} not found`, code: "INVALID_PARAMS" }, 404);
  }

  // Step 1: Strip _rejected suffix from all candidates (in case of re-selection)
  for (const f of files) {
    if (f.includes("_rejected")) {
      const restored = f.replace("_rejected", "");
      await rename(join(candidatesDir, f), join(candidatesDir, restored)).catch(() => {});
    }
  }

  // Re-read after restoring
  files = await readdir(candidatesDir);

  // Step 2: Copy selected to frames dir
  const destFilename = `frame-${shotId}.png`;
  await copyFile(join(candidatesDir, selectedFile), join(framesDir, destFilename));

  // Step 3: Rename non-selected candidates with _rejected suffix
  for (const f of files) {
    if (!f.includes(`seed-${selectedSeed}`)) {
      const ext = extname(f);
      const base = f.slice(0, -ext.length);
      await rename(join(candidatesDir, f), join(candidatesDir, `${base}_rejected${ext}`)).catch(() => {});
    }
  }

  return c.json({
    success: true,
    framePath: `frames/${destFilename}`,
  });
});
```

- [ ] **Step 2: Add `rename` and `copyFile` imports**

At line 2 of `src/server/api.ts`, update the `node:fs/promises` import:

Change:
```typescript
import { readFile, writeFile, appendFile, mkdir, readdir } from "node:fs/promises";
```
To:
```typescript
import { readFile, writeFile, appendFile, mkdir, readdir, rename, copyFile } from "node:fs/promises";
```

- [ ] **Step 3: Verify with curl**

```bash
curl -s -X POST http://localhost:3271/api/frames/select \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","shotId":"shot-01","selectedSeed":12345}' | jq .
```

Expected: 404 with "No candidates found" (confirms route is registered).

- [ ] **Step 4: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add POST /api/frames/select for frame gacha selection"
```

---

### Task 3: Audio Analysis Utility

**Files:**
- Create: `src/audio-tools.ts`

- [ ] **Step 1: Create `src/audio-tools.ts` with `analyzeAudio()`**

```typescript
import { spawn } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AudioAnalysis {
  hasAudio: boolean;
  hasMeaningfulAudio: boolean;
  avgVolume: number;
  peakVolume: number;
  silenceRatio: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function runCmd(cmd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      // ffmpeg writes to stderr for filters, so combine
      resolve(stdout + stderr);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── analyzeAudio ───────────────────────────────────────────────────────────

export async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
  // Step 1: Check if file has audio stream
  const probeOut = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    filePath,
  ]);

  const hasAudio = probeOut.includes("audio");
  if (!hasAudio) {
    return { hasAudio: false, hasMeaningfulAudio: false, avgVolume: -Infinity, peakVolume: -Infinity, silenceRatio: 1.0 };
  }

  // Step 2: Detect volume levels
  const volOut = await runCmd("ffmpeg", [
    "-i", filePath,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);

  const meanMatch = volOut.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const maxMatch = volOut.match(/max_volume:\s*([-\d.]+)\s*dB/);
  const avgVolume = meanMatch ? parseFloat(meanMatch[1]) : -Infinity;
  const peakVolume = maxMatch ? parseFloat(maxMatch[1]) : -Infinity;

  // Step 3: Detect silence ratio
  const durationOut = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ]);
  const totalDuration = parseFloat(durationOut.trim()) || 0;

  let silenceRatio = 1.0;
  if (totalDuration > 0) {
    const silOut = await runCmd("ffmpeg", [
      "-i", filePath,
      "-af", "silencedetect=noise=-40dB:d=0.3",
      "-f", "null",
      "-",
    ]);

    // Sum silence durations
    const silenceEnds = [...silOut.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)];
    const totalSilence = silenceEnds.reduce((sum, m) => sum + parseFloat(m[2]), 0);
    silenceRatio = Math.min(1.0, totalSilence / totalDuration);
  }

  const hasMeaningfulAudio = avgVolume > -40;

  return { hasAudio, hasMeaningfulAudio, avgVolume, peakVolume, silenceRatio };
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /Users/nanjiayan/Desktop/AutoViral/autoviral && npx tsx -e "import { analyzeAudio } from './src/audio-tools.js'; console.log('OK')"`

Expected: `OK` (no compile errors)

- [ ] **Step 3: Commit**

```bash
git add src/audio-tools.ts
git commit -m "feat: add analyzeAudio utility with FFmpeg volume and silence detection"
```

---

### Task 4: Audio Analysis Route

**Files:**
- Modify: `src/server/api.ts` (insert after frames/select route)

- [ ] **Step 1: Add import for analyzeAudio**

At the top of `src/server/api.ts`, add after the existing imports (after line 24):

```typescript
import { analyzeAudio, mixAudioTracks } from "../audio-tools.js";
```

Note: `mixAudioTracks` doesn't exist yet — it will be created in Task 5. To avoid a compile error in the meantime, you can import only `analyzeAudio` first and add `mixAudioTracks` in Task 6. Or add both now since they'll be implemented before the server runs again.

- [ ] **Step 2: Add the audio analyze route**

Insert after the `POST /api/frames/select` route:

```typescript
// POST /api/audio/analyze — detect audio properties of a clip
apiRoutes.post("/api/audio/analyze", async (c) => {
  const body = await c.req.json();
  const { workId, assetPath } = body;
  if (!workId || !assetPath) {
    return c.json({ success: false, error: "Missing required fields (workId, assetPath)", code: "INVALID_PARAMS" }, 400);
  }

  const fullPath = join(dataDir, "works", workId, assetPath);
  try {
    const analysis = await analyzeAudio(fullPath);
    return c.json(analysis);
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add POST /api/audio/analyze route"
```

---

### Task 5: Multi-Track Audio Mix Utility

**Files:**
- Modify: `src/audio-tools.ts` (append to existing file)

- [ ] **Step 1: Add types and `mixAudioTracks()` to `src/audio-tools.ts`**

Append after the `analyzeAudio` function:

```typescript
// ── Types for mixing ───────────────────────────────────────────────────────

export interface MixTrack {
  source: string;           // absolute file path
  type: "original" | "bgm" | "voiceover" | "sfx";
  volume: number;           // 0.0-1.0
  delay?: number;           // seconds
  fadeIn?: number;          // seconds
  fadeOut?: number;         // seconds
  ducking?: {
    trigger: string;        // type of track that triggers ducking, e.g. "voiceover"
    ratio: number;          // compression ratio 2-8
    threshold?: number;     // 0.01-0.1, default 0.02
  };
}

export interface MixOptions {
  videoPath: string;        // absolute path to base video
  tracks: MixTrack[];
  outputPath: string;       // absolute path for output
}

// ── mixAudioTracks ─────────────────────────────────────────────────────────

export async function mixAudioTracks(opts: MixOptions): Promise<void> {
  const { videoPath, tracks, outputPath } = opts;
  if (tracks.length === 0) throw new Error("No audio tracks provided");

  // Get video duration for fadeOut calculations
  const durOut = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    videoPath,
  ]);
  const totalDuration = parseFloat(durOut.trim()) || 0;

  // Build inputs: video first, then each track source
  const inputs: string[] = ["-i", videoPath];
  for (const t of tracks) {
    inputs.push("-i", t.source);
  }

  // Build filter_complex
  const filterParts: string[] = [];
  const trackLabels: string[] = [];

  // Map track type to index for ducking trigger lookup
  const typeToIndex = new Map<string, number>();
  tracks.forEach((t, i) => {
    if (!typeToIndex.has(t.type)) typeToIndex.set(t.type, i);
  });

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const inputIdx = i + 1; // 0 is video
    const filters: string[] = [];

    // Volume
    filters.push(`volume=${t.volume}`);

    // Delay
    if (t.delay && t.delay > 0) {
      const delayMs = Math.round(t.delay * 1000);
      filters.push(`adelay=${delayMs}|${delayMs}`);
    }

    // Fade in
    if (t.fadeIn && t.fadeIn > 0) {
      filters.push(`afade=t=in:st=0:d=${t.fadeIn}`);
    }

    // Fade out
    if (t.fadeOut && t.fadeOut > 0 && totalDuration > 0) {
      const fadeStart = Math.max(0, totalDuration - t.fadeOut);
      filters.push(`afade=t=out:st=${fadeStart.toFixed(2)}:d=${t.fadeOut}`);
    }

    const label = `t${i}`;
    filterParts.push(`[${inputIdx}:a]${filters.join(",")}[${label}]`);
    trackLabels.push(label);
  }

  // Apply ducking (sidechaincompress) where configured
  const finalLabels: string[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const label = trackLabels[i];

    if (t.ducking) {
      const triggerIdx = typeToIndex.get(t.ducking.trigger);
      if (triggerIdx !== undefined && triggerIdx !== i) {
        const triggerLabel = trackLabels[triggerIdx];
        const duckedLabel = `${label}_d`;
        const threshold = t.ducking.threshold ?? 0.02;
        filterParts.push(
          `[${label}][${triggerLabel}]sidechaincompress=threshold=${threshold}:ratio=${t.ducking.ratio}:attack=200:release=1000[${duckedLabel}]`
        );
        finalLabels.push(duckedLabel);
      } else {
        finalLabels.push(label);
      }
    } else {
      finalLabels.push(label);
    }
  }

  // Final amix
  const mixInput = finalLabels.map((l) => `[${l}]`).join("");
  filterParts.push(`${mixInput}amix=inputs=${finalLabels.length}:duration=first[out]`);

  const filterComplex = filterParts.join(";\n");

  // Build full ffmpeg command
  const args = [
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[out]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-y",
    outputPath,
  ];

  const output = await runCmd("ffmpeg", args, 5 * 60 * 1000); // 5 min timeout

  // Verify output has audio
  const verifyOut = await runCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    outputPath,
  ]);

  if (!verifyOut.includes("audio")) {
    throw new Error("Output file is missing audio stream after mix");
  }
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /Users/nanjiayan/Desktop/AutoViral/autoviral && npx tsx -e "import { mixAudioTracks } from './src/audio-tools.js'; console.log('OK')"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/audio-tools.ts
git commit -m "feat: add mixAudioTracks utility with filter_complex builder and ducking support"
```

---

### Task 6: Audio Mix Route

**Files:**
- Modify: `src/server/api.ts` (insert after audio/analyze route)

- [ ] **Step 1: Ensure the import includes `mixAudioTracks`**

The import added in Task 4 Step 1 should already include `mixAudioTracks`:

```typescript
import { analyzeAudio, mixAudioTracks } from "../audio-tools.js";
```

If Task 4 only imported `analyzeAudio`, update the import now.

- [ ] **Step 2: Add the audio mix route**

Insert after the `POST /api/audio/analyze` route:

```typescript
// POST /api/audio/mix — multi-track audio mixing with ducking
apiRoutes.post("/api/audio/mix", async (c) => {
  const body = await c.req.json();
  const { workId, videoPath, tracks, outputFilename } = body;
  if (!workId || !videoPath || !tracks || !outputFilename) {
    return c.json({ success: false, error: "Missing required fields (workId, videoPath, tracks, outputFilename)", code: "INVALID_PARAMS" }, 400);
  }
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return c.json({ success: false, error: "tracks must be a non-empty array", code: "INVALID_PARAMS" }, 400);
  }

  const workBase = join(dataDir, "works", workId);
  const fullVideoPath = join(workBase, videoPath);
  const fullOutputPath = join(workBase, "output", outputFilename);
  await mkdir(join(workBase, "output"), { recursive: true });

  // Resolve track source paths to absolute
  const resolvedTracks = tracks.map((t: any) => ({
    ...t,
    source: join(workBase, t.source),
  }));

  try {
    await mixAudioTracks({
      videoPath: fullVideoPath,
      tracks: resolvedTracks,
      outputPath: fullOutputPath,
    });

    return c.json({
      success: true,
      assetPath: fullOutputPath,
      previewUrl: `/api/works/${encodeURIComponent(workId)}/output/${encodeURIComponent(outputFilename)}`,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, code: "API_ERROR" }, 500);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add POST /api/audio/mix route for multi-track mixing"
```

---

### Task 7: Frame Gacha Skill Module

**Files:**
- Create: `skills/asset-generation/modules/frame-gacha.md`
- Modify: `skills/asset-generation/SKILL.md:501-524`

- [ ] **Step 1: Create `skills/asset-generation/modules/frame-gacha.md`**

```markdown
# 首帧抽卡（Frame Gacha）

## 核心原则

图片生成成本远低于视频生成。在用首帧生成视频之前，先为同一镜头生成 4 张候选首帧，让用户挑选最满意的一张，再投入视频生成资源。

## 流程

### 1. 批量生成候选首帧

对分镜中的每个镜头，调用批量生成接口：

```bash
POST /api/generate/image/batch
{
  "workId": "{workId}",
  "prompt": "{优化后的提示词}",
  "shotId": "shot-01",
  "aspectRatio": "9:16"
}
```

系统会自动生成 4 张不同的候选首帧，存放在 `assets/frames/candidates/{shot-id}/` 目录。

### 2. 展示候选并等待选择

在 chat 中展示 4 张候选图片：

```
第 {N} 镜首帧候选已生成，请选择最满意的一张：

1️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/shot-01/seed-XXXX.png
2️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/shot-01/seed-XXXX.png
3️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/shot-01/seed-XXXX.png
4️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/shot-01/seed-XXXX.png

回复数字 1-4 选择，或输入「重新抽卡」生成新的候选。
```

### 3. 锁定选择

用户选定后，调用选择接口：

```bash
POST /api/frames/select
{
  "workId": "{workId}",
  "shotId": "shot-01",
  "selectedSeed": {用户选中的seed值}
}
```

选中的首帧会被复制到 `assets/frames/frame-{shot-id}.png`，未选中的候选加上 `_rejected` 标记但保留在文件夹中。

### 4. 重新抽卡

如果用户对 4 张都不满意：
- 重新调用 `/api/generate/image/batch`，生成新的 4 张候选
- 旧候选不自动清理（用户可能回头选）
- 展示新候选，重复选择流程

### 5. 跳过抽卡

如果用户表示要快速生成（如「跳过选择」「直接用第一张」），直接选择第一个候选并继续。

## 注意事项

- 候选首帧统一存放在 `assets/frames/candidates/{shot-id}/` 目录，不污染主 frames 目录
- 文件名格式：`seed-{数字}.png`，未选中的加 `_rejected` 后缀
- 每个镜头独立抽卡，不影响其他镜头的选择
- 如需保持角色一致性，在 prompt 中加入角色描述和参考图，但每张候选仍使用不同 seed
```

- [ ] **Step 2: Update `skills/asset-generation/SKILL.md` — insert gacha reference**

In `skills/asset-generation/SKILL.md`, replace lines 501-524 (from "**2. 等待用户确认。**" through the "满意吗" block) with:

```markdown
**2. 等待用户确认。**

**3. 首帧抽卡 — 批量生成候选首帧：**

> 详细流程参考 `modules/frame-gacha.md`

调用 `POST /api/generate/image/batch` 为该镜头生成 4 张候选首帧，展示给用户选择。用户选定后调用 `POST /api/frames/select` 锁定首帧。

**4. 报告结果并展示预览：**
```
首帧已锁定 ✓
预览: http://localhost:3271/api/works/{workId}/assets/frames/frame-{shotId}.png
继续生成视频片段。
```
```

- [ ] **Step 3: Commit**

```bash
git add skills/asset-generation/modules/frame-gacha.md skills/asset-generation/SKILL.md
git commit -m "feat: add frame gacha skill module and update asset-generation pipeline"
```

---

### Task 8: Audio Mixing Skill Module

**Files:**
- Create: `skills/content-assembly/modules/audio-mixing.md`
- Modify: `skills/content-assembly/SKILL.md:415-456`

- [ ] **Step 1: Create `skills/content-assembly/modules/audio-mixing.md`**

```markdown
# 智能音频混音（Intelligent Audio Mixing）

## 核心原则

AI 生成的视频可能自带有价值的音频（环境音、音效、甚至人声）。不应一律替换，而应根据内容上下文智能混音。

## 决策流程

### 1. 分析每个 clip 的音频

对每个视频片段调用分析接口：

```bash
POST /api/audio/analyze
{
  "workId": "{workId}",
  "assetPath": "clips/clip-01.mp4"
}
```

返回 `hasAudio`、`hasMeaningfulAudio`、`avgVolume`、`peakVolume`、`silenceRatio`。

### 2. 结合生成上下文判断

你自己下发的生成指令知道：
- 该 clip 是否被要求生成人声（口播/旁白）
- 该 clip 的场景类型（风景/室内/街拍等）

### 3. 混音策略决策矩阵

| 生成上下文 | 音频分析结果 | 策略 |
|---|---|---|
| **要求了人声** | 有意义音频 | 原始音频 = 主音轨 (vol 0.8-1.0)，BGM 做 ducking |
| **风景/环境镜头** | 有意义音频 | 原始音频作为环境音 (vol 0.2-0.3)，BGM 正常 |
| **任何** | 静音/无音频 | 忽略原始音频，仅 BGM + 配音 |

### 4. 构建混音配置并执行

根据决策矩阵构建 tracks 配置，调用混音接口：

```bash
POST /api/audio/mix
{
  "workId": "{workId}",
  "videoPath": "output/concat.mp4",
  "tracks": [
    {
      "source": "clips/clip-01.mp4",
      "type": "original",
      "volume": 0.8
    },
    {
      "source": "audio/bgm.mp3",
      "type": "bgm",
      "volume": 0.35,
      "fadeIn": 2,
      "fadeOut": 3,
      "ducking": {
        "trigger": "voiceover",
        "ratio": 4
      }
    },
    {
      "source": "audio/voiceover.wav",
      "type": "voiceover",
      "volume": 1.0
    }
  ],
  "outputFilename": "final-mixed.mp4"
}
```

## 音量参考值

| 轨道类型 | 场景 | 推荐音量 |
|---|---|---|
| 人声（原始或配音） | 主音轨 | 0.8 - 1.0 |
| BGM | 有人声时（自动ducking） | 0.3 - 0.5（ducking 自动降低） |
| BGM | 纯音乐（无人声） | 0.5 - 0.7 |
| 环境音/音效 | 氛围补充 | 0.15 - 0.3 |
| SFX | 转场/强调 | 0.5 - 0.8 |

## Ducking 参数推荐

- `ratio: 4` — 适合大多数场景，人声响时 BGM 明显降低
- `ratio: 2` — 轻微 ducking，适合环境音乐感强的内容
- `ratio: 8` — 强力 ducking，适合播客/教程类内容
- `threshold: 0.02` — 默认值，灵敏度适中
- 攻击时间 200ms，释放时间 1000ms（系统内置，不需配置）

## 验证

混音完成后，必须验证输出文件有音频流：

```bash
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 output.mp4 | grep audio
```

如果没有 `audio` 行，说明音频丢失，需要排查 filter_complex 配置。
```

- [ ] **Step 2: Update `skills/content-assembly/SKILL.md` — replace audio handling section**

In `skills/content-assembly/SKILL.md`, replace lines 415-456 (from "#### 第4步：添加背景音乐" through the volume reference table) with:

```markdown
#### 第4步：智能音频混音

> 详细决策流程和参数参考 `modules/audio-mixing.md`

**不再简单替换音频。** 对每个 clip 先调用 `POST /api/audio/analyze` 分析音频属性，结合你自己的生成上下文（该 clip 是否被要求生成人声），决定混音策略。

然后调用 `POST /api/audio/mix` 执行多轨混音，支持：
- 多轨叠加（原始音频 + BGM + 配音 + 音效）
- 自动 ducking（人声响时 BGM 自动降低）
- 逐轨音量、延迟、淡入淡出控制

**音乐获取规则不变：** 当用户指定了具体歌曲名时，仍需从官方音源获取，裁切高潮部分。获取方式参考原有流程。

```bash
# 下载官方音源（用 yt-dlp 从官方MV提取音频）
yt-dlp -x --audio-format mp3 --audio-quality 0 -o "song.%(ext)s" "OFFICIAL_MV_URL"

# 裁切高潮部分（示例：从2:00开始取30秒）
ffmpeg -i song.mp3 -ss 120 -to 150 -c copy -y chorus.mp3
```
```

- [ ] **Step 3: Commit**

```bash
git add skills/content-assembly/modules/audio-mixing.md skills/content-assembly/SKILL.md
git commit -m "feat: add audio mixing skill module and update content-assembly pipeline"
```

---

### Task 9: Final Integration Verification

**Files:**
- All files from Tasks 1-8

- [ ] **Step 1: Verify server starts without errors**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral && npx tsx src/server/index.ts
```

Expected: Server starts on port 3271 without TypeScript or runtime errors.

- [ ] **Step 2: Verify all 4 new routes respond**

```bash
# Batch image (should return provider error or success)
curl -s -X POST http://localhost:3271/api/generate/image/batch \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","prompt":"test","shotId":"s1"}' | jq .success

# Frame select (should return 404 — no candidates yet)
curl -s -X POST http://localhost:3271/api/frames/select \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","shotId":"s1","selectedSeed":1}' | jq .

# Audio analyze (should return error — file not found)
curl -s -X POST http://localhost:3271/api/audio/analyze \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","assetPath":"clips/test.mp4"}' | jq .

# Audio mix (should return error — file not found)
curl -s -X POST http://localhost:3271/api/audio/mix \
  -H "Content-Type: application/json" \
  -d '{"workId":"test","videoPath":"test.mp4","tracks":[{"source":"a.mp3","type":"bgm","volume":0.3}],"outputFilename":"out.mp4"}' | jq .
```

Expected: All routes respond (not 404 "not found"), confirming they are registered. Specific errors about missing files/providers are expected and correct.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete frame gacha and audio mixing implementation"
```
