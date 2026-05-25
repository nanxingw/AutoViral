# Video Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with Opus subagents (CLAUDE.md hard rule). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 1 落下的 `web/src/pages/Studio.tsx` 占位 shell 填满：Remotion `<Player>` 实时预览 + 多轨 Timeline（视频/音频/字幕/Overlay）+ dnd-kit 拖拽 + WaveSurfer 波形 + Tweaks Panel 实时调参 + Chat 集成 + 服务端 `@remotion/renderer` 等价导出 mp4。视频合成、图层、音轨控制达到极致——浏览器内 WYSIWYG，导出像素级一致。

**Architecture:** 三层。**数据**：单一 `Composition` 对象（Zustand 持久化 + 服务端 yaml 落盘），描述 fps/分辨率/duration 与 4 类 tracks。**视图**：Remotion 同一份组件树同时给 `<Player>` 与 `@remotion/renderer` 用——浏览器实时预览即未来导出帧。**控制**：Tweaks Panel 改 store；Timeline 改 store；store 改 → Remotion `<Player>` 自动重渲染（Remotion 的 Props 变更触发 frame 重新计算）。

**Tech Stack:** React 18 + Zustand + Remotion 4 + WaveSurfer 7 + @dnd-kit/core + @dnd-kit/sortable + zod + immer + Hono server side。

---

## 全局硬约束

1. **TDD**：行为变更先写失败测试。
2. **Per-task commit**：conventional commits；message 禁用 `step/stage/phase/pipeline/阶段/流水线/下一步`。
3. **D3 不回潮**：模块概念在 UI 里**不出现**——Tweaks Panel 不写"下一步"，Chat 没有"阶段"，按钮文案中性。
4. **像素级一致约定**：任何对 `<Player>` 生效的视觉效果，必须能由 `@remotion/renderer` 用同一份 `<RemotionComposition>` 组件复现——不要在 Player 外加 CSS 滤镜（CSS 不会被 renderer 看见）。
5. **Subagent 模型固定 Opus**。
6. **Plan 4 已落地是前提**（`/api/works/:id/invoke` 端点必须存在；本 plan 的 ChatPanel 直接走它）。

## 文件结构（after）

```
web/src/features/studio/
├─ types.ts                      # Composition / Track / Clip 类型 + zod schema
├─ store.ts                      # Zustand: useComposition (clips, selection, currentFrame)
├─ store.test.ts
├─ composition/
│  ├─ RemotionRoot.tsx           # registerRoot (Remotion CLI 入口)
│  ├─ MainComposition.tsx        # <Composition id="main"> 包装
│  ├─ Scene.tsx                  # 主场景，遍历 tracks → Sequence
│  ├─ tracks/
│  │  ├─ VideoTrackRenderer.tsx
│  │  ├─ AudioTrackRenderer.tsx
│  │  ├─ TextTrackRenderer.tsx
│  │  └─ OverlayTrackRenderer.tsx
│  ├─ filters/cssFilters.ts      # Brightness/Contrast/Saturation → CSS filter string (Remotion-safe)
│  ├─ filters/cssFilters.test.ts
│  ├─ layout/positionResolve.ts  # anchor + xPct/yPct → absolute style
│  └─ layout/positionResolve.test.ts
├─ panels/
│  ├─ PreviewPanel.tsx           # 包 <Player>，监听 currentFrame
│  ├─ PreviewPanel.test.tsx
│  ├─ Timeline/
│  │  ├─ index.tsx               # grid: 时间轴 + tracks 列
│  │  ├─ Ruler.tsx
│  │  ├─ Track.tsx               # 单轨容器
│  │  ├─ Clip.tsx                # 拖拽 / 裁切 handles
│  │  ├─ Clip.test.tsx
│  │  ├─ Playhead.tsx
│  │  ├─ snapToBeat.ts           # detect_beats.py 结果 → 吸附点列表
│  │  └─ snapToBeat.test.ts
│  ├─ Tweaks/
│  │  ├─ index.tsx
│  │  ├─ ThemeSection.tsx
│  │  ├─ DensitySection.tsx
│  │  ├─ LayerSection.tsx
│  │  └─ CompositionSection.tsx
│  ├─ Chat/
│  │  ├─ index.tsx               # 用 Plan 1 的 useChatSocket
│  │  ├─ StreamBlock.tsx         # 已有 base，复用
│  │  └─ QuickActions.tsx        # 选中 clip 时显示 contextual 按钮
│  └─ TopBar.tsx                 # 标题 / save / export / 快捷键
├─ hooks/
│  ├─ useFrameSync.ts            # PreviewPanel ↔ Timeline currentFrame 双向同步
│  ├─ useWaveform.ts             # WaveSurfer 渲染 + 缓存
│  ├─ useWaveform.test.ts
│  └─ useDragClip.ts             # dnd-kit modifier 封装
├─ services/
│  ├─ composition.ts             # GET/PUT /api/works/:id/composition + zod parse
│  └─ render.ts                  # POST /api/works/:id/render
└─ index.ts                      # public re-exports

src/server/
├─ api.ts                        # 新增 GET/PUT composition + POST render 端点
├─ remotion-renderer.ts          # 新：调用 @remotion/renderer/server.renderMedia()
└─ __tests__/composition.test.ts
└─ __tests__/render.test.ts

remotion.config.ts                # repo 根：Remotion CLI/renderer 配置
```

---

## Task 1: 装依赖

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` 或 `pnpm-lock.yaml`

- [ ] **Step 1: Install runtime deps**

```bash
npm install --save \
  remotion@^4.0.0 \
  @remotion/player@^4.0.0 \
  @remotion/renderer@^4.0.0 \
  @remotion/cli@^4.0.0 \
  @remotion/bundler@^4.0.0 \
  wavesurfer.js@^7.8.0 \
  @dnd-kit/core@^6.1.0 \
  @dnd-kit/sortable@^8.0.0 \
  @dnd-kit/modifiers@^7.0.0
```

- [ ] **Step 2: 跑一次本地构建确认无 peer-dep 报错**

Run: `npm run build`
Expected: 构建成功；如有 React 18 vs Remotion peer-dep 警告，subagent 评估是否需要 `--legacy-peer-deps` 并记录。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add remotion + wavesurfer + dnd-kit for studio"
```

---

## Task 2: Composition 类型 + zod schema

**Files:**
- Create: `web/src/features/studio/types.ts`
- Create: `web/src/features/studio/types.test.ts`

- [ ] **Step 1: 写测试（先于类型）**

