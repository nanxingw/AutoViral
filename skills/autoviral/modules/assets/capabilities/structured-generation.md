---
name: assets-structured-generation
description: 用于处理 viewer 派发的结构化生成请求时——例如 "[autoviral:create-asset] 创建图片"、"[autoviral:generate-variant] 重生成视频"、"在 dive-canvas 上点击变体按钮后收到的 JSON envelope"。给出 envelope 解析规则、脚本调度顺序、composition.yaml 注册流程。不用于：自由对话中的生成请求（"帮我生一张图"），那种情况直接调用 `assets/` 模块脚本即可，无需走该协议。
---

# 结构化生成请求处理

AutoViral 的 viewer（GenerationDialog 与 dive-canvas 变体按钮）不会自己调 provider，而是把用户填好的表单打包成**一个**结构化通知 (`[autoviral:create-asset]` 或 `[autoviral:generate-variant]`) 派给 agent。通知由三部分组成——人类可读摘要行、一段 fenced JSON envelope、以及一段简短的处理指令。

和自由对话里"帮我生一张图"的根本区别在于：envelope 是 viewer 用 UI 收集到的**精确意图**，每个字段都经过用户确认；agent 的工作不是"理解意图"，而是**忠实执行**——逐字段读取、字面调用脚本、按 hint 写 provenance。任何"我觉得用户其实想要 X"式的二次诠释都会破坏可复现性，并让 dive-canvas 的变体血缘错乱。

## Envelope 协议

唯一的真源是 `web/src/features/studio/generation/dispatchGeneration.ts` 的 `JsonPayload` 类型。本文档与代码不一致时**以代码为准**。

### 顶层字段

| 字段 | 类型 | 何时出现 | 说明 |
|------|------|----------|------|
| `mode` | `"create"` \| `"variant"` | 必填 | 决定 `operation_type` 和 `from_asset_id` 取值 |
| `kind` | `"image"` \| `"video"` \| `"audio"` | 必填 | 决定输出文件子目录 (`assets/{kind}/`) |
| `sub_kind` | `"tts"` \| `"bgm"` | 仅 `kind=audio` | 决定调 `tts_generate.py` 还是 `music_generate.py` |
| `prompt` | `string` | 仅 `mode=create` | 完整 prompt，原样传给 script |
| `change_direction` | `string` | 仅 `mode=variant` | 用户的修改方向，需要与 `source.prompt` **融合**而非替换 |
| `params` | `object` | 必填 | 物理参数（aspect_ratio / duration / style …），用于写入 asset.metadata |
| `source` | `object` | 仅 `mode=variant` | 源 asset 的 frozen identity（id / name / uri / 原 prompt / 模型 / 尺寸） |
| `script` | `string` | 必填 | 目标脚本相对路径，**不要重写** |
| `script_args` | `object` | 必填 | flag→value 映射，**不要重命名 flag**，照搬即可 |
| `provenance_hint` | `object` | 必填 | `operation_type` / `from_asset_id` / `agent_id` / `label` / `model`，逐字段写入 provenance 边 |

### `create` vs `variant` 的差异

| 维度 | `mode=create` | `mode=variant` |
|------|---------------|----------------|
| Prompt 来源 | `prompt` 字段（已是完整 prompt） | `source.prompt` + `change_direction` 融合 |
| `source` 是否存在 | 否 | 是（frozen identity） |
| `provenance_hint.operation_type` | `"generate"` | `"derive"` |
| `provenance_hint.from_asset_id` | `null` | `source.asset_id` |
| 视频 `--image-url` | 仅当用户上传了首帧 | viewer 自动注入 `source.uri`（image-to-video） |
| 输出格式约束 | `params` 决定 | 默认继承 `source` 的 aspect/duration，除非 `change_direction` 明示更改 |

### 完整 envelope 示例（mode=create, kind=image）

```json
{
  "mode": "create",
  "kind": "image",
  "prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
  "params": {
    "prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
    "aspect_ratio": "9:16",
    "width": null,
    "height": null,
    "style": null
  },
  "script": "modules/assets/scripts/openrouter_generate.py",
  "script_args": {
    "--prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
    "--aspect-ratio": "9:16"
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

## 处理流程（分支，不是顺序）

```
收到 [autoviral:create-asset] 或 [autoviral:generate-variant] 通知
  ↓
解析 fenced JSON block（忽略人类摘要行 + 指令段）
  ↓
分支：mode 是什么？
  ├── "create"  → fromAssetId = null,            operation.type = "generate"
  └── "variant" → fromAssetId = source.asset_id, operation.type = "derive"
  ↓
挑 stable semantic asset id（参考 composition.yaml 里相邻 assets 的命名风格，
                              形如 `asset-panda-intro-v2`，**禁止 UUID**）
  ↓
