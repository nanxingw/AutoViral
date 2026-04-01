# AutoViral 问题收集与优化方向

> 持续更新，收集产品 bug、交互优化建议、以及从个案中提炼的系统性设计问题。

---

## 零、系统第一原则：质量优先

**AutoViral 的一切设计决策都服从于一个目标：产出最高质量的内容。**

这条原则贯穿整个系统——从 Skill 文档、Agent prompt、降级策略到前端交互：

- **宁可不交付，不可降质交付**：如果某个环节的所有路径都会导致不可接受的质量损失，Agent 应该停下来告知用户，而不是静默降质出一个"勉强能用"的结果
- **降级必须最小让步**：受阻时优先选择对最终内容质量影响最小的替代方案，逐级尝试，每一级都是迫不得已才往下走
- **降质决策必须透明**：任何涉及质量降级的决策（换模型、换方式、跳过步骤）都必须告知用户并获得确认
- **质量检测前置，不要事后补救**：在批量生成前做样本测试，在执行前检测环境能力，把问题拦在源头

**注入方式**：写入 `ws-bridge.ts` 的 `buildSystemPrompt()`，在每个 Agent session 启动时作为 system prompt 的一部分注入。这是最可靠的注入点——Skill 文件 Agent 可能不读，但 system prompt 一定会看到。各 Skill 文件中也应呼应这条原则，但不依赖 Agent 主动加载 Skill 来获知。

---

## 一、系统性设计问题（从个案中提炼）

以下问题从「月球战争」等具体 case 中暴露，但本质上是通用架构问题，影响所有内容类型。

### ARCH-1: Pipeline 缺乏内容类型适配层——"一套模板治百病"

**暴露场景**：科幻短片被迫使用焦虑类图文的 prompt 模板。

**核心问题**：当前 pipeline 的每个阶段（调研、策划、素材、合成）的 prompt 模板是按**情绪品类**硬编码的（焦虑→观点输出型/对话截图型，羡慕→反差跃迁型...），假设所有内容都是"情绪驱动的小红书图文"。

这导致以下内容类型完全无法适配：
- 叙事类（科幻短片、微电影、剧情类）
- 知识类（教程、测评、科普）
- 展示类（Vlog、旅行、美食制作过程）
- 节奏类（卡点视频、舞蹈、音乐可视化）

**设计方向**：
- 情绪品类只是内容策略的**一个维度**，不应该是决定整个 pipeline 行为的唯一变量
- 需要一个"内容类型 × 平台 × 情绪"的多维适配层，pipeline 每个阶段根据这个组合选择合适的 prompt 策略
- Skill 文档需要为不同内容类型提供差异化的方法论，而不是只有一套情绪驱动的模板

---

### ARCH-2: Agent 缺乏"受阻时自主降级"的通用策略

**暴露场景**：`image2video` 因军事内容审核被拒，Agent 退化到 `text2video` 但没有系统性的降级策略。

**核心问题**：AI 生成服务的拒绝/失败是常态，不是异常。内容安全审核、API 限流、服务不可用、参数不支持等情况随时可能发生。当前 Skill 没有指导 Agent 如何系统性地处理这些情况。

**需要在 Skill 层面覆盖的通用降级场景**：

| 受阻类型 | 典型触发 | Agent 应有的行为 |
|---------|---------|----------------|
| **内容安全审核** | 军事/暴力/性感等题材 | 1. 改写 prompt 去除敏感词 → 2. 换命令（image2video→text2video）→ 3. 换模型（seedance2.0→3.0）→ 4. 告知用户 |
| **API 限流/排队** | Dreamina 排队几万位 | 1. 并行提交多任务 → 2. 切换到 fast 模型 → 3. 设合理 poll 超时 → 4. 告知用户预计时间 |
| **服务不可用** | CLI 未登录/API Key 过期 | 1. 检测到后立即告知用户 → 2. 给出修复指令 → 3. 切换到备用服务 |
| **参数不支持** | 某模型不支持某 ratio/duration | 1. 查 -h 确认支持的参数 → 2. 自动调整到最近的合法值 → 3. 告知用户调整了什么 |
| **环境依赖缺失** | ffmpeg 没有 drawtext | 1. 检测能力 → 2. 用替代方案（Pillow 叠字幕）→ 3. 不要假设环境完整 |
| **生成质量不达标** | 画面畸形/文字乱码/风格偏移 | 1. 自检 → 2. 调整 prompt 重试 → 3. 最多重试 N 次 → 4. 展示给用户决定 |