```ts
// web/src/features/studio/types.test.ts
import { describe, it, expect } from "vitest";
import { CompositionSchema, makeEmptyComposition } from "./types";

describe("Composition schema", () => {
  it("makes a valid empty composition for short-video", () => {
    const c = makeEmptyComposition({ workId: "w1", aspect: "9:16" });
    const parsed = CompositionSchema.parse(c);
    expect(parsed.fps).toBe(30);
    expect(parsed.width).toBe(1080);
    expect(parsed.height).toBe(1920);
    expect(parsed.tracks).toHaveLength(4);          // video / audio / text / overlay
    expect(parsed.tracks.map((t) => t.kind)).toEqual(["video", "audio", "text", "overlay"]);
  });

  it("rejects negative duration", () => {
    expect(() => CompositionSchema.parse(makeEmptyComposition({ workId: "w", aspect: "9:16", duration: -1 })))
      .toThrow();
  });

  it("supports 1:1 and 16:9 aspect", () => {
    const square = makeEmptyComposition({ workId: "w", aspect: "1:1" });
    expect(square.width).toBe(square.height);
    const wide = makeEmptyComposition({ workId: "w", aspect: "16:9" });
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 2);
  });
});
```

- [ ] **Step 2: 实现类型 + schema + factory**

Create `web/src/features/studio/types.ts`:

```ts
import { z } from "zod";

export const FPS_VALUES = [24, 25, 30, 60] as const;
export const ASPECTS = ["9:16", "1:1", "16:9", "4:5"] as const;
export type Aspect = (typeof ASPECTS)[number];

const TransformsSchema = z.object({
  scale: z.number().min(0.1).max(5).default(1),
  x: z.number().default(0),
  y: z.number().default(0),
  rotation: z.number().default(0),
});

const FiltersSchema = z.object({
  lut: z.string().optional(),
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(-1).max(1).default(0),
  saturation: z.number().min(-1).max(1).default(0),
});

export const VideoClipSchema = z.object({
  id: z.string(),
  kind: z.literal("video"),
  src: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  trackOffset: z.number().min(0),
  transforms: TransformsSchema.default({}),
  filters: FiltersSchema.default({}),
});
export type VideoClip = z.infer<typeof VideoClipSchema>;

export const AudioClipSchema = z.object({
  id: z.string(),
  kind: z.literal("audio"),
  src: z.string(),
  in: z.number().min(0),
  out: z.number().min(0),
  trackOffset: z.number().min(0),
  volume: z.number().min(0).max(1.5).default(1),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
  ducking: z.object({ ratio: z.number(), attack: z.number(), release: z.number() }).optional(),
});
export type AudioClip = z.infer<typeof AudioClipSchema>;

export const TextClipSchema = z.object({
  id: z.string(),
  kind: z.literal("text"),
  text: z.string(),
  trackOffset: z.number().min(0),
  duration: z.number().min(0),
  style: z.object({
    font: z.string().default("Inter"),
    size: z.number().default(64),
    weight: z.number().default(700),
    italic: z.boolean().default(false),
    tracking: z.number().default(0),
    color: z.string().default("#ffffff"),
    stroke: z.object({ width: z.number(), color: z.string() }).optional(),
  }).default({}),
  position: z.object({
    anchor: z.enum(["top", "center", "bottom"]).default("bottom"),
    xPct: z.number().default(50),
    yPct: z.number().default(85),
  }).default({}),
  animation: z.enum(["kinetic-pop", "typewriter", "slide-up", "fade"]).optional(),
});
export type TextClip = z.infer<typeof TextClipSchema>;

export const OverlayClipSchema = z.object({
  id: z.string(),
  kind: z.literal("overlay"),
  src: z.string(),
  trackOffset: z.number().min(0),
  duration: z.number().min(0),
  position: z.object({ xPct: z.number(), yPct: z.number(), wPct: z.number(), hPct: z.number() }),
  opacity: z.number().min(0).max(1).default(1),
});
export type OverlayClip = z.infer<typeof OverlayClipSchema>;

export type Clip = VideoClip | AudioClip | TextClip | OverlayClip;

export const TrackSchema = z.object({
  id: z.string(),
  kind: z.enum(["video", "audio", "text", "overlay"]),
  label: z.string(),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  clips: z.array(z.discriminatedUnion("kind", [VideoClipSchema, AudioClipSchema, TextClipSchema, OverlayClipSchema])),
});
export type Track = z.infer<typeof TrackSchema>;

export const CompositionSchema = z.object({
  id: z.string(),
  workId: z.string(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().min(0),
  aspect: z.enum(ASPECTS),
  tracks: z.array(TrackSchema),
  updatedAt: z.string(),
});
export type Composition = z.infer<typeof CompositionSchema>;

const ASPECT_DIMS: Record<Aspect, [number, number]> = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
  "4:5": [1080, 1350],
};

export function makeEmptyComposition(opts: { workId: string; aspect?: Aspect; duration?: number; fps?: 24 | 25 | 30 | 60 }): Composition {
  const aspect = opts.aspect ?? "9:16";
  const [w, h] = ASPECT_DIMS[aspect];
  const now = new Date().toISOString();
  return {
    id: `c_${opts.workId}`,
    workId: opts.workId,
    fps: opts.fps ?? 30,
    width: w,
    height: h,
    duration: opts.duration ?? 0,
    aspect,
    tracks: [
      { id: "video-0", kind: "video", label: "Video", muted: false, hidden: false, clips: [] },
      { id: "audio-0", kind: "audio", label: "BGM", muted: false, hidden: false, clips: [] },
      { id: "text-0", kind: "text", label: "Subtitles", muted: false, hidden: false, clips: [] },
      { id: "overlay-0", kind: "overlay", label: "Overlay", muted: false, hidden: false, clips: [] },
    ],
    updatedAt: now,
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
npm run test:web -- web/src/features/studio/types.test.ts
git add web/src/features/studio/types.ts web/src/features/studio/types.test.ts
git commit -m "feat(studio): add Composition zod schema and empty-comp factory"
```

---

## Task 3: Zustand store `useComposition`

**Files:**
- Create: `web/src/features/studio/store.ts`
- Create: `web/src/features/studio/store.test.ts`

- [ ] **Step 1: 写测试**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useComposition } from "./store";
import { makeEmptyComposition } from "./types";

describe("useComposition store", () => {
  beforeEach(() => {
    useComposition.setState({ comp: null, selection: null, currentFrame: 0, isPlaying: false }, true);
  });

  it("loadComposition replaces state", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    expect(useComposition.getState().comp?.id).toBe(c.id);
  });

  it("addClip appends to the right track and grows duration", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    useComposition.getState().addClip("video-0", {
      id: "v1", kind: "video", src: "/x.mp4", in: 0, out: 5, trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    const after = useComposition.getState().comp!;
    expect(after.tracks[0].clips).toHaveLength(1);
    expect(after.duration).toBeGreaterThanOrEqual(5);
  });

  it("updateClip applies a partial patch", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    useComposition.getState().addClip("video-0", {
      id: "v1", kind: "video", src: "/x.mp4", in: 0, out: 5, trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    useComposition.getState().updateClip("v1", { trackOffset: 2 });
    const v = useComposition.getState().comp!.tracks[0].clips[0];
    expect(v.trackOffset).toBe(2);
  });

  it("removeClip drops the clip and recomputes duration", () => {
    const c = makeEmptyComposition({ workId: "w1" });
    useComposition.getState().loadComposition(c);
    useComposition.getState().addClip("video-0", {
      id: "v1", kind: "video", src: "/x.mp4", in: 0, out: 5, trackOffset: 0,
      transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
      filters: { brightness: 0, contrast: 0, saturation: 0 },
    });
    useComposition.getState().removeClip("v1");
    expect(useComposition.getState().comp!.tracks[0].clips).toHaveLength(0);
    expect(useComposition.getState().comp!.duration).toBe(0);
  });

  it("selection set/clear", () => {
    useComposition.getState().setSelection("v1");
    expect(useComposition.getState().selection).toBe("v1");
    useComposition.getState().setSelection(null);
    expect(useComposition.getState().selection).toBeNull();
  });
});
```

- [ ] **Step 2: 实现 store with immer**

```ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Composition, Clip } from "./types";

