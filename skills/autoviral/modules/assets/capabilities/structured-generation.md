---
name: assets-structured-generation
description: Use when handling viewer-dispatched structured generation requests — `[autoviral:create-asset]` / `[autoviral:generate-variant]` envelopes from GenerationDialog or dive-canvas variant buttons. Defines the OpenRouter-based envelope protocol, dispatch flow, composition.yaml registration. NOT for free-form chat generation requests ("帮我生一张图") — those go directly to the assets module without this protocol.
type: capability
priority: rigid
sources:
  - web/src/features/studio/generation/dispatchGeneration.ts (TypeScript truth source)
  - capabilities/dreamina-mastery.md §5 (OpenRouter HTTP backend implementation)
last_updated: 2026-05-08
---

# 结构化生成请求处理（OpenRouter Envelope 协议）

AutoViral 的 viewer（GenerationDialog 与 dive-canvas 变体按钮）不会自己调 provider，而是把用户填好的表单打包成**一个**结构化通知 (`[autoviral:create-asset]` 或 `[autoviral:generate-variant]`) 派给 agent。通知由三部分组成——人类可读摘要行、一段 fenced JSON envelope、以及一段简短的处理指令。

和自由对话里"帮我生一张图"的根本区别在于：envelope 是 viewer 用 UI 收集到的**精确意图**，每个字段都经过用户确认；agent 的工作不是"理解意图"，而是**忠实执行**——逐字段读取、字面调用 OpenRouter API、按 hint 写 provenance。任何"我觉得用户其实想要 X"式的二次诠释都会破坏可复现性，并让 dive-canvas 的变体血缘错乱。

> **协议状态（2026-05-08）**：envelope 已切换到 **OpenRouter HTTP 范式**。Backend `dispatchGeneration.ts` 代码层迁移正在跟进（详见 §6 — Backend Migration Status）。在迁移完成前，envelope 在 wire 上仍可能携带 legacy `script`/`executable_kind` 字段——agent 应**优先识别**新字段（`provider` / `endpoint` / `request_body`），fallback 到 legacy 字段（详见 §5）。

---

## 1. NEW Envelope 协议（OpenRouter HTTP）

唯一真源是 `web/src/features/studio/generation/dispatchGeneration.ts` 的 `JsonPayload` 类型。本文档与代码不一致时**以代码为准**。

### 1.1 顶层字段

| 字段 | 类型 | 何时出现 | 说明 |
|---|---|---|---|
| `mode` | `"create"` \| `"variant"` | 必填 | 决定 `operation_type` 和 `from_asset_id` 取值 |
| `kind` | `"image"` \| `"video"` \| `"audio"` | 必填 | 决定输出文件子目录 (`assets/{kind}/`) |
| `sub_kind` | `"tts"` \| `"bgm"` | 仅 `kind=audio` | 决定调 TTS 还是音乐生成 |
| `prompt` | `string` | 仅 `mode=create` | 完整 prompt，原样传给 OpenRouter |
| `change_direction` | `string` | 仅 `mode=variant` | 用户的修改方向，需要与 `source.prompt` **融合**而非替换 |
| `params` | `object` | 必填 | 物理参数（aspect_ratio / duration / image_size / model …），用于写入 asset.metadata |
| `source` | `object` | 仅 `mode=variant` | 源 asset 的 frozen identity（id / name / uri / 原 prompt / 模型 / 尺寸） |
| **`provider`** | `"openrouter"` | 必填 | NEW：调用通道，当前唯一值 `"openrouter"` |
| **`endpoint`** | `string` | 必填 | NEW：OpenRouter endpoint 路径 — `/api/v1/videos` 或 `/api/v1/chat/completions` |
| **`request_body`** | `object` | 必填 | NEW：HTTP request body，将被原样 POST 给 OpenRouter（仅追加 output 路径相关字段） |
| `provenance_hint` | `object` | 必填 | `operation_type` / `from_asset_id` / `agent_id` / `label` / `model`，逐字段写入 provenance 边 |

### 1.2 image envelope 示例（mode=create）

```json
{
  "mode": "create",
  "kind": "image",
  "prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
  "params": {
    "aspect_ratio": "9:16",
    "image_size": "2K",
    "model": "openai/gpt-5.4-image-2"
  },
  "provider": "openrouter",
  "endpoint": "/api/v1/chat/completions",
  "request_body": {
    "model": "openai/gpt-5.4-image-2",
    "messages": [
      {
        "role": "user",
        "content": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒"
      }
    ],
    "modalities": ["image", "text"],
    "image_config": {
      "aspect_ratio": "9:16",
      "image_size": "2K"
    }
  },
  "provenance_hint": {
    "operation_type": "generate",
    "from_asset_id": null,
    "agent_id": "autoviral-imagegen",
    "label": "openai/gpt-5.4-image-2",
    "model": "openai/gpt-5.4-image-2"
  }
}
```