**核心原则：质量优先，绝不为完成而降质**

受阻时的目标不是"无论如何出一个结果"，而是"在保住质量的前提下找到可行路径"。如果所有路径都会导致不可接受的质量损失，应该停下来告知用户，而不是静默降质交付。

**降级策略的正确排序**：每一级降级都应是**最小让步**，优先保住对最终内容质量影响最大的环节。

以月球战争 case 为例（image2video 因军事内容被拒）：

```
image2video 被拒（PROHIBITED_CONTENT）
  → Level 1: 改写 prompt 去除敏感词，保留 image2video（保住首帧控制力）
  → Level 2: 换模型版本（seedance2.0 → 3.0，审核可能更宽松）
  → Level 3: 告知用户情况，请用户决定：
       a) 接受 text2video（会丢失首帧画面一致性）
       b) 调整首帧内容（去除明显军事元素）后重试 image2video
       c) 用户手动上传素材
  ✗ 错误做法: 静默退化到 text2video，丢失首帧控制力却不告知用户
```

Agent 在月球战争 case 中直接跳到了 text2video，跳过了"改写 prompt 重试"这一步，导致 8 张高质量首帧全部浪费。

**前置检测（避免批量踩坑）**：对于可预见的风险（敏感题材），在批量提交前先做 1 个样本测试。被拒只浪费 1 次调用而不是 8 次。

**设计方向**：
- 在 Skill 中增加一个通用的 `modules/fallback-strategy.md`，定义每种受阻类型的标准降级路径
- 每条降级路径的排序原则：**质量损失最小的方案优先**
- 涉及质量降级的决策（如从 image2video 退化到 text2video）**必须告知用户并获得确认**，不可静默执行
- Agent 在每次调用生成服务前都应有 fallback 预案，而不是失败了再临时想办法
- 降级决策要透明——告知用户发生了什么、做了什么调整、对结果的影响

---

### ARCH-3: Prompt 与用户意图的传递链断裂

**暴露场景**：用户填了"科幻短篇，月球大战"，但 research prompt 去搜穿搭热搜。

**核心问题**：用户意图从 UI → 后端 → Agent prompt 的传递链中存在多处断裂：

```
用户意图                    实际传递
─────────                  ────────
topicHint="月球大战"   →   prompt 头部一行元数据（被指令正文覆盖）
contentCategory="envy" →   决定整个 prompt 模板（观点输出型...）
config.interests=穿搭  →   "选题**必须**与这些领域相关"（强制约束）
```

**优先级应该是**：`用户在本作品指定的方向 > 作品级参数 > 全局偏好`

但实际是：`全局偏好（强制）> 固定模板（硬编码）> 用户方向（被忽略）`

**设计方向**：
- 所有 prompt 构建遵循**意图优先级原则**：`topicHint > contentCategory > config.interests`
- `topicHint` 不应该是一行元数据，而应该是 prompt 指令的核心约束
- `config.interests` 应该是软性参考（"可以参考"），不是硬性约束（"必须相关"）
- 当 `topicHint` 存在时，整个调研策略应切换为"深度模式"（围绕该主题搜索），而非"广撒网模式"（搜通用热搜）

---

### ARCH-4: 素材生成阶段缺乏"先检测再执行"的环境感知

**暴露场景**：ffmpeg 没有 drawtext 导致字幕方案失败；image2video 因审核被拒后才知道不能用。

**核心问题**：Agent 在执行前不做环境检测，总是先尝试 → 失败 → 再想办法。这浪费时间和积分。

**设计方向**：
- assets 阶段开始时，Agent 应先执行一次环境检测：
  1. `dreamina user_credit` — 检查积分是否够用
  2. `ffmpeg -filters | grep drawtext` — 检查字幕能力
  3. `check_providers.py` — 检查可用服务
  4. 对于敏感题材，先用小规模测试（如 1 张图的 image2video）验证能否通过审核，再批量提交
- 将检测结果纳入后续决策：如果 drawtext 不可用，直接用 Pillow 方案，不要先尝试再失败

---

## 二、Bug

### BUG-1: 话题调研忽略用户创作方向（topicHint）