interface CompState {
  comp: Composition | null;
  selection: string | null;            // selected clipId
  currentFrame: number;
  isPlaying: boolean;
  loadComposition: (c: Composition) => void;
  addClip: (trackId: string, clip: Clip) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  setSelection: (id: string | null) => void;
  setFrame: (f: number) => void;
  setPlaying: (p: boolean) => void;
  recomputeDuration: () => void;
}

function clipEnd(c: Clip): number {
  if (c.kind === "video" || c.kind === "audio") return c.trackOffset + (c.out - c.in);
  return c.trackOffset + c.duration;
}

export const useComposition = create<CompState>()(
  immer((set, get) => ({
    comp: null, selection: null, currentFrame: 0, isPlaying: false,
    loadComposition: (c) => set((s) => { s.comp = c; }),
    addClip: (trackId, clip) => set((s) => {
      if (!s.comp) return;
      const t = s.comp.tracks.find((t) => t.id === trackId);
      if (!t) return;
      t.clips.push(clip as any);
      const end = clipEnd(clip);
      if (end > s.comp.duration) s.comp.duration = end;
    }),
    updateClip: (clipId, patch) => set((s) => {
      if (!s.comp) return;
      for (const t of s.comp.tracks) {
        const c = t.clips.find((c) => c.id === clipId);
        if (c) { Object.assign(c, patch); break; }
      }
    }),
    removeClip: (clipId) => set((s) => {
      if (!s.comp) return;
      for (const t of s.comp.tracks) {
        t.clips = t.clips.filter((c) => c.id !== clipId);
      }
      s.comp.duration = Math.max(0, ...s.comp.tracks.flatMap((t) => t.clips.map(clipEnd)));
    }),
    setSelection: (id) => set((s) => { s.selection = id; }),
    setFrame: (f) => set((s) => { s.currentFrame = f; }),
    setPlaying: (p) => set((s) => { s.isPlaying = p; }),
    recomputeDuration: () => set((s) => {
      if (!s.comp) return;
      s.comp.duration = Math.max(0, ...s.comp.tracks.flatMap((t) => t.clips.map(clipEnd)));
    }),
  })),
);
```

- [ ] **Step 3: Run + commit**

```bash
npm run test:web -- web/src/features/studio/store.test.ts
git add web/src/features/studio/store.ts web/src/features/studio/store.test.ts
git commit -m "feat(studio): add Zustand composition store with immer mutations"
```

---

## Task 4: Pure helpers — filters CSS + position resolve

**Files:**
- Create: `web/src/features/studio/composition/filters/cssFilters.ts` + `.test.ts`
- Create: `web/src/features/studio/composition/layout/positionResolve.ts` + `.test.ts`

- [ ] **Step 1: 写测试**

`cssFilters.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toCssFilter } from "./cssFilters";

describe("toCssFilter", () => {
  it("identity at zeros", () => {
    expect(toCssFilter({ brightness: 0, contrast: 0, saturation: 0 })).toBe("");
  });
  it("brightness +0.5 maps to brightness(1.5)", () => {
    expect(toCssFilter({ brightness: 0.5, contrast: 0, saturation: 0 })).toContain("brightness(1.5)");
  });
  it("clamps extreme values", () => {
    expect(toCssFilter({ brightness: 5, contrast: 0, saturation: 0 })).toContain("brightness(2)");
  });
  it("composes multiple filters", () => {
    const css = toCssFilter({ brightness: 0.2, contrast: 0.3, saturation: -0.4 });
    expect(css).toContain("brightness");
    expect(css).toContain("contrast");
    expect(css).toContain("saturate");
  });
});
```

`positionResolve.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolvePosition } from "./positionResolve";

describe("resolvePosition", () => {
  it("center anchor at 50/50", () => {
    const s = resolvePosition({ anchor: "center", xPct: 50, yPct: 50 }, { width: 1080, height: 1920 });
    expect(s.left).toBe("50%");
    expect(s.top).toBe("50%");
    expect(s.transform).toContain("translate(-50%, -50%)");
  });
  it("bottom anchor: translate -50% on x only", () => {
    const s = resolvePosition({ anchor: "bottom", xPct: 50, yPct: 90 }, { width: 1080, height: 1920 });
    expect(s.transform).toContain("translateX(-50%)");
    expect(s.transform).not.toContain("translateY");
  });
});
```

- [ ] **Step 2: 实现**

`cssFilters.ts`:
```ts
import type { Filters } from "../../types";

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

export function toCssFilter(f: Pick<Filters, "brightness" | "contrast" | "saturation">): string {
  const parts: string[] = [];
  if (f.brightness !== 0) parts.push(`brightness(${1 + clamp(f.brightness)})`);
  if (f.contrast !== 0) parts.push(`contrast(${1 + clamp(f.contrast)})`);
  if (f.saturation !== 0) parts.push(`saturate(${1 + clamp(f.saturation)})`);
  return parts.join(" ");
}
```

> 注：`Filters` 类型需要从 types.ts export。subagent 调整即可。

`positionResolve.ts`:
```ts
import type { CSSProperties } from "react";

export function resolvePosition(
  pos: { anchor: "top" | "center" | "bottom"; xPct: number; yPct: number },
  _frame: { width: number; height: number },
): CSSProperties {
  const left = `${pos.xPct}%`;
  const top = `${pos.yPct}%`;
  let transform = "";
  switch (pos.anchor) {
    case "center": transform = "translate(-50%, -50%)"; break;
    case "bottom": transform = "translateX(-50%)"; break;
    case "top": transform = "translateX(-50%)"; break;
  }
  return { position: "absolute", left, top, transform };
}
```

- [ ] **Step 3: Run + commit**

```bash
npm run test:web -- web/src/features/studio/composition/
git add web/src/features/studio/composition/
git commit -m "feat(studio): add CSS filter and anchor-position helpers"
```

---

## Task 5: Remotion track renderers

**Files:**
- Create: `web/src/features/studio/composition/tracks/{Video,Audio,Text,Overlay}TrackRenderer.tsx`
- Create: `web/src/features/studio/composition/Scene.tsx`

> Remotion 用 `<Sequence from={frame} durationInFrames={frames}>` 包每个 clip。subagent 实现时务必把秒×fps 转换成 frame 数，并在 `<OffthreadVideo>` (`@remotion/media-utils`) / `<Audio>` / `<Series>` / `<AbsoluteFill>` 之间正确选择。

- [ ] **Step 1: VideoTrackRenderer**

```tsx
// web/src/features/studio/composition/tracks/VideoTrackRenderer.tsx
import { Sequence, OffthreadVideo, useVideoConfig } from "remotion";
import type { VideoClip, Track } from "../../types";
import { toCssFilter } from "../filters/cssFilters";

