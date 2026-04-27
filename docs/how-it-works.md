# AutoViral 技术原理详解

> ⚠️ **ARCHIVED — legacy architecture (pre-D3)**
> 本文描述 2026-04 之前以"四步流水线 / pipeline / 阶段顺序"为核心的旧架构，已被 modules-as-capabilities 模式取代。新架构请参考 `README.md` §2、`docs/skill-structure-guide.md`、`docs/superpowers/specs/2026-04-25-ui-redesign-design.md`。本文保留作为历史参考。

本文档详细解释 AutoViral 旧版本（pre-D3）的探索功能和四步创作流水线的工作原理。

---

## 目录

- [探索页：趋势发现](#探索页趋势发现)
- [流水线概览](#流水线概览)
- [第一步：话题调研](#第一步话题调研)
- [第二步：内容规划](#第二步内容规划)
- [第三步：素材生成](#第三步素材生成)
- [第四步：视频合成 / 图文排版](#第四步视频合成--图文排版)
- [流水线状态管理](#流水线状态管理)
- [即梦 API 集成原理](#即梦-api-集成原理)

---

## 探索页：趋势发现

探索页面让用户在开始创作之前，先了解平台上什么内容正在火。

### 工作流程

```
用户点击"刷新趋势"
  → 前端 POST /api/trends/refresh-stream
  → 后端生成临时 WebSocket session（trends_douyin_xxx）
  → 启动 Claude CLI（haiku 模型，低成本）
  → CLI 用 WebSearch 搜索平台热门话题
  → 实时通过 WebSocket 推送搜索进度到前端
  → 结果解析为 JSON，保存到 ~/.autoviral/trends/{平台}/{日期}.yaml
  → 前端展示趋势卡片
```

### 搜索策略

Claude 会执行 3 组搜索：
1. `"{平台} 热门话题 2026"` — 当前热点
2. `"{平台} 爆款内容 趋势"` — 爆款模式
3. `"{平台} 热搜榜"` — 实时热搜

搜索结果被整理为结构化 JSON：

```json
{
  "topics": [
    {
      "title": "话题标题",
      "heat": 4,
      "competition": "中",
      "description": "简短描述和建议方向"
    }
  ]
}
```

### 实时进度展示

探索页通过 WebSocket 接收 agent 的实时事件，展示轻量级进度时间线：

| 事件 | 展示 |
|------|------|
| `search_query` | "搜索 '抖音 热门话题 2026'" |
| `search_result` | 上一条搜索标记完成 |
| `analyzing` | "正在分析整理..." |
| `research_done` | 进度完成，卡片列表淡入 |

用户看到感兴趣的趋势方向，可以直接点击"以此创建作品"进入创作流水线。

---

## 流水线概览

每个作品由 4 个阶段组成，按顺序执行：

```
话题调研 → 内容规划 → 素材生成 → 视频合成/图文排版
 pending    pending    pending      pending
  ↓
 active  →  done
             ↓
            active  →  done
                        ↓
                       active  →  done
                                   ↓
                                  active  →  done
```

每个阶段对应一个 AI 技能文件（`skills/` 目录），定义了 agent 在该阶段的完整知识库和行为规范。Agent 在 Studio 页面中通过聊天界面与用户协作，每个阶段都会先和用户确认方案再执行。

---

## 第一步：话题调研

**技能文件：** `skills/autoviral/modules/research/SKILL.md`

### 两种调研模式

| 模式 | 触发条件 | 行为 |
|------|----------|------|
| **广度模式** | 用户没有指定选题方向 | 全面调研平台各品类热门趋势 |
| **深度模式** | 用户指定了方向（如"奶龙"） | 围绕该方向深度分析竞品、受众、差异化机会 |

### 平台算法知识

Agent 内置了两个平台的推荐算法理解：

**抖音 — 阶梯流量池机制：**
- 初始池（200-500 播放）：测试完播率、点赞率、评论率、转发率
- 二级池（3K-5K 播放）：完播率 >30%，点赞率 >3%，评论率 >1%
- 三级池（1W-5W 播放）：测试中后段内容质量
- 爆款池（10W+ 播放）：转发率成为核心指标
- 权重排序：完播率 > 互动率 > 转发率 > 关注转化 > 复播率

**小红书 — CES 评分系统：**
- 公式：点赞×1 + 收藏×1 + 评论×4 + 转发×4 + 关注×8
- 评论和转发权重 4 倍，关注权重 8 倍
- 60% 流量来自搜索 → SEO 极其关键
- 48 小时新内容加权

### 病毒传播机制

**抖音 3 秒法则 — Hook 类型：**
- 悬念型："你绝对想不到..."
- 冲突型：展示矛盾/反差
- 利益型："学会这个，你的视频播放量翻 10 倍"
- 共鸣型："每个打工人都经历过..."
- 视觉冲击型：震撼画面开场

**小红书美学优先原则：**
- 内容公式：教程 > 合集 > 测评 > 避坑 > 变身
- 核心：真实感 > 过度包装
- 利他性、细节控、场景化

### 趋势评估框架

Agent 用热度/竞争度矩阵评估每个方向：

| 热度\竞争 | 低竞争 | 高竞争 |
|-----------|--------|--------|
| **高热度** | 金矿（立即行动） | 红海（需差异化） |
| **低热度** | 蓝海（长线布局） | 回避 |

### 标签策略

**抖音 — 金字塔结构（5-7 个）：**
- 大标签（10B+ 播放）：1-2 个，如 #美食
- 中标签（10M-1B 播放）：2-3 个，如 #家常菜
- 小标签（<10M 播放）：2-3 个，如 #上班族快手菜

**小红书 — SEO 关键词：**
- 标题关键词（2-3 个搜索友好词）比标签更重要
- 正文标签 5-10 个（用户真实搜索的短语）
- 标题加 emoji 可提升 ~15% 点击率

### 输出

一份结构化的 Markdown 调研报告，包含：推荐方向排名表、热度/竞争度评分、标签组合建议、爆款案例分析、最佳发布时间建议。

---

## 第二步：内容规划

**技能文件：** `skills/autoviral/modules/planning/SKILL.md`

### 核心能力

根据调研结果，为用户设计具体的创作方案。短视频产出分镜脚本，图文产出图片结构规划。

### 视觉构图规则

Agent 掌握专业的构图语言：

| 技法 | 用途 |
|------|------|
| 三分法 | 主体放在 3×3 网格交叉点 |
| 引导线 | 用建筑线条、道路引导视线 |
| 框架构图 | 门窗、屏幕作为画框创造纵深 |
| 留白 | 为字幕和平台 UI 预留空间 |
| 竖屏构图 | 9:16 画面中主体填充 60-80% |

### 镜头语言

推（强调细节）、拉（展示全景）、摇（扫视场景）、移（跟随动作）、俯拍（展示布局）、仰拍（主体显得强大）、特写（展示情感）、手持（真实感）

### 叙事节奏模板

**教程型（30-60s）：**
```
[Hook: 成品展示 3s] → [问题引出 3s] → [步骤1 5-8s] → [步骤2 5-8s] → [步骤3 5-8s] → [成品特写 3s] → [CTA 3s]
```

**故事型（30-60s）：**
```
[Hook: 冲突/悬念 3s] → [背景交代 5s] → [发展 10-15s] → [高潮/反转 5-8s] → [结局 3-5s] → [CTA 3s]
```

**种草型/小红书（15-30s）：**
```
[Hook: 痛点 3s] → [产品介绍 5s] → [使用展示 5-8s] → [效果对比 5s] → [总结推荐 3s] → [CTA 3s]
```

### 色彩心理学

| 色调 | 情绪 | 适用品类 |
|------|------|----------|
| 暖橙/黄 | 温馨、食欲 | 美食、生活、家居 |
| 冷蓝/青 | 专业、冷静 | 科技、教育、商务 |
| 粉色调 | 柔美、浪漫 | 美妆、时尚、情感 |
| 大地色 | 自然、质朴 | 旅行、健康、环保 |
| 莫兰迪色 | 优雅、高级 | 小红书审美、高端产品 |
| 胶片/复古 | 怀旧、文艺 | 文化内容、生活方式 |

### 视觉一致性设计

规划阶段会定义两个核心一致性模块，供后续素材生成使用：

**角色定义块：**
```
【角色定义】
角色A: young Chinese woman, age 25, long black hair, wearing white linen shirt
and light blue jeans, natural makeup, warm smile
```
每个镜头必须完整复制角色描述，不能用简写。

**风格定义块：**
```
【风格定义】
Style: soft natural lighting, warm color grading, shallow depth of field,
lifestyle photography aesthetic
Negative: blurry, distorted, oversaturated, artificial
```
附加到每一个生成提示词后面，确保全片风格统一。

### 输出格式

**短视频分镜脚本：**

| 镜号 | 场景描述 | 首帧提示词（英文） | 时长 | 旁白/字幕 | 镜头运动 |
|------|---------|-------------------|------|----------|---------|
| 01 | 开场特写 | Detailed English prompt... | 3s | "你知道吗？" | 缓推 |
| 02 | 主体展示 | Detailed English prompt... | 5s | 解说词 | 固定 |

**图文内容结构：**
- 封面图（含标题文字叠加位置）
- 每张图的内容描述、配文、尺寸
- 发布文案（标题、正文、标签）

---

## 第三步：素材生成

**技能文件：** `skills/autoviral/modules/assets/SKILL.md`

### 核心原则

**绝不在未经用户确认的情况下生成素材。** 每生成一个素材前，先描述计划，等用户确认后再调用 API。这防止了浪费生成额度，并确保创作者始终掌控创意方向。

### 短视频素材流程

```
对于每个镜头：
  1. 向用户描述即将生成的画面
  2. 等待用户确认
  3. 调用 即梦 API 生成首帧图片（文生图）
  4. 展示预览，询问是否满意
  5. 满意后，用首帧图片生成视频片段（图生视频）
  6. 展示视频预览
  7. 进入下一个镜头
```

### 图文素材流程

```
对于每张图片：
  1. 描述即将生成的图片内容
  2. 等待用户确认
  3. 调用 即梦 API 生成图片
  4. 展示预览，继续下一张
```

### 图片生成提示词工程

**提示词结构：**
```
[质量关键词], [主体描述], [动作/姿态], [环境], [光线], [镜头/构图], [风格], [色彩/氛围]
```

**质量关键词：** `masterpiece, best quality, highly detailed, sharp focus, professional photography, 8K, ultra HD`

**主体描述最佳实践：**
- 人物：种族、年龄、性别、发型（颜色/长度/风格）、服装（具体单品/颜色/面料）、表情、配饰
- 食物：菜名、可见食材、摆盘风格、装盘容器、点缀
- 场景：地点类型、时间、天气、关键物品、氛围

**光线关键词对照：**

| 类型 | 关键词 | 适用 |
|------|--------|------|
| 自然柔光 | `soft natural light, window light` | 生活、美妆、美食 |
| 黄金时段 | `golden hour, warm sunset glow` | 户外、浪漫 |
| 影棚光 | `studio lighting, softbox, rim light` | 产品、时尚 |
| 戏剧光 | `chiaroscuro, dramatic side lighting` | 艺术、故事 |
| 霓虹光 | `neon lights, city lights` | 都市、科技 |

### 视频生成提示词

视频提示词描述的是**运动和动作**，不是静态场景（首帧已经定义了画面）：

```
# 好的视频提示词
"Camera slowly pushes in, woman turns to face camera and smiles, hair gently sways"
"Smooth pan left to right revealing the full kitchen counter, steam rising from pot"

# 差的视频提示词
"Beautiful woman in kitchen"  # 没有运动描述
"Nice cooking video"          # 太模糊
```

**运动关键词：**
- 缓慢：`slowly, gently, gradually, subtle movement`
- 动感：`quickly, energetically, dynamic movement`
- 镜头：`camera pans left, dolly forward, zoom in, static locked shot`
- 自然：`hair blowing in wind, fabric flowing, water rippling`

### 风格一致性技术

1. **风格后缀** — 从规划阶段的风格定义块提取，附加到每个提示词末尾
2. **角色描述复用** — 完整复制角色定义，不使用简写或代词
3. **色彩锚定** — 每个提示词中显式包含色彩值：`color palette: warm cream (#F5E6CC), soft terracotta (#C4785B)`
4. **参考图传递** — 可将已生成的图片作为参考图传入 API

### 尺寸规格

| 平台 | 用途 | 比例 | 像素 |
|------|------|------|------|
| 抖音视频 | 标准 | 9:16 | 1088×1920 |
| 小红书图片 | 标准 | 3:4 | 1080×1440 |
| 小红书图片 | 长图 | 9:16 | 1080×1920 |
| 小红书图片 | 方图 | 1:1 | 1088×1088 |

> 即梦 API 要求宽高为 64 的倍数，范围 576-1728

---

## 第四步：视频合成 / 图文排版

**技能文件：** `skills/autoviral/modules/assembly/SKILL.md`

### 短视频合成流程

使用 FFmpeg 将素材组装成最终视频：

```
1. 标准化所有片段（统一分辨率、帧率、编码）
2. 拼接片段（可选转场效果）
3. 添加字幕
4. 混入背景音乐
5. 输出成品视频 + 发布文案
```

#### 片段标准化

```bash
ffmpeg -i clip-01.mp4 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" \
  -r 30 -c:v libx264 -preset medium -crf 23 -c:a aac -ar 44100 \
  -y norm-01.mp4
```

#### 转场效果

Agent 掌握 18+ 种 FFmpeg xfade 转场：

| 效果 | 风格 | 适用 |
|------|------|------|
| `fade` | 渐隐渐现 | 通用，柔和 |
| `dissolve` | 像素溶解 | 梦幻、柔美 |
| `wipeleft` | 左推 | 动感、连续 |
| `circlecrop` | 圆形展开 | 创意、吸引注意力 |
| `fadeblack` | 过黑转场 | 场景切换、时间跳跃 |

转场时长参考：快节奏（抖音 Hook）0.2-0.3s，标准 0.3-0.5s，电影感 0.5-1.0s

#### 字幕

**drawtext 滤镜（简单字幕）：**
```bash
ffmpeg -i video.mp4 \
  -vf "drawtext=text='你知道吗？':enable='between(t,0,3)':fontsize=56:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82:fontfile=/System/Library/Fonts/PingFang.ttc" \
  -y subtitled.mp4
```

**ASS 字幕（高级样式）：** 支持多种字体、颜色、动画效果

字幕规范：
- 字号：48-64px（1080p 竖屏）
- 颜色：白色 + 黑色描边（borderw=2-4）
- 位置：距顶 75-85%（避开平台 UI）
- 每行最多 15-18 个中文字符

#### 音乐混合

```bash
ffmpeg -i subtitled.mp4 -i music.mp3 \
  -filter_complex "[1:a]volume=0.3,afade=t=in:st=0:d=1,afade=t=out:st=22:d=2[music];[0:a][music]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -y final.mp4
```

音量参考：
| 场景 | 音乐音量 |
|------|----------|
| 纯背景音乐 | 0.3-0.5 |
| 有旁白时 | 0.15-0.25 |
| 音乐为主 | 0.7-1.0 |

### 图文排版流程

```
1. 可选：为封面图添加标题文字叠加
2. 按顺序整理所有图片到 output/ 目录
3. 可选：创建图片拼贴
4. 生成发布文案
```

### 发布文案生成

合成完成后自动生成 `output/publish-text.md`：

**抖音文案：** 标题（≤55 字符）+ 文案 + 5-7 个标签 + 发布时间建议

**小红书文案：** SEO 标题（≤20 字符，含 emoji）+ 正文（300-800 字，关键词自然植入）+ 5-10 个标签 + 3-5 个话题

### 平台输出规格

| 规格 | 抖音 | 小红书 |
|------|------|--------|
| 视频编码 | H.264, CRF 20, 30fps | H.264, CRF 22, 30fps |
| 视频时长 | 建议 <60s | 建议 <5min |
| 文件大小 | 建议 <50MB | 视频 <1GB，图片 <20MB |
| 封面 | 视频截帧或自定义 | 第一张图即封面 |

---

## 流水线状态管理

### Agent 自主推进

Agent 的 system prompt 中包含完整的流水线状态和推进指令。Agent 在每次回答前会判断当前阶段是否完成，如果完成则主动调用 API 更新状态：

```bash
curl -X POST http://localhost:3271/api/works/{workId}/pipeline/advance \
  -H "Content-Type: application/json" \
  -d '{"completedStep":"research","nextStep":"plan"}'
```

### 实时同步

后端收到推进请求后：
1. 更新 `work.yaml` 中的 pipeline 状态
2. 通过 WebSocket 广播 `pipeline_updated` 事件
3. 前端实时更新左侧流水线面板

---

## 即梦 API 集成原理

### 认证方式

使用 HMAC-SHA256 签名（类似 AWS SigV4），实现在 `src/providers/jimeng.ts`：

```
1. 生成 ISO8601 时间戳
2. 构建 Canonical Request（HTTP 方法 + 路径 + 查询参数 + 请求头 + 请求体哈希）
3. 计算 Credential Scope（日期/区域/服务/request）
4. HMAC-SHA256 链式签名：SecretKey → 日期 → 区域 → 服务 → "request"
5. 生成 Authorization 请求头
```

### 异步任务模型

即梦 API 采用提交-轮询模式：

```
1. 提交生成任务 → 获取 task_id
2. 每 2 秒轮询一次结果
3. 最长等待 5 分钟
4. 成功：下载文件到本地
5. 失败/超时：返回错误
```

### 服务标识

| 能力 | req_key |
|------|---------|
| 文生图 v4.0 | `jimeng_t2i_v40` |
| 文/图生视频 v3.0 Pro | `jimeng_ti2v_v30_pro` |

### 文件存储

生成的素材自动下载到作品目录：
- 图片 → `~/.autoviral/works/{workId}/assets/frames/` 或 `images/`
- 视频 → `~/.autoviral/works/{workId}/assets/clips/`
- 成品 → `~/.autoviral/works/{workId}/output/`