**严重程度**：高
**复现**：创建作品时填写创作方向"科幻短篇，月球大战"，调研结果返回穿搭、情侣等完全无关的话题。
**关联**：ARCH-3（意图传递链断裂）

**根因**：`src/server/api.ts:950-1037`

1. Research prompt 硬编码搜索通用热搜（"今日热搜""微博热搜""抖音热点"），完全忽略 `work.topicHint`
2. `topicHint` 虽然在 prompt 头部作为一行元数据传入（`Topic hint: ...`），但指令正文没有引用它
3. `config.interests`（全局兴趣标签）被注入为**强制约束**（"选题**必须**与这些领域相关"），优先级高于作品级别的 `topicHint`，导致全局兴趣覆盖用户指定的创作方向

**修复方向**：
- 当 `topicHint` 存在时，research prompt 应围绕该主题搜索和调研
- `topicHint` 优先级应高于 `config.interests`
- 热搜仅用于辅助选标签（蹭流量），不应影响内容主题

**相关文件**：
- `src/server/api.ts` — lines 950-1037（research prompt 构建）
- `src/server/api.ts` — lines 974-983（interestClause 注入）

---

### BUG-2: 情绪品类只有 4 个固定选项，不支持自定义

**严重程度**：中
**复现**：创建"科幻月球大战"类型的内容时，4 个情绪选项（焦虑/分歧/搞笑/羡慕）都不适用，但必须选一个。
**关联**：ARCH-1（一套模板治百病）

**根因**：`web/src/components/NewWorkModal.svelte:153-200`

1. UI 硬编码 4 个 `<button>`，没有"其他"选项或自定义输入框
2. `selectedCategory` 默认值为 `"anxiety"`（line 24），即使用户不想选也会带上默认值
3. 选了不合适的情绪后，后端 research prompt 进入该情绪的固定模板（观点输出型/对话截图型/清单盘点型），完全不适用于科幻等非情绪驱动的内容

**附带问题**：
- 前端 `ContentCategory` 类型（`"anxiety" | "conflict" | "comedy" | "envy"`）与后端 `work-store.ts` 的类型（`"info" | "beauty" | "comedy"`）不同步
- 后端靠 `as any` 强转绕过类型检查

**相关文件**：
- `web/src/components/NewWorkModal.svelte` — lines 24, 153-200
- `web/src/lib/api.ts` — line 62（前端 ContentCategory 类型）
- `src/work-store.ts` — line 22（后端 ContentCategory 类型，不同步）
- `src/server/api.ts` — lines 950-1037（情绪品类决定 prompt 模板）

---

### BUG-3: 后端进程间歇性退出导致前端素材"消失"

**严重程度**：高（用户多次遇到）
**复现**：在 Studio 页面使用一段时间后，右侧素材面板突然显示"暂无素材"。实际文件都在磁盘上，但后端 node 进程已退出，API 请求失败。

**现象**：
- 后端 node 进程（端口 3271）无规律退出
- 前端 `AssetPanel` 的 `loadAssets()` 请求失败 → `files = []` → 显示空
- 前端没有对 API 不可达做任何提示，用户以为素材被删了

**根因待查**：
- 可能是 `isDreaminaAvailable()` 在 `initProviders()` 中的超时/异常导致进程崩溃
- 可能是 agent spawn 的子进程异常退出时触发了未捕获的异常
- 当前启动方式（`node -e "import(...)"` 或后台 `&`）没有守护进程/自动重启机制

**修复方向**：
1. 后端增加 `uncaughtException` / `unhandledRejection` 全局处理，避免进程直接退出
2. 前端 `AssetPanel` 在 API 失败时显示"服务器连接失败"提示，而非"暂无素材"
3. 考虑用 pm2 或类似机制守护后端进程，崩溃后自动重启

**相关文件**：
- `src/server/index.ts` — 服务启动入口
- `web/src/components/AssetPanel.svelte` — lines 202-220（loadAssets 无错误提示）

---

### BUG-4: 阶段对话历史丢失（research、assets 阶段记录缺失）

**严重程度**：中
**复现**：月球战争 case 中，re-enter 作品后只能看到从用户手动发消息（"现在啥情况"）开始的记录，之前自动执行的话题调研和素材生成阶段的完整对话不可见。
**关联**：BUG-3（后端进程不稳定的连锁反应）