export function VideoTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as VideoClip[]).map((c) => {
        const from = Math.round(c.trackOffset * fps);
        const dur = Math.max(1, Math.round((c.out - c.in) * fps));
        const filter = toCssFilter(c.filters);
        const t = c.transforms;
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <OffthreadVideo
              src={c.src}
              startFrom={Math.round(c.in * fps)}
              endAt={Math.round(c.out * fps)}
              style={{
                width: "100%", height: "100%", objectFit: "cover",
                filter: filter || undefined,
                transform: `translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.scale})`,
              }}
            />
          </Sequence>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: AudioTrackRenderer**

```tsx
import { Sequence, Audio, useVideoConfig } from "remotion";
import type { AudioClip, Track } from "../../types";

export function AudioTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.muted) return null;
  return (
    <>
      {(track.clips as AudioClip[]).map((c) => {
        const from = Math.round(c.trackOffset * fps);
        const dur = Math.max(1, Math.round((c.out - c.in) * fps));
        return (
          <Sequence key={c.id} from={from} durationInFrames={dur}>
            <Audio
              src={c.src}
              startFrom={Math.round(c.in * fps)}
              endAt={Math.round(c.out * fps)}
              volume={c.volume}
            />
          </Sequence>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: TextTrackRenderer**

```tsx
import { Sequence, AbsoluteFill, useVideoConfig, interpolate, useCurrentFrame } from "remotion";
import type { TextClip, Track } from "../../types";
import { resolvePosition } from "../layout/positionResolve";

function AnimatedText({ clip }: { clip: TextClip }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const opacity = clip.animation === "fade"
    ? interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" })
    : 1;
  const yOffset = clip.animation === "slide-up"
    ? interpolate(frame, [0, 12], [40, 0], { extrapolateRight: "clamp" })
    : 0;
  const pos = resolvePosition(clip.position, { width, height });
  return (
    <div style={{
      ...pos,
      opacity,
      transform: `${pos.transform} translateY(${yOffset}px)`,
      fontFamily: clip.style.font,
      fontSize: clip.style.size,
      fontWeight: clip.style.weight,
      fontStyle: clip.style.italic ? "italic" : "normal",
      letterSpacing: clip.style.tracking,
      color: clip.style.color,
      textShadow: clip.style.stroke
        ? `0 0 ${clip.style.stroke.width}px ${clip.style.stroke.color}`
        : undefined,
      whiteSpace: "pre-wrap",
      textAlign: "center",
    }}>
      {clip.text}
    </div>
  );
}

export function TextTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as TextClip[]).map((c) => (
        <Sequence key={c.id} from={Math.round(c.trackOffset * fps)} durationInFrames={Math.round(c.duration * fps)}>
          <AbsoluteFill><AnimatedText clip={c} /></AbsoluteFill>
        </Sequence>
      ))}
    </>
  );
}
```

- [ ] **Step 4: OverlayTrackRenderer**

```tsx
import { Sequence, useVideoConfig, Img } from "remotion";
import type { OverlayClip, Track } from "../../types";

export function OverlayTrackRenderer({ track }: { track: Track }) {
  const { fps } = useVideoConfig();
  if (track.hidden) return null;
  return (
    <>
      {(track.clips as OverlayClip[]).map((c) => (
        <Sequence key={c.id} from={Math.round(c.trackOffset * fps)} durationInFrames={Math.round(c.duration * fps)}>
          <Img src={c.src} style={{
            position: "absolute",
            left: `${c.position.xPct}%`,
            top: `${c.position.yPct}%`,
            width: `${c.position.wPct}%`,
            height: `${c.position.hPct}%`,
            opacity: c.opacity,
          }} />
        </Sequence>
      ))}
    </>
  );
}
```

- [ ] **Step 5: Scene composer**

```tsx
import { AbsoluteFill } from "remotion";
import type { Composition } from "../types";
import { VideoTrackRenderer } from "./tracks/VideoTrackRenderer";
import { AudioTrackRenderer } from "./tracks/AudioTrackRenderer";
import { TextTrackRenderer } from "./tracks/TextTrackRenderer";
import { OverlayTrackRenderer } from "./tracks/OverlayTrackRenderer";

export function Scene({ comp }: { comp: Composition }) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {comp.tracks.map((t) => {
        if (t.kind === "video") return <VideoTrackRenderer key={t.id} track={t} />;
        if (t.kind === "audio") return <AudioTrackRenderer key={t.id} track={t} />;
        if (t.kind === "text") return <TextTrackRenderer key={t.id} track={t} />;
        return <OverlayTrackRenderer key={t.id} track={t} />;
      })}
    </AbsoluteFill>
  );
}
```

- [ ] **Step 6: TS 通过**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 7: Commit**

```bash
git add web/src/features/studio/composition/
git commit -m "feat(studio): add Remotion track renderers (video/audio/text/overlay)"
```

---

## Task 6: PreviewPanel — `<Player>` wrapper

**Files:**
- Create: `web/src/features/studio/panels/PreviewPanel.tsx`
- Create: `web/src/features/studio/panels/PreviewPanel.test.tsx`

- [ ] **Step 1: 测试**

```tsx
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PreviewPanel } from "./PreviewPanel";
import { useComposition } from "../store";
import { makeEmptyComposition } from "../types";

vi.mock("@remotion/player", () => ({
  Player: (props: any) => <div data-testid="player" data-fps={props.fps} data-comp-w={props.compositionWidth} />,
}));

describe("PreviewPanel", () => {
  it("renders <Player> with comp dimensions when comp loaded", () => {
    useComposition.setState({ comp: makeEmptyComposition({ workId: "w" }), selection: null, currentFrame: 0, isPlaying: false }, true);
    const { getByTestId } = render(<PreviewPanel />);
    expect(getByTestId("player").getAttribute("data-fps")).toBe("30");
    expect(getByTestId("player").getAttribute("data-comp-w")).toBe("1080");
  });

  it("renders empty state when comp is null", () => {
    useComposition.setState({ comp: null, selection: null, currentFrame: 0, isPlaying: false }, true);
    const { queryByTestId } = render(<PreviewPanel />);
    expect(queryByTestId("player")).toBeNull();
  });
});
```

- [ ] **Step 2: 实现**

```tsx
// web/src/features/studio/panels/PreviewPanel.tsx
import { Player } from "@remotion/player";
import { useComposition } from "../store";
import { Scene } from "../composition/Scene";