### 1.3 video envelope 示例（mode=variant，image-to-video）

```json
{
  "mode": "variant",
  "kind": "video",
  "change_direction": "镜头微微推进，少女抬头看天",
  "params": {
    "aspect_ratio": "9:16",
    "duration": 6,
    "model": "bytedance/seedance-2.0"
  },
  "source": {
    "asset_id": "asset-night-store-girl-v2",
    "asset_name": "asset-night-store-girl-v2",
    "uri": "https://cdn.autoviral.app/assets/image/asset-night-store-girl-v2.png",
    "prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
    "model": "openai/gpt-5.4-image-2",
    "aspect_ratio": "9:16"
  },
  "provider": "openrouter",
  "endpoint": "/api/v1/videos",
  "request_body": {
    "model": "bytedance/seedance-2.0",
    "prompt": "<融合后的 timeline prompt — 见 §3 融合规则>",
    "frame_images": [
      {
        "type": "image_url",
        "image_url": {
          "url": "https://cdn.autoviral.app/assets/image/asset-night-store-girl-v2.png"
        },
        "frame_type": "first_frame"
      }
    ],
    "duration": 6,
    "audio": "muted"
  },
  "provenance_hint": {
    "operation_type": "derive",
    "from_asset_id": "asset-night-store-girl-v2",
    "agent_id": "autoviral-videogen",
    "label": "bytedance/seedance-2.0/image-to-video",
    "model": "bytedance/seedance-2.0"
  }
}
```

### 1.4 多 ref envelope（reference-to-video）

```json
{
  "mode": "create",
  "kind": "video",
  "prompt": "<完整 prompt 含 'the first reference image' / 'the second reference video' 等指代>",
  "params": { "aspect_ratio": "16:9", "duration": 8, "model": "bytedance/seedance-2.0" },
  "provider": "openrouter",
  "endpoint": "/api/v1/videos",
  "request_body": {
    "model": "bytedance/seedance-2.0",
    "prompt": "<同上>",
    "input_references": [
      { "type": "image_url", "image_url": { "url": "https://cdn.com/hero.png" } },
      { "type": "image_url", "image_url": { "url": "https://cdn.com/space-vista.png" } },
      { "type": "video_url", "video_url": { "url": "https://cdn.com/dolly-shot.mp4" } }
    ],
    "duration": 8
  },
  "provenance_hint": { ... }
}
```

详见 `reference-directives.md` 的多 ref role 协议。

---

## 2. `create` vs `variant` 的差异

| 维度 | `mode=create` | `mode=variant` |
|---|---|---|
| Prompt 来源 | `prompt` 字段（已是完整 prompt） | `source.prompt` + `change_direction` 融合 |
| `source` 是否存在 | 否 | 是（frozen identity） |
| `provenance_hint.operation_type` | `"generate"` | `"derive"` |
| `provenance_hint.from_asset_id` | `null` | `source.asset_id` |
| 视频 `frame_images.first_frame` | 仅当用户上传了首帧 | viewer 自动注入 `source.uri`（image-to-video） |
| 输出格式约束 | `params` 决定 | 默认继承 `source` 的 aspect/duration，除非 `change_direction` 明示更改 |

---

## 3. 处理流程