**现象**：
- `chat.json` 只有 87 条消息，从 "现在啥情况" 开始
- `steps/` 目录缺少 `research.json` 和 `assets.json`，只有 `plan.json`（26条）和 `assembly.json`（2条）
- 调研阶段和素材阶段的 Agent 思考过程、工具调用、生成结果全部丢失

**根因**：
- `saveStepHistory()` 在**阶段切换时**（`pipeline/advance`）才保存当前 step 的对话历史
- 如果后端进程在阶段执行过程中崩溃重启（BUG-3），内存中的 `messageHistory` 丢失
- 重启后 Agent 通过 `--resume` 恢复了 CLI 侧的上下文，但后端 WsBridge 的 session 是新建的，`messageHistory` 为空
- 后续阶段切换时保存的就是空的或不完整的历史

**修复方向**：
1. `messageHistory` 应增量持久化到磁盘（每收到 N 条消息或每隔 N 秒写一次），不要只在阶段切换时才保存
2. 后端重启恢复 session 时，应从磁盘加载已有的 `messageHistory`
3. 考虑将 step history 的保存与 `pipeline/advance` 解耦——Agent 每输出一个 block 就追加写入

**相关文件**：
- `src/ws-bridge.ts` — `messageHistory` 内存存储、`saveStepHistory` 调用时机
- `src/work-store.ts` — `saveStepHistory()` / `loadStepHistory()` 实现
- `src/server/api.ts` — `pipeline/advance` 端点中触发 `saveStepHistory`

---

## 三、交互优化

### OPT-1: 创建作品后不应立刻自动触发调研

**现状**：
- 用户在 NewWorkModal 中点"创建"后，`buildInitialPrompt()` 立刻构造消息并自动 POST 到 `/api/works/:id/step/research` 触发调研
- 如果用户什么都不填，系统用默认值（情绪=焦虑，无标题，无方向）直接跑完调研
- 用户没有机会在 Studio 内补充细节后再启动
**关联**：ARCH-3（意图传递链断裂）

**问题**：
- 默认值会导致毫无针对性的调研结果
- 用户可能只想先创建再慢慢填，但系统已经用默认值跑了
- 浪费 API 调用和时间

**建议方案**：

创建阶段和调研启动分离：

1. **创建阶段（Modal）**：只填基本信息（标题、内容类型），创建作品并进入 Studio
2. **Studio 内启动**：
   - 方案 A：在 Studio 内展示一个"开始创作"引导卡片，让用户填写/确认创作方向、情绪定位等，点"开始"后才触发调研
   - 方案 B：用户在对话框中自由描述想做什么（如"帮我做一个科幻短片，月球大战的题材"），Agent 从对话中提取信息后再执行调研
   - 方案 C：保留自动触发，但当必要信息缺失时（无 topicHint），Agent 先向用户提问补充信息，而不是用默认值硬跑

**推荐方案 A**——最直观，用户有明确的控制感，同时保留了自动化的效率。

---

### OPT-2: 情绪品类应改为可选项而非必选项

**现状**：情绪品类是创建流程的必选步骤，4 个固定选项。
**关联**：ARCH-1（一套模板治百病）、BUG-2

**建议**：
- 情绪品类从"创建时必选"改为"策划阶段可选"
- 保留 4 个快捷选项作为"情绪模板"，但增加：
  - "自定义"选项：用户输入自定义的情绪/风格定义
  - "让 AI 建议"选项：不选情绪，让 AI 在调研/策划阶段根据内容主题自动推荐
- 对于非情绪驱动的内容（科幻、教程、Vlog 等），情绪品类不应该决定 prompt 模板

---

### OPT-3: 视频生成应使用首帧驱动而非纯文生视频

**现状**：Agent 在素材生成阶段已经生成了 8 张高质量首帧，但调用 `dreamina text2video` 纯文字生成视频，没有利用首帧。
**关联**：ARCH-2（受阻时自主降级）

**月球战争 case 中的完整链条**：
1. Agent 正确生成了 8 张首帧（Gemini）
2. 尝试 `image2video` → 军事内容审核被拒（`PROHIBITED_CONTENT`）
3. 退化到 `text2video`（丢失了首帧的视觉控制力）
4. BGM 也因 "war" 关键词被拒，改写 prompt 后成功
5. 字幕合成因 ffmpeg 缺 drawtext 失败，改用 Pillow 方案
6. 13 层 overlay 链太长导致字幕丢失，改为逐段烧录再拼接