挑输出路径：assets/{kind}/<semantic-id>.<ext>
            image→.png · video→.mp4 · audio→.mp3
  ↓
调脚本：原样使用 envelope.script + envelope.script_args，
       仅追加 `--output <挑好的路径>`
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

## Worked example 1 — create-asset（图片）

收到的通知正文（截选）：

```
[autoviral:create-asset] Create a new asset — image — "深夜便利店门口，少女蹲在地上吃关东煮…"

```json
{ ...上文 envelope 示例... }
```

Handling (create):
1. Parse the JSON block above. ...
```

Agent 执行步骤：

1. **解析**：`mode=create`、`kind=image`、`prompt="深夜便利店门口…"`、`script_args={"--prompt": ..., "--aspect-ratio": "9:16"}`。
2. **选 id**：相邻已有 `asset-night-store-girl-v1`，本次用 `asset-night-store-girl-v2`。
3. **选路径**：`assets/image/asset-night-store-girl-v2.png`。
4. **调脚本**（字面套用，仅补 `--output`）：

   ```bash
   python3 modules/assets/scripts/openrouter_generate.py \
     --prompt "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒" \
     --aspect-ratio "9:16" \
     --output "assets/image/asset-night-store-girl-v2.png"
   ```

5. **注册 asset**（追加到 `composition.yaml` 的 `assets:`）：

   ```yaml
   - id: asset-night-store-girl-v2
     type: image
     uri: assets/image/asset-night-store-girl-v2.png
     metadata:
       prompt: "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒"
       aspect_ratio: "9:16"
     createdAt: "2026-04-28T14:30:00Z"
     status: ready
   ```

6. **追加 provenance edge**（`provenance:` 数组下，逐字段照搬 `provenance_hint`）：

   ```yaml
   - to: asset-night-store-girl-v2
     operation:
       type: generate
       agent_id: autoviral-imagegen
       label: openai/gpt-5.4-image-2
       model: openai/gpt-5.4-image-2
       timestamp: "2026-04-28T14:30:00Z"
     from: null
   ```

7. **返回卡片**：

   ```
   已生成新图片 asset-night-store-girl-v2。
   <viewer-locator asset="asset-night-store-girl-v2" />
   ```

## Worked example 2 — generate-variant（视频）

关键差异：`fromAssetId` 必须等于 `source.asset_id`；`operation.type` 必须是 `"derive"`；`script_args["--image-url"]` 由 dispatchGeneration.ts 自动注入 `source.uri`，**不要二次手工填**；最终 prompt 是 `source.prompt` + `change_direction` 的融合，不是改写。

envelope 节选：

```json
{
  "mode": "variant",
  "kind": "video",
  "change_direction": "镜头微微推进，少女抬头看天",
  "params": {
    "prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
    "duration": "6",
    "aspect_ratio": "9:16",
    "resolution": "720p",
    "image_url": "assets/image/asset-night-store-girl-v2.png"
  },
  "source": {
    "asset_id": "asset-night-store-girl-v2",
    "asset_name": "asset-night-store-girl-v2",
    "uri": "assets/image/asset-night-store-girl-v2.png",
    "prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
    "model": "openai/gpt-5.4-image-2",
    "width": null, "height": null,
    "aspect_ratio": "9:16",
    "duration": null, "voice": null
  },
  "script": "modules/assets/scripts/dreamina_generate.py from-image",
  "script_args": {
    "--prompt": "深夜便利店门口，少女蹲在地上吃关东煮，霓虹灯反光，胶片颗粒",
    "--duration": "6",
    "--aspect-ratio": "9:16",
    "--resolution": "720p",
    "--image-url": "assets/image/asset-night-store-girl-v2.png"
  },
  "provenance_hint": {
    "operation_type": "derive",
    "from_asset_id": "asset-night-store-girl-v2",
    "agent_id": "autoviral-videogen",
    "label": "dreamina/seedance-pro/image-to-video",
    "model": "dreamina/seedance-pro/image-to-video"
  }
}
```

执行：

1. 融合 prompt：以 `source.prompt` 为基底，补一句"镜头微微推进，少女抬头看天"，**保留**便利店、关东煮、霓虹、胶片颗粒等所有 anchor。把融合后的 prompt 替换进 `--prompt` 即可（其余 flag 原样）。
2. 选 id：`asset-night-store-girl-v2-clip` 或 `asset-night-store-girl-v3`，沿用相邻命名。
3. 路径：`assets/video/asset-night-store-girl-v3.mp4`。
4. 调脚本：照 `script` + `script_args` 字面执行，仅追加 `--output`，并默认追加 `--no-audio`（视频变体走 image-to-video 时不要带原模型自带的 ambient 音）。
5. 注册 asset：`type: video`、`metadata` 抄 `params` 里的 duration/aspect/resolution。
6. provenance edge：`operation.type=derive`、`from=asset-night-store-girl-v2`，其余字段照 hint 字面。
7. **不要修改源 asset**——variant switcher 依赖原 asset 仍然存在且 uri 不变。
8. 返回 `<viewer-locator asset="asset-night-store-girl-v3" />`。