```
收到 [autoviral:create-asset] 或 [autoviral:generate-variant] 通知
  ↓
解析 fenced JSON block（忽略人类摘要行 + 指令段）
  ↓
分支：mode 是什么？
  ├── "create"  → fromAssetId = null,            operation.type = "generate"
  └── "variant" → fromAssetId = source.asset_id, operation.type = "derive"
  ↓
分支：variant 时融合 prompt
  ├── 取 source.prompt 作为 base
  ├── 把 change_direction 当作 delta（"在 base 基础上的修改"）
  ├── 保留 base 的 subject / setting / lighting / palette
  ├── 仅在 change_direction 明示更改某字段时才覆盖
  └── 把融合后 prompt 写回 request_body.prompt（覆盖 viewer 提供的草稿）
  ↓
挑 stable semantic asset id（参考 composition.yaml 里相邻 assets 的命名风格，
                              形如 `asset-panda-intro-v2`，**禁止 UUID**）
  ↓
分支：endpoint 决定调用方式
  ├── "/api/v1/chat/completions"（image / 同步）
  │     ↓
  │     POST 提交 → 立即拿 response.choices[0].message.images[0].image_url.url
  │     ↓
  │     curl URL 下载到 assets/{kind}/<semantic-id>.<ext>
  │
  └── "/api/v1/videos"（video / async job）
        ↓
        POST 提交 → 拿 jobId
        ↓
        每 5-10s 轮询 GET /api/v1/videos/{jobId}
        ↓
        status === "succeeded" → GET /api/v1/videos/{jobId}/content?index=0
        ↓
        下载到 assets/{kind}/<semantic-id>.<ext>
        ↓
        若 status === "failed" → 走 filter-retries.md 决策树
  ↓
注册 asset：往 composition.yaml 的 assets[] 追加一项
            （id / type=kind / uri / metadata=envelope.params 中的物理属性 / createdAt / status）
  ↓
追加 provenance edge：照 provenance_hint 字面填，from / type 不许擅自改
  ↓
不要往任何 track 上加 clip — 时间线放置是用户的另一次决定
  ↓
返回 <viewer-locator/> 卡片指向新 asset + 一句简短确认
```

### 3.1 prompt 融合规则（variant 模式）

```
final_prompt = base_anchors_from(source.prompt) ⊕ delta_from(change_direction)

举例：
  source.prompt = "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒"
  change_direction = "镜头微微推进，少女抬头看天"

  保留：深夜便利店门口、关东煮、霓虹灯反光、胶片颗粒
  delta：少女从蹲着吃关东煮 → 抬头看天 + 镜头推进

  final_prompt（视频 timeline 化，符合 video-prompt-narrative.md 协议）：
  "[0s] Medium shot: A young girl crouches by the entrance of a late-night
   convenience store, eating oden. Camera is static. Neon signs reflect on
   the wet pavement. [3s] Slow dolly in toward her. The girl pauses chewing.
   [5s] The girl tilts her head up, eyes drifting to the night sky.
   [6s] Camera holds, neon flicker softens. Cinematic 6s clip, fine 35mm
   grain, lo-fi neon palette, contemplative mood, shot on Sony Venice with
   35mm at f/2. Negative: no distortion, no extra fingers, no subtitles."
```

---

## 4. Worked example — variant 视频（image-to-video）

执行步骤：

1. **解析 envelope**：识别 `provider=openrouter` / `endpoint=/api/v1/videos` / `mode=variant`。
2. **融合 prompt**：source.prompt + change_direction → 完整 timeline prompt（参 §3.1），写回 `request_body.prompt`。
3. **挑 id**：`asset-night-store-girl-v3`（沿用相邻命名）。
4. **POST OpenRouter**：

   ```bash
   curl -X POST "https://openrouter.ai/api/v1/videos" \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d "$(echo $envelope | jq '.request_body')"
   ```

   返回 `{ "id": "vid_abc123", "status": "pending" }`。

5. **轮询**（5s → 10s → 20s 退避）：

   ```bash
   while true; do
     STATUS=$(curl -s https://openrouter.ai/api/v1/videos/vid_abc123 \
       -H "Authorization: Bearer $OPENROUTER_API_KEY" | jq -r '.status')
     [ "$STATUS" = "succeeded" ] && break
     [ "$STATUS" = "failed" ] && exit 1  # 走 filter-retries.md
     sleep 10
   done
   ```

6. **下载**：

   ```bash
   curl https://openrouter.ai/api/v1/videos/vid_abc123/content?index=0 \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     --output assets/video/asset-night-store-girl-v3.mp4
   ```

7. **注册 asset**（追加到 `composition.yaml` 的 `assets:`）：

   ```yaml
   - id: asset-night-store-girl-v3
     type: video
     uri: assets/video/asset-night-store-girl-v3.mp4
     metadata:
       prompt: "<融合后的完整 timeline prompt>"
       aspect_ratio: "9:16"
       duration: 6
       model: "bytedance/seedance-2.0"
     createdAt: "2026-05-08T14:30:00Z"
     status: ready
   ```

8. **追加 provenance edge**：

   ```yaml
   - to: asset-night-store-girl-v3
     operation:
       type: derive
       agent_id: autoviral-videogen
       label: bytedance/seedance-2.0/image-to-video
       model: bytedance/seedance-2.0
       timestamp: "2026-05-08T14:30:00Z"
     from: asset-night-store-girl-v2
   ```

9. **返回卡片**：

   ```
   已生成新视频 asset-night-store-girl-v3。
   <viewer-locator label="✦ asset-night-store-girl-v3" data='{"assetId":"asset-night-store-girl-v3"}' />
   ```