**Skill 层面需要补充的通用指导**：
- 当 `image2video` 因内容审核被拒时，在用 `text2video` 之前，先尝试**改写 prompt 去除敏感词**再重试 `image2video`
- 对于敏感题材（军事/暴力/医疗），在批量提交前先用 1 个样本测试通过性
- 字幕方案应首选 Pillow 渲染（跨平台无依赖），ffmpeg drawtext 作为可选加速方案

---

### BUG-5: 视频字幕渲染质量差——未使用专业字幕管线

**严重程度**：中
**复现**：月球战争 case 中，最终视频的字幕使用 PingFang SC 系统字体，无样式设计，视觉效果粗糙。
**关联**：ARCH-4（环境感知）、OPT-3

**现象**：
- `caption_generate.py` 提供了完整的 ASS 字幕生成能力（5 种预设风格、6 套高质量字体、逐词高亮 karaoke），但 Agent 从未调用过
- Agent 自己手写了简易 ASS 文件（`assets/temp/subs.ass`），使用 PingFang SC 系统字体，无 karaoke、无样式设计
- 实际环境中 ffmpeg 未编译 libass/libfreetype，`ass`/`subtitles`/`drawtext` 滤镜**全部不可用**
- Agent 最终用 Pillow 逐帧渲染字幕，但用的是系统字体而非 `~/.autoviral/fonts/` 下的高质量字体

**根因（多层）**：

1. **环境依赖缺失**：homebrew 默认 ffmpeg bottle 不编译 `--enable-libass`/`--enable-libfreetype`，导致 ASS 烧录不可用
2. **`caption_generate.py` auto 模式依赖缺失**：需要 `stable-ts`（Whisper 语音识别）才能工作，当前未安装
3. **Skill 指导不够明确**：没有强制要求"字幕必须走 `caption_generate.py`"，Agent 自由发挥了
4. **Pillow fallback 未指定字体**：Agent 用 Pillow 画字幕时使用系统字体，而非项目配置的高质量字体

**对比**：图文模式已有专业管线（HTML/CSS + Playwright + 自定义字体），效果是专业级的。视频字幕却还在 Agent 手动拼凑。

**环境实测结果**（2026-04-01）：

| 能力 | 状态 | 缺失依赖 |
|------|------|----------|
| `caption_generate.py` auto模式 | 不可用 | `stable-ts` (pip) |
| ffmpeg `ass` 滤镜 | 不可用 | ffmpeg 需源码编译 `--enable-libass` |
| ffmpeg `drawtext` | 不可用 | ffmpeg 需源码编译 `--enable-libfreetype` |
| Pillow + 自定义字体 | **可用** | Noto Sans CJK 已下载，`stroke_width` 描边效果好 |

**修复方向**：

1. **Pillow 字幕渲染作为主方案**（零外部依赖）：
   - 写一个 `subtitle_burn.py` 脚本，基于 Pillow 逐帧渲染字幕到视频
   - 强制使用 `~/.autoviral/fonts/` 下的 Noto Sans CJK 等高质量字体
   - 支持描边（`stroke_width=3`）、阴影、位置控制
   - 支持从 ASS/SRT/JSON 读取时间轴
   - Skill 中明确指定：**字幕烧录必须调用此脚本，禁止 Agent 自己用 ffmpeg drawtext 或手写方案**

2. **ASS + ffmpeg 作为增强方案**（环境满足时自动启用）：
   - 在 `check_providers.py` 或独立脚本中检测 ffmpeg 是否支持 `ass` 滤镜
   - 如果支持，优先走 `caption_generate.py` → ffmpeg `ass` 管线（效果更好、性能更高）
   - 如果不支持，自动 fallback 到 Pillow 方案

3. **字体统一管理**：
   - 视频字幕和图文排版共用 `font_manager.py` 的字体库
   - Agent 不允许使用系统字体作为字幕字体

**相关文件**：
- `skills/content-assembly/scripts/caption_generate.py` — ASS 字幕生成（未被调用）
- `skills/asset-generation/scripts/font_manager.py` — 字体管理（已工作）
- `skills/content-assembly/SKILL.md` — 合成阶段 Skill（需补充强制字幕规范）
- `skills/content-assembly/modules/subtitle-aesthetics.md` — 字幕美学参考（需更新）