## 不要做的事

- ❌ 不要重写 `prompt` / `change_direction` — 字面传给 script，融合也只是拼接，不允许"觉得用户其实想要的更好的 prompt"。
- ❌ 不要混合 mode — `create` 不能产生 `derive` 边；`variant` 必须有 `from_asset_id`。
- ❌ 不要省略 `provenance_hint` 字段 — 即使值为 null 也要显式写出，hydration 期望完整字段。
- ❌ 不要把 envelope JSON 复读给用户 — 他们刚填完表单，知道自己填了什么；只回简短确认 + locator 卡片。
- ❌ 不要自动 `add clip` 到任何 track — timeline 放置是用户的另一次决定。
- ❌ 不要重命名 `script_args` 的 flag（例如把 `--aspect-ratio` 改成 `--ratio`）— viewer 的 intent 必须忠实下传。
- ❌ 不要修改源 asset（variant 模式下）— 源 asset 是 dive-canvas 变体血缘的根节点，改动后 switcher 会错位。
- ❌ 不要发明新的 `operation.type`（如 `"edit"`、`"refine"`）— 当前协议只识别 `generate` 和 `derive`。

## Gotchas

- **`createdAt` 必须稳定**：同一 asset 多次 hydrate 共享 `createdAt`，**不要每次重写 composition.yaml 时刷新它**。`operation.timestamp == asset.createdAt` 是 hydration 依赖。
- **`uri` 在 `status: generating` 阶段可以为空字符串**：脚本完成后再回填。viewer 收到空 uri 会显示占位图。
- **`kind` 字段决定文件子目录**：`image → assets/image/`、`video → assets/video/`、`audio → assets/audio/`。**不要**把视频写进 `image/` 哪怕路径正确——viewer 列表按子目录过滤。
- **`prompt` 是 flag 不是 positional**：AutoViral 的 `openrouter_generate.py` 用 `--prompt`，不像 pneuma 的脚本可能是 positional。envelope 的 `script_args` 已替你决定了，**不要二次猜测**。
- **视频变体的 `--image-url` 已自动注入**：dispatchGeneration.ts 在 `mode=variant` 且 `source.uri` 存在时会自动把 `source.uri` 写进 `script_args["--image-url"]`，并把 `script` 切到 `dreamina_generate.py from-image`。**不要**手工再加一次，也不要切回 text-to-video。
- **`source` 是 frozen identity**：`source.prompt` / `source.model` / `source.width` 等是源 asset 的不可变快照，用户的修改方向只在 `change_direction` 里。把 `change_direction` 当作"在 source 基础上的 delta"，融合时**保留** subject / setting / lighting / palette，除非 delta 明示更改。
- **图像变体的小幅改动优先 edit 模式**：当 `change_direction` 是文字替换、颗粒/调色微调时，给 image script 追加 `--ref-image <source.uri>` 走 edit 路径，比纯 prompt 重生成稳定得多。
- **audio 的 sub_kind 决定脚本和 flag 名**：`sub_kind=tts` → `tts_generate.py`，flag 是 `--text`；`sub_kind=bgm` → `music_generate.py`，flag 是 `--prompt`。两个 sub_kind 的 flag 不互通。
- **不要从 envelope 推断 platform 美学**：envelope 只携带技术约束（aspect / duration / resolution）。平台风格（小红书 / 抖音 / 视频号）的 taste 决定不在 envelope 范围内——已经由 viewer 上游模块处理过；agent 只负责忠实执行。

## See also

| 路径 | 作用 |
|------|------|
| `capabilities/filter-retries.md` | 脚本报错时的恢复路径 (Phase 2.8 — 待新增) |
| `capabilities/reference-directives.md` | variant 模式下 reference 角色分配 (Phase 2.7 — 待新增) |
| `capabilities/dreamina-mastery.md` | dreamina/seedance-pro 命令选择与参数排错 |
| `capabilities/fallback-strategy.md` | 受阻时的降级路径（与 envelope 协议正交） |
| `capabilities/quality-gate.md` | 生成完成后的自检清单 |
| `scripts/openrouter_generate.py` | image 路径的脚本 |
| `scripts/dreamina_generate.py` | video 路径的脚本 (Phase 2.4 引用 — 当前仓库内为 `jimeng_generate.py`，正在过渡) |
| `scripts/music_generate.py` | BGM 路径的脚本 |
| `scripts/tts_generate.py` | TTS 路径的脚本 (Phase 3.E 待新增) |
| `web/src/features/studio/generation/dispatchGeneration.ts` | envelope 协议的真源（TS 类型定义） |