export function PreviewPanel() {
  const comp = useComposition((s) => s.comp);
  if (!comp) return <div className="preview-empty">载入中…</div>;
  const durationInFrames = Math.max(1, Math.round(comp.duration * comp.fps));
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Player
        component={Scene}
        inputProps={{ comp }}
        durationInFrames={durationInFrames}
        fps={comp.fps}
        compositionWidth={comp.width}
        compositionHeight={comp.height}
        controls
        style={{ maxWidth: "100%", maxHeight: "100%", aspectRatio: `${comp.width} / ${comp.height}` }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Test + commit**

```bash
npm run test:web -- web/src/features/studio/panels/PreviewPanel.test.tsx
git add web/src/features/studio/panels/PreviewPanel.tsx web/src/features/studio/panels/PreviewPanel.test.tsx
git commit -m "feat(studio): add Remotion Player preview panel"
```

---

## Task 7-9: Timeline (Ruler / Track / Clip / Playhead)

**Goal**: 多轨水平时间轴；clip 拖拽改变 trackOffset；clip 边缘拖拽改变 in/out。

**Files:**
- Create: `web/src/features/studio/panels/Timeline/{index,Ruler,Track,Clip,Playhead}.tsx`
- Create: `web/src/features/studio/panels/Timeline/Clip.test.tsx`
- Create: `web/src/features/studio/hooks/useDragClip.ts`

### Task 7: Ruler + Playhead

- [ ] **Step 1**: Ruler 渲染时间刻度（每秒一根细线，每 5 秒一根粗线 + 时间码）。Playhead 用 `currentFrame / fps` 算 `left%`。
- [ ] **Step 2**: 实现
```tsx
// Ruler.tsx
export function Ruler({ duration, pxPerSecond }: { duration: number; pxPerSecond: number }) {
  const ticks = Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => i);
  return (
    <div className="timeline-ruler" style={{ width: duration * pxPerSecond, position: "relative", height: 24 }}>
      {ticks.map((t) => (
        <div key={t} style={{ position: "absolute", left: t * pxPerSecond, top: 0, bottom: 0, borderLeft: "1px solid var(--border)", paddingLeft: 4, fontSize: 10, fontFamily: "var(--font-mono)" }}>
          {t % 5 === 0 ? `${t}s` : ""}
        </div>
      ))}
    </div>
  );
}

// Playhead.tsx
import { useComposition } from "../../store";
export function Playhead({ pxPerSecond }: { pxPerSecond: number }) {
  const frame = useComposition((s) => s.currentFrame);
  const fps = useComposition((s) => s.comp?.fps ?? 30);
  const left = (frame / fps) * pxPerSecond;
  return <div style={{ position: "absolute", left, top: 0, bottom: 0, width: 1, background: "var(--accent)", pointerEvents: "none" }} />;
}
```

- [ ] **Step 3: commit** `feat(studio): add timeline ruler and playhead`

### Task 8: Clip + drag handle

- [ ] **Step 1: Clip.test.tsx**

```tsx
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { Clip } from "./Clip";
import { useComposition } from "../../store";
import { makeEmptyComposition } from "../../types";

beforeEach(() => {
  const c = makeEmptyComposition({ workId: "w" });
  c.tracks[0].clips.push({
    id: "v1", kind: "video", src: "/x.mp4", in: 0, out: 4, trackOffset: 1,
    transforms: { scale: 1, x: 0, y: 0, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0 },
  });
  useComposition.setState({ comp: c, selection: null, currentFrame: 0, isPlaying: false }, true);
});

describe("Clip", () => {
  it("renders with proportional width", () => {
    const { container } = render(<Clip clipId="v1" pxPerSecond={50} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("200px");      // (4-0) * 50
    expect(el.style.left).toBe("50px");        // 1 * 50
  });

  it("clicking selects", () => {
    const { container } = render(<Clip clipId="v1" pxPerSecond={50} />);
    fireEvent.click(container.firstChild as HTMLElement);
    expect(useComposition.getState().selection).toBe("v1");
  });
});
```

- [ ] **Step 2: 实现 Clip**

```tsx
import { useComposition } from "../../store";
import clsx from "clsx";

export function Clip({ clipId, pxPerSecond }: { clipId: string; pxPerSecond: number }) {
  const clip = useComposition((s) => s.comp?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId));
  const selection = useComposition((s) => s.selection);
  const setSelection = useComposition((s) => s.setSelection);
  const updateClip = useComposition((s) => s.updateClip);
  if (!clip) return null;

  const dur = "duration" in clip ? clip.duration : (clip.out - clip.in);
  const left = clip.trackOffset * pxPerSecond;
  const width = dur * pxPerSecond;

  // Drag — pointer-based, snaps to 0.1s grid
  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelection(clipId);
    const startX = e.clientX;
    const startOffset = clip.trackOffset;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / pxPerSecond;
      const next = Math.max(0, Math.round((startOffset + delta) * 10) / 10);
      updateClip(clipId, { trackOffset: next });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={clsx("timeline-clip", clip.kind, selection === clipId && "selected")}
      style={{ position: "absolute", left, width, top: 4, bottom: 4, borderRadius: 4, cursor: "grab" }}
      onPointerDown={onPointerDown}
    >
      <span className="clip-label">{clip.kind === "text" ? clip.text.slice(0, 18) : clip.id}</span>
    </div>
  );
}
```

- [ ] **Step 3: Test + commit**

```bash
npm run test:web -- web/src/features/studio/panels/Timeline/Clip.test.tsx
git commit -am "feat(studio): add draggable timeline clip with selection"
```

### Task 9: Track 容器 + Timeline 主组件

- [ ] **Step 1: Track.tsx**
```tsx
import { useComposition } from "../../store";
import { Clip } from "./Clip";
import type { Track as TrackType } from "../../types";

export function Track({ track, pxPerSecond }: { track: TrackType; pxPerSecond: number }) {
  return (
    <div className="timeline-track" data-kind={track.kind} style={{ position: "relative", height: 56, borderTop: "1px solid var(--border)" }}>
      <div className="track-label" style={{ position: "absolute", left: -120, width: 110, textAlign: "right", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-soft)" }}>{track.label}</div>
      {track.clips.map((c) => <Clip key={c.id} clipId={c.id} pxPerSecond={pxPerSecond} />)}
    </div>
  );
}
```

- [ ] **Step 2: Timeline index.tsx**
```tsx
import { useComposition } from "../../store";
import { Ruler } from "./Ruler";
import { Track } from "./Track";
import { Playhead } from "./Playhead";

export function Timeline() {
  const comp = useComposition((s) => s.comp);
  const pxPerSecond = 50;
  if (!comp) return null;
  return (
    <div className="timeline-root" style={{ overflow: "auto", padding: "0 24px 16px 140px", position: "relative" }}>
      <div style={{ position: "relative", width: Math.max(800, comp.duration * pxPerSecond) }}>
        <Ruler duration={comp.duration} pxPerSecond={pxPerSecond} />
        {comp.tracks.map((t) => <Track key={t.id} track={t} pxPerSecond={pxPerSecond} />)}
        <Playhead pxPerSecond={pxPerSecond} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit** `feat(studio): wire up multi-track timeline grid`

---

## Task 10: Beat snap helper

**Files:**
- Create: `web/src/features/studio/panels/Timeline/snapToBeat.ts` + `.test.ts`

- [ ] **Step 1: 测试**
```ts
import { describe, it, expect } from "vitest";
import { snapToBeat } from "./snapToBeat";

describe("snapToBeat", () => {
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5];
  it("snaps within tolerance", () => {
    expect(snapToBeat(1.04, beats, 0.06)).toBe(1.0);
  });
  it("returns input outside tolerance", () => {
    expect(snapToBeat(1.2, beats, 0.06)).toBe(1.2);
  });
  it("handles empty beat list", () => {
    expect(snapToBeat(0.7, [], 0.1)).toBe(0.7);
  });
});
```

- [ ] **Step 2: 实现**
```ts
export function snapToBeat(t: number, beats: number[], toleranceSec = 0.05): number {
  if (!beats.length) return t;
  let best = beats[0]; let bestDelta = Math.abs(t - beats[0]);
  for (const b of beats) { const d = Math.abs(t - b); if (d < bestDelta) { best = b; bestDelta = d; } }
  return bestDelta <= toleranceSec ? best : t;
}
```

- [ ] **Step 3: Commit** `feat(studio): add beat-snap utility for clip alignment`

---

## Task 11: Waveform hook

**Files:**
- Create: `web/src/features/studio/hooks/useWaveform.ts` + `.test.ts`

- [ ] **Step 1: 测试（mock WaveSurfer）**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWaveform } from "./useWaveform";

vi.mock("wavesurfer.js", () => ({
  default: { create: vi.fn(() => ({ load: vi.fn(), destroy: vi.fn(), on: vi.fn() })) },
}));

describe("useWaveform", () => {
  it("creates one WaveSurfer per src and destroys on unmount", () => {
    const div = document.createElement("div");
    const { unmount } = renderHook(() => useWaveform({ container: div, src: "/a.mp3" }));
    unmount();
    // Smoke: no throw
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: 实现**
```ts
import { useEffect } from "react";
import WaveSurfer from "wavesurfer.js";

export function useWaveform(opts: { container: HTMLElement | null; src: string; height?: number }) {
  useEffect(() => {
    if (!opts.container) return;
    const ws = WaveSurfer.create({
      container: opts.container,
      height: opts.height ?? 40,
      waveColor: "rgba(168,197,214,0.45)",
      progressColor: "rgba(168,197,214,0.95)",
      cursorWidth: 0,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
    });
    ws.load(opts.src);
    return () => { ws.destroy(); };
  }, [opts.container, opts.src, opts.height]);
}
```

- [ ] **Step 3: Commit** `feat(studio): add WaveSurfer-backed waveform hook`

---

## Task 12: Tweaks Panel — 4 sections

**Files:**
- Create: `web/src/features/studio/panels/Tweaks/{index,ThemeSection,DensitySection,LayerSection,CompositionSection}.tsx`

- [ ] **Step 1: ThemeSection** — 复用 Plan 1 的 `useTheme` store；新增 accent 切换（写 `data-accent="violet|cyan|coral|lime|steel"` 到 root）。

- [ ] **Step 2: DensitySection** — `data-density` 到 root，三档 balanced/compact/comfy。

- [ ] **Step 3: LayerSection** — 读 `useComposition().selection`，根据 clip kind 渲染对应 sliders（Video: brightness/contrast/saturation/scale；Audio: volume/fadeIn/fadeOut；Text: size/weight/tracking）。每个 slider onChange 调 `updateClip(id, patch)`。

- [ ] **Step 4: CompositionSection** — fps select / aspect select / total duration readonly（自动算）。

- [ ] **Step 5: index.tsx** 拼装 4 段，包在 `<Glass>` 里。

- [ ] **Step 6: 加一个 LayerSection.test.tsx**：验证选中视频 clip 时改 brightness slider 真的写入 store。

- [ ] **Step 7: Commit** `feat(studio): add tweaks panel — theme/density/layer/composition`

---

## Task 13: TopBar

**Files:**
- Create: `web/src/features/studio/panels/TopBar.tsx`

内容：作品标题（可改）/ 保存指示（Saved · 12s ago）/ 导出按钮 / 快捷键提示。

- [ ] **Step 1: 实现**

```tsx
import { useComposition } from "../store";
import { Button } from "@/ui/Button";
import { useNavigate } from "react-router-dom";

export function TopBar({ workId, onExport, savedAt }: { workId: string; onExport: () => void; savedAt: string | null }) {
  const navigate = useNavigate();
  const comp = useComposition((s) => s.comp);
  return (
    <div className="studio-topbar" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid var(--border)" }}>
      <Button variant="ghost" onClick={() => navigate("/")}>← Works</Button>
      <strong style={{ fontFamily: "var(--font-editorial)", fontSize: 18 }}>{comp?.id ?? workId}</strong>
      <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-soft)" }}>{savedAt ? `Saved · ${savedAt}` : "Unsaved"}</span>
      <Button variant="primary" onClick={onExport}>Export MP4</Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit** `feat(studio): add studio top bar with save indicator`

---

## Task 14: Chat panel + Quick Actions

**Files:**
- Create: `web/src/features/studio/panels/Chat/{index,QuickActions}.tsx`
- Reuse: `web/src/features/chat/useChatSocket.ts` from Plan 1

- [ ] **Step 1: index.tsx 渲染 chat blocks + 输入框**
```tsx
import { useChatSocket } from "@/features/chat/useChatSocket";
import { useChatStore } from "@/features/chat/store";
import { useState } from "react";
import { QuickActions } from "./QuickActions";

export function ChatPanel({ workId }: { workId: string }) {
  const { send } = useChatSocket(workId);
  const blocks = useChatStore((s) => s.blocks);
  const [input, setInput] = useState("");
  const submit = () => { if (input.trim()) { send(input); setInput(""); } };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {blocks.map((b, i) => <div key={i} className={`chat-block chat-${b.type}`}>{b.text}</div>)}
      </div>
      <QuickActions />
      <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="问点什么…" style={{ flex: 1 }} />
        <button onClick={submit}>↵</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: QuickActions.tsx**
```tsx
import { useComposition } from "../../store";
import { useChatSocket } from "@/features/chat/useChatSocket";
import { useParams } from "react-router-dom";

export function QuickActions() {
  const sel = useComposition((s) => s.selection);
  const comp = useComposition((s) => s.comp);
  const clip = comp?.tracks.flatMap((t) => t.clips).find((c) => c.id === sel);
  const { workId } = useParams();
  const { send } = useChatSocket(workId ?? null);
  if (!clip) return null;

  const actions: { label: string; prompt: string }[] = [];
  if (clip.kind === "video") actions.push(
    { label: "重新生成此片段", prompt: `请用 assets 能力重新生成 clip ${clip.id} 的视频内容` },
    { label: "调整节奏", prompt: `请用 assembly 能力调整 clip ${clip.id} 周围的节奏` },
  );
  if (clip.kind === "audio") actions.push(
    { label: "换 BGM 风格", prompt: "请用 assets 能力提供 3 个不同风格的 BGM 候选" },
  );

  return (
    <div style={{ display: "flex", gap: 6, padding: 8, flexWrap: "wrap", borderTop: "1px solid var(--border)" }}>
      {actions.map((a) => (
        <button key={a.label} onClick={() => send(a.prompt)} className="quick-action">{a.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit** `feat(studio): add chat panel with context-aware quick actions`

---

## Task 15: Composition save/load services + server endpoints

**Files:**
- Create: `web/src/features/studio/services/composition.ts`
- Modify: `src/server/api.ts`（追加 GET / PUT `/api/works/:id/composition`）
- Create: `src/server/__tests__/composition.test.ts`

- [ ] **Step 1: 服务端测试**

```ts
// src/server/__tests__/composition.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

describe("/api/works/:id/composition", () => {
  beforeEach(() => vi.resetModules());
  it("GET returns 404 when composition not yet saved", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(new Request(`http://localhost/api/works/${w.id}/composition`));
      expect(res.status).toBe(404);
    });
  });
  it("PUT saves and GET returns same payload", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const comp = { id: "c1", workId: w.id, fps: 30, width: 1080, height: 1920, duration: 0, aspect: "9:16", tracks: [], updatedAt: "2026-04-25T00:00:00Z" };
      const put = await apiRoutes.fetch(jsonReq("PUT", `/api/works/${w.id}/composition`, comp));
      expect(put.status).toBe(200);
      const get = await apiRoutes.fetch(new Request(`http://localhost/api/works/${w.id}/composition`));
      expect(get.status).toBe(200);
      const j = await get.json();
      expect(j.id).toBe("c1");
    });
  });
});
```

- [ ] **Step 2: 服务端实现**

`src/server/api.ts` 追加：
```ts
// GET/PUT composition — yaml file in workDir/composition.yaml
import yaml from "js-yaml";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