---

## 5. LEGACY envelope 兼容（迁移期间）

在 `dispatchGeneration.ts` 完成 migration 之前，envelope 可能仍携带 legacy 字段：

```json
{
  "script": "modules/assets/scripts/openrouter_generate.py",
  "executable_kind": "python",
  "script_args": { "--prompt": "...", "--aspect-ratio": "9:16" }
}
```

或视频：

```json
{
  "script": "dreamina image2video",
  "executable_kind": "shell",
  "script_args": { "--prompt": "...", "--image-url": "..." }
}
```

### 5.1 检测顺序

```typescript
if (envelope.provider === "openrouter") {
  // NEW 协议：用 endpoint + request_body
  await callOpenRouter(envelope.endpoint, envelope.request_body);
} else if (envelope.script && envelope.executable_kind) {
  // LEGACY：用 script + script_args 走 shell/python
  await callLegacyShell(envelope.script, envelope.executable_kind, envelope.script_args);
} else {
  throw new Error("Envelope missing both new (provider) and legacy (script) fields");
}
```

### 5.2 Legacy → OpenRouter 翻译表

如果遇到 legacy envelope，按表翻译为等价 OpenRouter 调用：

| Legacy script | Legacy executable_kind | OpenRouter endpoint | request_body 构造 |
|---|---|---|---|
| `modules/assets/scripts/openrouter_generate.py` | `python` | `/api/v1/chat/completions` | `{ model: "openai/gpt-5.4-image-2", messages: [{role:"user", content: script_args["--prompt"]}], modalities: ["image","text"], image_config: { aspect_ratio: script_args["--aspect-ratio"], image_size: script_args["--image-size"] || "2K" } }` |
| `dreamina text2video` | `shell` | `/api/v1/videos` | `{ model: "bytedance/seedance-2.0", prompt: script_args["--prompt"], aspect_ratio: script_args["--aspect-ratio"], duration: script_args["--duration"] }` |
| `dreamina image2video` | `shell` | `/api/v1/videos` | `{ model: "bytedance/seedance-2.0", prompt: ..., frame_images: [{type:"image_url", image_url:{url: script_args["--image-url"]}, frame_type:"first_frame"}], duration: ... }` |
| `dreamina frames2video` | `shell` | `/api/v1/videos` | `{ ..., frame_images: [first_frame, last_frame] }` |
| `dreamina multimodal2video` | `shell` | `/api/v1/videos` | `{ ..., input_references: [...] }` |

Agent 在执行时**优先用 NEW 协议字段**——遇到 legacy 时即时翻译，不要回退到 shell 调用（避免依赖本地 dreamina CLI 安装）。

---

## 6. Backend Migration Status

| 组件 | 状态 | 跟进 |
|---|---|---|
| `dispatchGeneration.ts` 类型定义 | ⚠️ 仍含 `script` / `executable_kind` / `script_args` 字段 | 待补 `provider` / `endpoint` / `request_body` 三字段；保留 legacy 字段做兼容 |
| `dispatchGeneration.ts` 实际派发逻辑 | ⚠️ 仍走 shell/python spawn | 待加 `if (provider === "openrouter")` 分支走 fetch |
| GenerationDialog UI | ✅ 已能产生新 envelope（含 provider/endpoint/request_body）| — |
| variant 自动注入 | ⚠️ 仍把 `source.uri` 写进 `script_args["--image-url"]` | 待改为写进 `request_body.frame_images[0]` |

> **TODO**：`dispatchGeneration.ts` 的 backend migration 是单独代码任务，参 issue #TBD。在它完成前，agent 必须能处理两种 envelope 形态——优先 NEW，fallback LEGACY（参 §5）。

---

## 7. 不要做的事

- ❌ 不要重写 `prompt` / `change_direction` — 字面传给 OpenRouter，融合也只是按 §3.1 拼接，不允许"觉得用户其实想要的更好的 prompt"。
- ❌ 不要混合 mode — `create` 不能产生 `derive` 边；`variant` 必须有 `from_asset_id`。
- ❌ 不要省略 `provenance_hint` 字段 — 即使值为 null 也要显式写出，hydration 期望完整字段。
- ❌ 不要把 envelope JSON 复读给用户 — 他们刚填完表单，知道自己填了什么；只回简短确认 + locator 卡片。
- ❌ 不要自动 `add clip` 到任何 track — timeline 放置是用户的另一次决定。
- ❌ 不要修改 `request_body` 字段（除融合后的 prompt 写回）— viewer 的 intent 必须忠实下传。
- ❌ 不要修改源 asset（variant 模式下）— 源 asset 是 dive-canvas 变体血缘的根节点，改动后 switcher 会错位。
- ❌ 不要发明新的 `operation.type`（如 `"edit"`、`"refine"`）— 当前协议只识别 `generate` 和 `derive`。
- ❌ 不要在新代码引用 legacy `script` / `executable_kind` 字段 — 它们仅为兼容期保留，新写代码统一走 `provider/endpoint/request_body`。

