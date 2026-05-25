# Image-Text Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with Opus subagents (CLAUDE.md hard rule). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 1 落下的 `web/src/pages/Editor.tsx` 占位 shell 填满：4:5 多图轮播画布（react-konva 多图层）+ SlidesNav 排序 + Inspector 三标签（Design / Copy / AI）+ Filmstrip + 单图/批量 PNG 导出。每张图独立 layers 列表（背景 + 文本 + 图像 + 形状 + 贴纸），全部可拖拽缩放旋转。

**Architecture:** Carousel 数据模型对应 N 张 Slides；每张 Slide 含 layers 列表与 background。Konva `<Stage>` 在 canvas 区做实时 WYSIWYG。store 用 Zustand + immer。导出用 `stage.toCanvas()` → `canvas.toBlob('image/png')`，批量则循环每张 slide 临时挂载 stage 出图。Inspector 修改 = store mutation = canvas 重渲染。

**Tech Stack:** React 18 + Zustand + immer + react-konva (Konva 9) + zod + @dnd-kit/sortable（slides 排序）。

---

## 全局硬约束

1. **TDD**：行为变更先写失败测试。
2. **Per-task commit**：conventional commits；message 不出现禁词。
3. **D3 不回潮**：UI/Inspector 文案不出现"下一步""阶段"等。
4. **Subagent 模型固定 Opus**。
5. **Plan 1 已落地是前提**。

## 文件结构

```
web/src/features/editor/
├─ types.ts                    # Carousel / Slide / Layer 类型 + zod
├─ types.test.ts
├─ store.ts                    # Zustand: useEditor (slides, selection, currentSlideId)
├─ store.test.ts
├─ canvas/
│  ├─ Stage.tsx                # Konva <Stage> 包装；监听 store
│  ├─ Stage.test.tsx
│  ├─ layers/
│  │  ├─ TextLayerNode.tsx
│  │  ├─ ImageLayerNode.tsx
│  │  ├─ ShapeLayerNode.tsx
│  │  └─ StickerLayerNode.tsx
│  └─ background/
│     ├─ Background.tsx        # gradient/image/solid
│     └─ Background.test.tsx
├─ panels/
│  ├─ SlidesNav.tsx            # 左侧缩略图列 + dnd-kit 排序
│  ├─ Inspector/
│  │  ├─ index.tsx             # Tabs: Design/Copy/AI
│  │  ├─ DesignTab.tsx
│  │  ├─ CopyTab.tsx
│  │  └─ AITab.tsx
│  ├─ Filmstrip.tsx            # 底部 124px tray with reorder
│  ├─ TopBar.tsx
│  └─ AIHint.tsx               # 左下浮动卡（"第4张密度低"等）
├─ services/
│  ├─ carousel.ts              # GET/PUT /api/works/:id/carousel
│  └─ exportPng.ts             # stage.toCanvas → blob → download
├─ palettes.ts                 # 5 个 preset palettes 定义
├─ hooks/useExport.ts          # 单/批量导出
└─ index.ts

src/server/
├─ api.ts                      # 追加 GET/PUT /api/works/:id/carousel
└─ __tests__/carousel.test.ts
```

---

## Task 1: 装依赖

```bash
npm install --save react-konva@^18.2.0 konva@^9.3.0
```

- [ ] **Step 1**: install + build smoke
- [ ] **Step 2: Commit** `chore(deps): add react-konva for image editor`

---

## Task 2: Carousel / Slide / Layer 类型 + zod

**Files:**
- Create: `web/src/features/editor/types.ts` + `.test.ts`

- [ ] **Step 1: 测试**

```ts
import { describe, it, expect } from "vitest";
import { CarouselSchema, makeEmptyCarousel, makeEmptySlide } from "./types";

describe("Carousel schema", () => {
  it("makes an empty carousel with 1 slide and 4:5 dims", () => {
    const c = makeEmptyCarousel("w1");
    const parsed = CarouselSchema.parse(c);
    expect(parsed.width).toBe(1080);
    expect(parsed.height).toBe(1350);
    expect(parsed.slides).toHaveLength(1);
    expect(parsed.slides[0].layers).toEqual([]);
  });
  it("rejects invalid layout", () => {
    const c = makeEmptyCarousel("w1");
    (c.globals as any).layout = "bogus";
    expect(() => CarouselSchema.parse(c)).toThrow();
  });
  it("makeEmptySlide returns a unique id and gradient bg", () => {
    const s1 = makeEmptySlide();
    const s2 = makeEmptySlide();
    expect(s1.id).not.toBe(s2.id);
    expect(s1.bg.type).toBe("gradient");
  });
});
```