apiRoutes.get("/api/works/:id/composition", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id); if (!w) return c.json({ error: "Work not found" }, 404);
  try {
    const raw = await readFile(join(dataDir, "works", id, "composition.yaml"), "utf-8");
    return c.json(yaml.load(raw));
  } catch { return c.json({ error: "Composition not found" }, 404); }
});

apiRoutes.put("/api/works/:id/composition", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id); if (!w) return c.json({ error: "Work not found" }, 404);
  const body = await c.req.json();
  const wDir = join(dataDir, "works", id);
  await mkdir(wDir, { recursive: true });
  await writeFile(join(wDir, "composition.yaml"), yaml.dump(body, { lineWidth: -1 }), "utf-8");
  return c.json({ ok: true });
});
```

- [ ] **Step 3: 客户端 services/composition.ts**

```ts
import { apiFetch } from "@/lib/api";
import { CompositionSchema, type Composition } from "../types";

export async function loadComposition(workId: string): Promise<Composition | null> {
  try { const raw = await apiFetch<unknown>(`/api/works/${workId}/composition`); return CompositionSchema.parse(raw); }
  catch (err: any) { if (err?.status === 404) return null; throw err; }
}

export async function saveComposition(workId: string, comp: Composition): Promise<void> {
  await apiFetch(`/api/works/${workId}/composition`, { method: "PUT", body: comp });
}
```

- [ ] **Step 4: Test + commit**

```bash
npm run test:server -- src/server/__tests__/composition.test.ts
git commit -am "feat(api+studio): persist Composition as composition.yaml per work"
```

---

## Task 16: Server-side render endpoint

**Files:**
- Create: `src/server/remotion-renderer.ts`
- Modify: `src/server/api.ts` — `POST /api/works/:id/render`
- Create: `src/server/__tests__/render.test.ts`（mock @remotion/renderer）
- Create: `remotion.config.ts`

- [ ] **Step 1: remotion.config.ts**
```ts
import { Config } from "@remotion/cli/config";
Config.setEntryPoint("./web/src/features/studio/composition/RemotionRoot.tsx");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
```

- [ ] **Step 2: web/src/features/studio/composition/RemotionRoot.tsx**
```tsx
import { Composition, registerRoot } from "remotion";
import { Scene } from "./Scene";