---

## 8. Gotchas

- **`createdAt` 必须稳定**：同一 asset 多次 hydrate 共享 `createdAt`，**不要每次重写 composition.yaml 时刷新它**。`operation.timestamp == asset.createdAt` 是 hydration 依赖。
- **`uri` 在 `status: generating` 阶段可以为空字符串**：OpenRouter job 完成后再回填。viewer 收到空 uri 会显示占位图。
- **`kind` 字段决定文件子目录**：`image → assets/image/`、`video → assets/video/`、`audio → assets/audio/`。**不要**把视频写进 `image/` 哪怕路径正确——viewer 列表按子目录过滤。
- **视频变体的 `frame_images.first_frame` 已自动注入**：dispatchGeneration.ts 在 `mode=variant` 且 `source.uri` 存在且 source 是 image 时会自动构造 `request_body.frame_images[0]`。**不要**手工再加一次。
- **`source` 是 frozen identity**：`source.prompt` / `source.model` / `source.aspect_ratio` 等是源 asset 的不可变快照，用户的修改方向只在 `change_direction` 里。把 `change_direction` 当作"在 source 基础上的 delta"，融合时**保留** subject / setting / lighting / palette，除非 delta 明示更改。
- **图像变体的小幅改动优先 ref-image 模式**：当 `change_direction` 是文字替换、颗粒/调色微调时，给 `request_body.messages.content` 用多模态数组（text + image_url），让 OpenRouter 走 reference-driven 路径，比纯 prompt 重生成稳定得多。
- **audio sub_kind 决定 endpoint 和模型**：
  - `sub_kind=tts` → 调 OpenAI TTS endpoint（不在 OpenRouter videos/images 范围内，**待补 §9 TTS 协议**）
  - `sub_kind=bgm` → `/api/v1/chat/completions` + `google/lyria-3-pro` model
- **不要从 envelope 推断 platform 美学**：envelope 只携带技术约束（aspect / duration / resolution）。平台风格的 taste 决定不在 envelope 范围内——已经由 viewer 上游模块处理过；agent 只负责忠实执行。

---

## 9. Locator 卡片格式（必读）

Agent 发出的 locator card 必须严格遵循以下属性顺序，否则 parser 会静默丢弃：

`<viewer-locator label="<人类可读的标签>" data='{"assetId":"...","clipId":"...","time":<秒数>}' />`

- `label` 必须在 `data` 之前
- 两个属性都必须用 quote 包裹（双引号或单引号都可，混用 OK）
- `data` 内是 JSON 对象，至少包含 `assetId` 字段；`clipId` 和 `time` 视上下文可选

错误的写法（**会被静默丢弃**）：

```
<viewer-locator asset="asset-x" />              ← 缺 label / data，parser 跳过
<viewer-locator data='{"assetId":"x"}' label="x" />  ← label 在 data 之后，parser 跳过
```

正确的写法：

```
<viewer-locator label="✦ asset-night-store-girl-v3" data='{"assetId":"asset-night-store-girl-v3"}' />
<viewer-locator label="片段 03 · 0:12" data='{"clipId":"clip-03","time":12}' />
```

真源：`web/src/features/chat/types.ts` 的 `LOCATOR_RX`。

---

## See also

| 路径 | 作用 |
|---|---|
| `capabilities/dreamina-mastery.md` §1, §5 | OpenRouter video API 完整调用 + Backend 实现代码 |
| `capabilities/image-prompt-narrative.md` §9, §11 | OpenRouter image API 完整调用 + Backend 实现代码 |
| `capabilities/reference-directives.md` | variant 模式下 reference 角色分配（OpenRouter `input_references` 协议） |
| `capabilities/filter-retries.md` | OpenRouter response.error 决策树（job 失败时走它）|
| `capabilities/fallback-strategy.md` | 受阻时的降级路径（与 envelope 协议正交）|
| `capabilities/quality-gate.md` | 生成完成后的自检清单 |
| `web/src/features/studio/generation/dispatchGeneration.ts` | envelope 协议的真源（TS 类型定义；migration in progress）|