- [ ] **Step 2: 实现 types.ts**

```ts
import { z } from "zod";

export const PALETTE_IDS = ["mono", "pastel", "neon", "earth", "noir"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), rotation: z.number().default(0) });

export const TextLayerSchema = z.object({
  id: z.string(), kind: z.literal("text"), box: Box,
  text: z.string(),
  style: z.object({
    font: z.enum(["serif", "sans", "mono"]).default("sans"),
    size: z.number().default(48),
    weight: z.number().default(700),
    italic: z.boolean().default(false),
    color: z.string().default("#111"),
    align: z.enum(["left", "center", "right"]).default("center"),
    tracking: z.number().default(0),
  }).default({}),
});
export const ImageLayerSchema = z.object({
  id: z.string(), kind: z.literal("image"), box: Box, src: z.string(),
  filters: z.object({ blur: z.number().default(0), brightness: z.number().default(1), opacity: z.number().default(1) }).default({}),
});
export const ShapeLayerSchema = z.object({
  id: z.string(), kind: z.literal("shape"), box: Box,
  shape: z.enum(["rect", "circle", "line"]),
  fill: z.string().default("#0006"),
  stroke: z.string().nullable().default(null),
  strokeWidth: z.number().default(0),
});
export const StickerLayerSchema = z.object({
  id: z.string(), kind: z.literal("sticker"), box: Box, src: z.string(),
});

export const LayerSchema = z.discriminatedUnion("kind", [TextLayerSchema, ImageLayerSchema, ShapeLayerSchema, StickerLayerSchema]);
export type Layer = z.infer<typeof LayerSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;

export const SlideSchema = z.object({
  id: z.string(),
  bg: z.discriminatedUnion("type", [
    z.object({ type: z.literal("gradient"), value: z.string() }),
    z.object({ type: z.literal("image"), value: z.string() }),
    z.object({ type: z.literal("solid"), value: z.string() }),
  ]),
  layers: z.array(LayerSchema),
});
export type Slide = z.infer<typeof SlideSchema>;

export const CarouselSchema = z.object({
  id: z.string(), workId: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  globals: z.object({
    headlineFont: z.enum(["serif", "sans", "mono"]).default("serif"),
    palette: z.enum(PALETTE_IDS).default("mono"),
    layout: z.enum(["centered", "left", "split"]).default("centered"),
    effects: z.object({ grain: z.number().default(0.03), gradient: z.number().default(0.5), sharpen: z.number().default(0) }).default({}),
  }),
  slides: z.array(SlideSchema).min(1),
  updatedAt: z.string(),
});
export type Carousel = z.infer<typeof CarouselSchema>;

let _seq = 0;
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${(++_seq).toString(36)}`;

export function makeEmptySlide(): Slide {
  return { id: uid("s"), bg: { type: "gradient", value: "linear-gradient(135deg, #fafaf7 0%, #e8e6df 100%)" }, layers: [] };
}