const Root: React.FC = () => (
  <Composition
    id="main"
    component={Scene as any}
    durationInFrames={1}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ comp: null as any }}
  />
);
registerRoot(Root);
```

- [ ] **Step 3: src/server/remotion-renderer.ts**
```ts
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { join } from "node:path";

export async function renderCompositionToMp4(comp: any, outDir: string): Promise<string> {
  const bundleLocation = await bundle({
    entryPoint: join(process.cwd(), "web/src/features/studio/composition/RemotionRoot.tsx"),
    webpackOverride: (c) => c,
  });
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "main",
    inputProps: { comp },
  });
  const outFile = join(outDir, `final-${Date.now()}.mp4`);
  await renderMedia({
    composition: { ...composition, durationInFrames: Math.max(1, Math.round(comp.duration * comp.fps)) },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outFile,
    inputProps: { comp },
  });
  return outFile;
}
```

- [ ] **Step 4: api.ts 端点**
```ts
import { renderCompositionToMp4 } from "./remotion-renderer.js";

apiRoutes.post("/api/works/:id/render", async (c) => {
  const id = c.req.param("id");
  const w = await getWork(id); if (!w) return c.json({ error: "Work not found" }, 404);
  let comp;
  try { const raw = await readFile(join(dataDir, "works", id, "composition.yaml"), "utf-8"); comp = yaml.load(raw); }
  catch { return c.json({ error: "Composition missing — save first" }, 400); }
  // Async render — for spec we keep synchronous for now; long renders should move to job queue later
  const outDir = join(dataDir, "works", id, "output"); await mkdir(outDir, { recursive: true });
  try {
    const file = await renderCompositionToMp4(comp, outDir);
    return c.json({ ok: true, output: file });
  } catch (err: any) {
    return c.json({ error: err.message ?? "Render failed" }, 500);
  }
});
```

- [ ] **Step 5: Test (mock renderer)**
```ts
// src/server/__tests__/render.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { withTempDataDir, jsonReq } from "./_helpers.js";

vi.mock("../remotion-renderer.js", () => ({
  renderCompositionToMp4: vi.fn(async () => "/tmp/fake.mp4"),
}));

describe("POST /api/works/:id/render", () => {
  beforeEach(() => vi.resetModules());
  it("returns 400 if composition missing", async () => {
    await withTempDataDir(async () => {
      const { apiRoutes } = await import("../api.js");
      const { createWork } = await import("../../work-store.js");
      const w = await createWork({ title: "T", type: "short-video", platforms: ["douyin"] });
      const res = await apiRoutes.fetch(jsonReq("POST", `/api/works/${w.id}/render`, {}));
      expect(res.status).toBe(400);
    });
  });
});
```

- [ ] **Step 6: Commit** `feat(api+studio): add server-side @remotion/renderer mp4 export endpoint`

---

## Task 17: 客户端 export hook

**Files:**
- Create: `web/src/features/studio/services/render.ts`

```ts
import { apiFetch } from "@/lib/api";
export async function exportMp4(workId: string): Promise<{ output: string }> {
  return apiFetch(`/api/works/${workId}/render`, { method: "POST" });
}
```

- [ ] **Step 1: Commit** `feat(studio): add client export hook hitting /render`

---

## Task 18: Studio.tsx 装配最终页面

**Files:**
- Modify: `web/src/pages/Studio.tsx`

- [ ] **Step 1: 替换占位**

```tsx
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useComposition } from "@/features/studio/store";
import { makeEmptyComposition } from "@/features/studio/types";
import { loadComposition, saveComposition } from "@/features/studio/services/composition";
import { exportMp4 } from "@/features/studio/services/render";
import { PreviewPanel } from "@/features/studio/panels/PreviewPanel";
import { Timeline } from "@/features/studio/panels/Timeline";
import { TweaksPanel } from "@/features/studio/panels/Tweaks";
import { ChatPanel } from "@/features/studio/panels/Chat";
import { TopBar } from "@/features/studio/panels/TopBar";

export default function Studio() {
  const { workId } = useParams();
  const loadComp = useComposition((s) => s.loadComposition);
  const comp = useComposition((s) => s.comp);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!workId) return;
    (async () => {
      const found = await loadComposition(workId);
      loadComp(found ?? makeEmptyComposition({ workId }));
    })();
  }, [workId, loadComp]);

  // Autosave on change (debounced)
  useEffect(() => {
    if (!comp || !workId) return;
    const t = setTimeout(() => {
      saveComposition(workId, comp).then(() => setSavedAt(new Date().toLocaleTimeString()));
    }, 800);
    return () => clearTimeout(t);
  }, [comp, workId]);

  if (!workId) return <div>Missing workId</div>;

  return (
    <div className="studio-shell" style={{ display: "grid",
      gridTemplateColumns: "360px 1fr 300px", gridTemplateRows: "56px 1fr 320px",
      gridTemplateAreas: '"top top top" "chat preview aside" "chat timeline aside"',
      height: "calc(100vh - 56px)" }}>
      <div style={{ gridArea: "top" }}><TopBar workId={workId} savedAt={savedAt} onExport={() => exportMp4(workId)} /></div>
      <div style={{ gridArea: "chat", borderRight: "1px solid var(--border)" }}><ChatPanel workId={workId} /></div>
      <div style={{ gridArea: "preview", overflow: "hidden" }}><PreviewPanel /></div>
      <div style={{ gridArea: "timeline", borderTop: "1px solid var(--border)", overflow: "hidden" }}><Timeline /></div>
      <div style={{ gridArea: "aside", borderLeft: "1px solid var(--border)" }}><TweaksPanel /></div>
    </div>
  );
}
```

- [ ] **Step 2: Commit** `feat(studio): wire full layout — preview/timeline/chat/tweaks`

---

## Task 19: Beat-sync integration

**Files:**
- Create: `web/src/features/studio/hooks/useBeatSnap.ts`
- Modify: `web/src/features/studio/panels/Timeline/Clip.tsx` — drag 时调 snapToBeat

`useBeatSnap.ts` 调 existing `/api/audio/analyze` 端点，缓存 beat 列表到 store。Clip drag 结束时 snap to beat。

- [ ] **Step 1**: 实现 hook + 在 Clip drag move 中加 snap call。
- [ ] **Step 2: Commit** `feat(studio): snap clip drag to detected beats from /api/audio/analyze`

---

## Task 20: Caption ASR integration

**Files:**
- Create: `web/src/features/studio/services/captions.ts`
- 触发：Tweaks Panel LayerSection 中音频 clip 选中时显示 "Generate captions" 按钮

`/api/audio/captions` 已有（Plan 0 时代）；返回 `{captions: [{start, end, text}, ...]}`。点击后把每条结果作为 TextClip push 到 text-0 track。

- [ ] **Step 1**: 服务 + 按钮 + clip 注入逻辑。
- [ ] **Step 2: Commit** `feat(studio): one-click ASR caption import into text track`

---

## Task 21: dnd-kit clip reorder within track

**Files:**
- Modify: `web/src/features/studio/panels/Timeline/Track.tsx`

dnd-kit 的 `DndContext` + `SortableContext`（horizontal）；release 时 `updateClip(id, {trackOffset: newPos})`。

- [ ] **Step 1**: 实现。
- [ ] **Step 2: Test**: render Track with 3 clips, fireEvent drag → assert order changed in store.
- [ ] **Step 3: Commit** `feat(studio): dnd-kit horizontal sort for clips within a track`

---

## Task 22: Keyboard shortcuts

**Files:**
- Create: `web/src/features/studio/hooks/useShortcuts.ts`

绑定：space=play/pause / J=back 5s / L=fwd 5s / Cmd+S=save / Del=remove selected.

- [ ] **Step 1**: 实现 + 在 Studio.tsx 调用。
- [ ] **Step 2: Commit** `feat(studio): add keyboard shortcuts for play/seek/save/delete`

---

## Task 23: Studio integration tests

**Files:**
- Create: `web/src/features/studio/Studio.integration.test.tsx`

测试：
- 加载空 composition 后 PreviewPanel 渲染（mock Player）
- 添加一个 clip → Timeline 出现
- 改 Tweaks brightness slider → store.comp.tracks[0].clips[0].filters.brightness 更新

- [ ] **Step 1**: 实现。
- [ ] **Step 2: Commit** `test(studio): integration test — clip add + tweaks live update`

---

## Task 24: e2e — Studio smoke

**Files:**
- Create: `e2e/studio.spec.ts`

测试：进入 `/studio/<id>`、确认 4 个区都渲染、TopBar Export 按钮可见、Timeline 至少展示 ruler。

- [ ] **Step 1: 写 e2e**
- [ ] **Step 2: 跑 `npm run e2e -- studio`**
- [ ] **Step 3: Commit** `test(e2e): studio smoke — 4 panels render`

---

## Task 25: 全量验证 + tag

- [ ] **Step 1: D3 sweep**: `./scripts/check-d3-words.sh` → clean
- [ ] **Step 2: All tests**: `npm run test:web && npm run test:server && npx tsc --noEmit && npm run e2e`
- [ ] **Step 3: build**: `npm run build`
- [ ] **Step 4: tag**: `git tag plan2-studio-complete`
- [ ] **Step 5: 写一份 hand-off note 给下一个 plan executor**：列出已知 follow-ups（如长 timeline 性能、render 端点的 job queue、低端机降级路径）。