export function makeEmptyCarousel(workId: string): Carousel {
  return {
    id: uid("car"), workId,
    width: 1080, height: 1350,
    globals: {
      headlineFont: "serif", palette: "mono", layout: "centered",
      effects: { grain: 0.03, gradient: 0.5, sharpen: 0 },
    },
    slides: [makeEmptySlide()],
    updatedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
npm run test:web -- web/src/features/editor/types.test.ts
git commit -am "feat(editor): add Carousel/Slide/Layer schema + factories"
```

---

## Task 3: Editor store

**Files:**
- Create: `web/src/features/editor/store.ts` + `.test.ts`

- [ ] **Step 1: 测试**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditor } from "./store";
import { makeEmptyCarousel } from "./types";

describe("useEditor store", () => {
  beforeEach(() => useEditor.setState({ car: null, currentSlideId: null, selectionLayerId: null }, true));

  it("loadCarousel selects first slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    expect(useEditor.getState().currentSlideId).toBe(c.slides[0].id);
  });

  it("addSlide appends and selects new slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addSlide();
    expect(useEditor.getState().car!.slides).toHaveLength(2);
    expect(useEditor.getState().currentSlideId).toBe(useEditor.getState().car!.slides[1].id);
  });

  it("addLayer pushes to current slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addLayer({ id: "t1", kind: "text", box: { x: 0, y: 0, w: 200, h: 60, rotation: 0 }, text: "Hi" } as any);
    expect(useEditor.getState().car!.slides[0].layers).toHaveLength(1);
  });

  it("reorderSlides moves slide", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    useEditor.getState().addSlide();
    useEditor.getState().addSlide();
    const ids = useEditor.getState().car!.slides.map((s) => s.id);
    useEditor.getState().reorderSlides(0, 2);
    expect(useEditor.getState().car!.slides.map((s) => s.id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("removeSlide refuses to drop the last one", () => {
    const c = makeEmptyCarousel("w1");
    useEditor.getState().loadCarousel(c);
    const id = c.slides[0].id;
    useEditor.getState().removeSlide(id);
    expect(useEditor.getState().car!.slides).toHaveLength(1);  // unchanged
  });
});
```

- [ ] **Step 2: 实现**
```ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Carousel, Slide, Layer } from "./types";
import { makeEmptySlide } from "./types";

interface EditorState {
  car: Carousel | null;
  currentSlideId: string | null;
  selectionLayerId: string | null;
  loadCarousel: (c: Carousel) => void;
  setCurrentSlide: (id: string) => void;
  addSlide: () => void;
  removeSlide: (id: string) => void;
  duplicateSlide: (id: string) => void;
  reorderSlides: (from: number, to: number) => void;
  addLayer: (l: Layer) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  setSelectionLayer: (id: string | null) => void;
  updateGlobals: (patch: Partial<Carousel["globals"]>) => void;
  updateSlideBg: (slideId: string, bg: Slide["bg"]) => void;
}

export const useEditor = create<EditorState>()(immer((set) => ({
  car: null, currentSlideId: null, selectionLayerId: null,
  loadCarousel: (c) => set((s) => { s.car = c; s.currentSlideId = c.slides[0]?.id ?? null; }),
  setCurrentSlide: (id) => set((s) => { s.currentSlideId = id; s.selectionLayerId = null; }),
  addSlide: () => set((s) => { if (!s.car) return; const ns = makeEmptySlide(); s.car.slides.push(ns); s.currentSlideId = ns.id; }),
  removeSlide: (id) => set((s) => {
    if (!s.car || s.car.slides.length <= 1) return;
    s.car.slides = s.car.slides.filter((x) => x.id !== id);
    if (s.currentSlideId === id) s.currentSlideId = s.car.slides[0].id;
  }),
  duplicateSlide: (id) => set((s) => {
    if (!s.car) return;
    const orig = s.car.slides.find((x) => x.id === id); if (!orig) return;
    const copy = JSON.parse(JSON.stringify(orig));
    copy.id = `${id}_dup_${Date.now().toString(36)}`;
    const idx = s.car.slides.findIndex((x) => x.id === id);
    s.car.slides.splice(idx + 1, 0, copy);
  }),
  reorderSlides: (from, to) => set((s) => {
    if (!s.car) return;
    const [m] = s.car.slides.splice(from, 1);
    s.car.slides.splice(to, 0, m);
  }),
  addLayer: (l) => set((s) => {
    if (!s.car || !s.currentSlideId) return;
    const slide = s.car.slides.find((x) => x.id === s.currentSlideId); if (!slide) return;
    slide.layers.push(l);
    s.selectionLayerId = l.id;
  }),
  updateLayer: (id, patch) => set((s) => {
    if (!s.car) return;
    for (const sl of s.car.slides) {
      const layer = sl.layers.find((x) => x.id === id);
      if (layer) { Object.assign(layer, patch); break; }
    }
  }),
  removeLayer: (id) => set((s) => {
    if (!s.car) return;
    for (const sl of s.car.slides) sl.layers = sl.layers.filter((x) => x.id !== id);
    if (s.selectionLayerId === id) s.selectionLayerId = null;
  }),
  setSelectionLayer: (id) => set((s) => { s.selectionLayerId = id; }),
  updateGlobals: (patch) => set((s) => { if (s.car) Object.assign(s.car.globals, patch); }),
  updateSlideBg: (slideId, bg) => set((s) => {
    if (!s.car) return;
    const sl = s.car.slides.find((x) => x.id === slideId); if (sl) sl.bg = bg;
  }),
})));
```

- [ ] **Step 3: commit** `feat(editor): add Zustand editor store with slide/layer mutations`

---

## Task 4: Palettes preset

**Files:**
- Create: `web/src/features/editor/palettes.ts`

```ts
import type { PaletteId } from "./types";

export interface Palette {
  id: PaletteId; name: string;
  bg: string; fg: string; accent: string; muted: string; surface: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  mono: { id: "mono", name: "Mono", bg: "#fafaf7", fg: "#0a0b0f", accent: "#2a3a4a", muted: "#7a7a78", surface: "#efece5" },
  pastel: { id: "pastel", name: "Pastel", bg: "#fff5f5", fg: "#3d2c2e", accent: "#e58291", muted: "#b0838a", surface: "#fce7e8" },
  neon: { id: "neon", name: "Neon", bg: "#0a0b0f", fg: "#fafaf7", accent: "#a8c5d6", muted: "#5a6e7f", surface: "#11141a" },
  earth: { id: "earth", name: "Earth", bg: "#efe6d0", fg: "#3d2f1e", accent: "#8b6f3a", muted: "#9c8866", surface: "#e0d4b8" },
  noir: { id: "noir", name: "Noir", bg: "#1a1718", fg: "#f5ecdf", accent: "#d8b576", muted: "#7a6f5e", surface: "#2a2326" },
};

export function resolvePalette(id: PaletteId): Palette { return PALETTES[id] ?? PALETTES.mono; }
```

- [ ] **Step 1**: write
- [ ] **Step 2: commit** `feat(editor): define 5 preset palettes`

---

## Task 5: Background renderer

**Files:**
- Create: `web/src/features/editor/canvas/background/Background.tsx` + `.test.tsx`

- [ ] **Step 1: 测试**
```tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Background } from "./Background";

describe("Background", () => {
  it("solid renders a Rect with the fill color", () => {
    const { container } = render(<Background bg={{ type: "solid", value: "#ff0000" }} width={100} height={100} />);
    expect(container.querySelector("rect")?.getAttribute("fill")).toBe("#ff0000");
  });
});
```

> 注：react-konva 在 jsdom 环境下需要 mock konva。subagent 在测试 setup 中加 `vi.mock('konva')` 或采用 happy-dom + canvas polyfill。备选：把测试范围限制为非 Konva 计算逻辑，渲染部分依靠 Playwright 端到端覆盖。如果测试基础设施跑不通，subagent 可以**仅保留 helper 单测**，把 Background 渲染留给 e2e。

- [ ] **Step 2: 实现**
```tsx
import { Rect, Image } from "react-konva";
import useImage from "use-image";  // konva 生态默认包；若未装则 npm i

export function Background({ bg, width, height }: { bg: { type: "gradient" | "solid" | "image"; value: string }; width: number; height: number }) {
  if (bg.type === "solid") return <Rect x={0} y={0} width={width} height={height} fill={bg.value} />;
  if (bg.type === "gradient") {
    // Simple linear gradient via two-color heuristic; for full CSS-string parsing fall back to <Rect> with fillLinearGradient
    return <Rect x={0} y={0} width={width} height={height} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: width, y: height }} fillLinearGradientColorStops={[0, "#fafaf7", 1, "#e8e6df"]} />;
  }
  // image
  return <BgImage src={bg.value} width={width} height={height} />;
}

function BgImage({ src, width, height }: { src: string; width: number; height: number }) {
  const [img] = useImage(src, "anonymous");
  return <Image image={img} x={0} y={0} width={width} height={height} />;
}
```

- [ ] **Step 3**: install `use-image`：`npm i use-image`
- [ ] **Step 4: commit** `feat(editor): add canvas background renderer (gradient/solid/image)`

---

## Task 6: Layer node renderers

**Files:**
- Create: `web/src/features/editor/canvas/layers/{Text,Image,Shape,Sticker}LayerNode.tsx`

每个组件接 `{ layer, isSelected, onSelect }` props。可拖拽/缩放/旋转用 Konva `<Transformer>`。

- [ ] **Step 1: TextLayerNode.tsx**
```tsx
import { Text, Transformer } from "react-konva";
import { useRef, useEffect } from "react";
import type { TextLayer } from "../../types";
import { useEditor } from "../../store";

export function TextLayerNode({ layer }: { layer: TextLayer }) {
  const isSelected = useEditor((s) => s.selectionLayerId === layer.id);
  const setSelection = useEditor((s) => s.setSelectionLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const ref = useRef<any>(null);
  const trRef = useRef<any>(null);

  useEffect(() => { if (isSelected && ref.current && trRef.current) { trRef.current.nodes([ref.current]); trRef.current.getLayer().batchDraw(); } }, [isSelected]);

  const fontFamilyMap = { serif: "Instrument Serif, serif", sans: "Inter, sans-serif", mono: "JetBrains Mono, monospace" };

  return (
    <>
      <Text
        ref={ref}
        x={layer.box.x} y={layer.box.y}
        width={layer.box.w}
        rotation={layer.box.rotation}
        text={layer.text}
        fontFamily={fontFamilyMap[layer.style.font]}
        fontSize={layer.style.size}
        fontStyle={layer.style.italic ? "italic" : `normal ${layer.style.weight}`}
        fill={layer.style.color}
        align={layer.style.align}
        letterSpacing={layer.style.tracking}
        draggable
        onClick={() => setSelection(layer.id)}
        onTap={() => setSelection(layer.id)}
        onDragEnd={(e) => updateLayer(layer.id, { box: { ...layer.box, x: e.target.x(), y: e.target.y() } })}
        onTransformEnd={(e) => {
          const node = e.target;
          updateLayer(layer.id, {
            box: { x: node.x(), y: node.y(), w: node.width() * node.scaleX(), h: node.height() * node.scaleY(), rotation: node.rotation() },
          });
          node.scaleX(1); node.scaleY(1);
        }}
      />
      {isSelected && <Transformer ref={trRef} />}
    </>
  );
}
```

- [ ] **Step 2: ImageLayerNode.tsx, ShapeLayerNode.tsx, StickerLayerNode.tsx** — 类似模式，用 Konva `<Image>` / `<Rect>`/`<Circle>` / `<Image>`。
- [ ] **Step 3: commit** `feat(editor): add Konva layer node renderers (text/image/shape/sticker)`

---

## Task 7: Stage 包装

**Files:**
- Create: `web/src/features/editor/canvas/Stage.tsx` + `.test.tsx`

```tsx
import { Stage as KStage, Layer as KLayer } from "react-konva";
import { useEditor } from "../store";
import { Background } from "./background/Background";
import { TextLayerNode } from "./layers/TextLayerNode";
import { ImageLayerNode } from "./layers/ImageLayerNode";
import { ShapeLayerNode } from "./layers/ShapeLayerNode";
import { StickerLayerNode } from "./layers/StickerLayerNode";

export function Stage({ scale = 0.5 }: { scale?: number }) {
  const car = useEditor((s) => s.car);
  const currentSlideId = useEditor((s) => s.currentSlideId);
  if (!car || !currentSlideId) return null;
  const slide = car.slides.find((s) => s.id === currentSlideId);
  if (!slide) return null;
  return (
    <KStage width={car.width * scale} height={car.height * scale} scaleX={scale} scaleY={scale}>
      <KLayer>
        <Background bg={slide.bg} width={car.width} height={car.height} />
        {slide.layers.map((l) => {
          if (l.kind === "text") return <TextLayerNode key={l.id} layer={l} />;
          if (l.kind === "image") return <ImageLayerNode key={l.id} layer={l} />;
          if (l.kind === "shape") return <ShapeLayerNode key={l.id} layer={l} />;
          return <StickerLayerNode key={l.id} layer={l} />;
        })}
      </KLayer>
    </KStage>
  );
}
```

- [ ] **Step 1: 实现 + 简单 smoke test**
- [ ] **Step 2: commit** `feat(editor): add Konva stage composing slide background + layers`

---

## Task 8: SlidesNav

**Files:**
- Create: `web/src/features/editor/panels/SlidesNav.tsx`

左 320px 列。每张缩略图 80×100，显示 slide 序号、当前 slide 高亮、+ Add Slide 按钮、上下文菜单（duplicate/delete）。dnd-kit sortable 排序。

- [ ] **Step 1: 实现** — 复用 `@dnd-kit/sortable` `verticalListSortingStrategy`
- [ ] **Step 2: commit** `feat(editor): add slides navigator with sortable thumbs`

---

## Task 9: Inspector — Tabs scaffold

**Files:**
- Create: `web/src/features/editor/panels/Inspector/index.tsx`

3 tabs: Design / Copy / AI。复用 `web/src/ui/Tabs.tsx`。

- [ ] **Step 1**: 实现 Tabs container
- [ ] **Step 2: commit** `feat(editor): add inspector tabs scaffold`

---

## Task 10: Inspector / DesignTab

**Files:**
- Create: `web/src/features/editor/panels/Inspector/DesignTab.tsx`

控件：headline font (serif/sans/mono) / palette (5) / layout (3) / effects sliders (grain / gradient / sharpen)。每个改动写 `useEditor.updateGlobals`。

- [ ] **Step 1**: 实现
- [ ] **Step 2: 测试**：改 palette → globals.palette 更新
- [ ] **Step 3: commit** `feat(editor): add inspector Design tab — font/palette/layout/effects`

---

## Task 11: Inspector / CopyTab

**Files:**
- Create: `web/src/features/editor/panels/Inspector/CopyTab.tsx`

3 个 textarea：headline / body / caption。注意：这些是 Layer 的内容；当前 slide 选中 text layer 时编辑该 layer 的 text 字段；未选中时 disabled。"✨ 让 AI 改写一版" 按钮 → invoke planning module via Plan 4 端点，prompt 含当前文本。

- [ ] **Step 1**: 实现 + 接到 useEditor.updateLayer
- [ ] **Step 2: AI 改写按钮**：调 `apiFetch('/api/works/${workId}/invoke', {method:'POST', body:{module:'planning', input:{intent:'rewrite-copy', current:text}}})`
- [ ] **Step 3: commit** `feat(editor): add inspector Copy tab with AI rewrite hook`

---

## Task 12: Inspector / AITab

**Files:**
- Create: `web/src/features/editor/panels/Inspector/AITab.tsx`

style prompt textarea + 6 quick style buttons + "重新生成全部 N 张"。点击 → invoke `assets` module。

- [ ] **Step 1**: 实现
- [ ] **Step 2: commit** `feat(editor): add inspector AI tab — style prompt + bulk regenerate`

---

## Task 13: Filmstrip

**Files:**
- Create: `web/src/features/editor/panels/Filmstrip.tsx`

底部 124px 横向 tray。所有 slides 缩略图，dnd-kit horizontal sort。"DRAG TO REORDER" microcopy（Plan 1 字体一致 mono uppercase）。

- [ ] **Step 1**: 实现 — 与 SlidesNav 共享部分逻辑（可抽 thumb component）
- [ ] **Step 2: commit** `feat(editor): add bottom filmstrip with horizontal sortable thumbs`

---

## Task 14: Export PNG (单/批量)

**Files:**
- Create: `web/src/features/editor/services/exportPng.ts`
- Create: `web/src/features/editor/hooks/useExport.ts`

```ts
// services/exportPng.ts
import type Konva from "konva";

export async function exportSinglePng(stage: Konva.Stage, fileName: string): Promise<void> {
  const dataUrl = stage.toDataURL({ pixelRatio: 2, mimeType: "image/png" });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}

export async function exportAllPngs(carouselId: string, capture: (slideId: string) => Promise<string>): Promise<void> {
  const slides = useEditor.getState().car?.slides ?? [];
  for (let i = 0; i < slides.length; i++) {
    const url = await capture(slides[i].id);
    const a = document.createElement("a");
    a.href = url; a.download = `${carouselId}-${String(i + 1).padStart(2, "0")}.png`; a.click();
    await new Promise((r) => setTimeout(r, 150));   // browser download throttle
  }
}
```

- [ ] **Step 1: 实现 + hooks**
- [ ] **Step 2: 测试 helper**：mock stage.toDataURL
- [ ] **Step 3: commit** `feat(editor): client-side PNG export — single + batch`

---

## Task 15: TopBar

**Files:**
- Create: `web/src/features/editor/panels/TopBar.tsx`

类似 Studio TopBar：← Works / 标题 / saved 状态 / Export 按钮（dropdown：Current slide / All slides as ZIP / All slides individually）。

- [ ] **Step 1**: 实现
- [ ] **Step 2: commit** `feat(editor): add top bar with export dropdown`

---

## Task 16: AIHint 浮卡

**Files:**
- Create: `web/src/features/editor/panels/AIHint.tsx`

左下浮卡，纯展示用：基于 slides 数量与每张密度（layers count）启发式给提示。

- [ ] **Step 1: 实现**
```tsx
import { useEditor } from "../store";
export function AIHint() {
  const car = useEditor((s) => s.car);
  if (!car) return null;
  const lowDensity = car.slides.findIndex((s) => s.layers.length < 2);
  if (lowDensity < 0) return null;
  return (
    <div style={{ position: "fixed", left: 24, bottom: 24, padding: 12, background: "var(--surface-glass)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, maxWidth: 240 }}>
      第 {lowDensity + 1} 张密度低，建议加一段引导文案或 caption。
    </div>
  );
}
```

- [ ] **Step 2: commit** `feat(editor): add density heuristic hint card`

---

## Task 17: Carousel save/load 服务端

**Files:**
- Create: `web/src/features/editor/services/carousel.ts`
- Modify: `src/server/api.ts` — GET/PUT `/api/works/:id/carousel`
- Create: `src/server/__tests__/carousel.test.ts`

类似 Plan 2 Task 15。yaml 落 `composition.yaml` 旁的 `carousel.yaml`。

- [ ] **Step 1: 服务端 + 测试**
- [ ] **Step 2: 客户端 services**
- [ ] **Step 3: commit** `feat(api+editor): persist Carousel as carousel.yaml per work`

---

## Task 18: Editor.tsx 装配 + e2e

**Files:**
- Modify: `web/src/pages/Editor.tsx`
- Create: `e2e/editor.spec.ts`

- [ ] **Step 1: Editor.tsx 完整组装**

```tsx
import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useEditor } from "@/features/editor/store";
import { makeEmptyCarousel } from "@/features/editor/types";
import { loadCarousel, saveCarousel } from "@/features/editor/services/carousel";
import { Stage } from "@/features/editor/canvas/Stage";
import { SlidesNav } from "@/features/editor/panels/SlidesNav";
import { Inspector } from "@/features/editor/panels/Inspector";
import { Filmstrip } from "@/features/editor/panels/Filmstrip";
import { TopBar } from "@/features/editor/panels/TopBar";
import { AIHint } from "@/features/editor/panels/AIHint";

export default function Editor() {
  const { workId } = useParams();
  const loadCar = useEditor((s) => s.loadCarousel);
  const car = useEditor((s) => s.car);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!workId) return;
    (async () => {
      const found = await loadCarousel(workId);
      loadCar(found ?? makeEmptyCarousel(workId));
    })();
  }, [workId, loadCar]);

  useEffect(() => {
    if (!car || !workId) return;
    const t = setTimeout(() => saveCarousel(workId, car).then(() => setSavedAt(new Date().toLocaleTimeString())), 800);
    return () => clearTimeout(t);
  }, [car, workId]);

  if (!workId) return <div>Missing workId</div>;
  return (
    <div className="editor-shell" style={{ display: "grid",
      gridTemplateColumns: "320px 1fr 340px", gridTemplateRows: "56px 1fr 124px",
      gridTemplateAreas: '"top top top" "left canvas right" "left tray right"',
      height: "calc(100vh - 56px)" }}>
      <div style={{ gridArea: "top" }}><TopBar workId={workId} savedAt={savedAt} /></div>
      <div style={{ gridArea: "left", borderRight: "1px solid var(--border)", overflowY: "auto" }}><SlidesNav /></div>
      <div style={{ gridArea: "canvas", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}><Stage /></div>
      <div style={{ gridArea: "right", borderLeft: "1px solid var(--border)", overflowY: "auto" }}><Inspector /></div>
      <div style={{ gridArea: "tray", borderTop: "1px solid var(--border)" }}><Filmstrip /></div>
      <AIHint />
    </div>
  );
}
```

- [ ] **Step 2: e2e/editor.spec.ts**
```ts
import { test, expect } from "@playwright/test";
test("editor — opens with one slide and shows three panels", async ({ page }) => {
  await page.goto("/editor/test-work-id");
  await expect(page.locator(".editor-shell")).toBeVisible();
  // SlidesNav present
  await expect(page.getByText(/Add slide/i)).toBeVisible();
});
```

- [ ] **Step 3: 全量验证**
```bash
npm run test:web
npm run test:server
npx tsc --noEmit
npm run e2e
./scripts/check-d3-words.sh
git tag plan3-editor-complete
```

- [ ] **Step 4: commit** `feat(editor): wire full editor layout — slides/canvas/inspector/filmstrip`
