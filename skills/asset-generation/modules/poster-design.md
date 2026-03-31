# 图文排版设计模块（Poster Design）

本模块说明如何使用 HTML/CSS 模板渲染系统（`poster_render.py`）制作专业级图文排版，涵盖模板选择、数据构造、字体搭配、颜色策略和完整调用示例。

---

## 一、何时用模板渲染 vs 纯 AI 生图

| 内容特征 | 推荐方案 | 理由 |
|---------|---------|------|
| 大量文字（清单、教程、对比、步骤） | **模板渲染** `poster_render.py` | CSS 排版引擎自动换行、间距、网格，文字清晰可控 |
| 以视觉/人物/场景为主 | **纯 AI 生图** `openrouter_generate.py` | AI 擅长生成真实感视觉内容 |
| 图 + 文字混合（如美图配标题） | **AI 生图 + xhs-photo-title 模板叠加** | 先 AI 生成背景图，再用模板叠加标题和标签 |
| 封面/首图（需要大标题吸引点击） | **模板渲染** `xhs-cover` | 文字清晰度和排版质量远超 AI 文字生成 |
| 轮播图（多页统一风格） | **模板渲染**（统一模板 + 色系） | 保证页面间一致性 |

**核心判断原则：** 有文字就用模板，纯画面就用 AI，混合场景先 AI 后模板叠加。

---

## 二、模板选择指南

### 按内容类型选择

| 内容类型 | 推荐模板 | 说明 |
|---------|---------|------|
| 生活/美妆/穿搭 | `xhs-fresh` | 小清新：柔和渐变、圆角卡片、大量留白 |
| 时尚/旅行/品牌 | `xhs-premium` | 高级感：深色调、不对称布局、细线条装饰 |
| 知识/清单/教程 | `xhs-infocard` | 信息卡片：编号列表、网格布局、结构化 |
| AI 图 + 文字叠加 | `xhs-photo-title` | 美图叠字：背景图 + 半透明遮罩 + 大标题 |
| 轮播封面/首图 | `xhs-cover` | 封面标题：居中大字 + 渐变底色 |

### 按情绪氛围选择

| 情绪 | 推荐模板 | 色调建议 |
|------|---------|---------|
| 温暖/治愈 | `xhs-fresh` | 暖粉、奶油色 |
| 高级/克制 | `xhs-premium` | 深色底 + 金色点缀 |
| 专业/可信 | `xhs-infocard` | 蓝色系 |
| 震撼/吸引 | `xhs-cover` | 高饱和渐变 |
| 美好/向往 | `xhs-photo-title` | 取决于背景图 |

### 内置模板字体配置

| 模板 | 中文字体 | 英文字体 |
|------|---------|---------|
| `xhs-fresh` | 霞鹜文楷 | Inter |
| `xhs-premium` | 思源宋体 | Montserrat |
| `xhs-infocard` | 思源黑体 | — |
| `xhs-photo-title` | 思源黑体 Bold | Montserrat |
| `xhs-cover` | 思源黑体 Bold | — |

---

## 三、数据构造规范

`poster_render.py` 接受 JSON 数据，不同模板接受不同字段。构造数据时遵循以下规范：

### 通用字段

| 字段 | 类型 | 规范 | 示例 |
|------|------|------|------|
| `title` | string | **15 字以内**（缩略图中也要可读） | `"春季穿搭 | 这5套照着穿"` |
| `subtitle` | string | 20 字以内，补充说明 | `"通勤、约会、逛街都能hold住"` |
| `body` | string | 分点列表，**不超过 7 条**，用 `\n` 分行 | `"1. 针织开衫\n2. 碎花裙"` |
| `tags` | array | **3-5 个**标签 | `["穿搭", "春季", "通勤"]` |
| `footer` | string | 底部署名/水印 | `"@你的小红书号"` |
| `accent_color` | string | 主题色 hex 值 | `"#E8A87C"` |

### 字数控制原则

- **title 控制在 15 字内**：小红书信息流缩略图小，标题太长完全看不到
- **body 分点不超过 7 条**：超过 7 条信息密度太高，读者会直接划走
- **tags 3-5 个**：太少缺少 SEO 价值，太多显得杂乱
- **每条 body 项控制在 20 字内**：一行放不下会影响排版

---

## 四、字体搭配原则

### 层级体系

| 层级 | 用途 | 推荐字体 | 字重 |
|------|------|---------|------|
| 标题 | 吸引注意力 | 思源黑体 | Bold / Heavy |
| 正文 | 承载信息 | 思源黑体 | Regular |
| 氛围/手写感 | 文艺/生活内容 | 霞鹜文楷 | Regular |
| 英文标题 | 时尚/品牌感 | Montserrat | Bold |
| 英文正文 | 标签/补充说明 | Inter | Regular |

### 搭配规则

1. **同一张图最多 2-3 种字体**，不要超过 3 种
2. **中英文分别选字体**：中文用思源/文楷，英文用 Montserrat/Inter
3. **字重对比要明显**：标题用 Bold/Heavy，正文用 Regular，不要用 Light（小尺寸不清晰）
4. **标题字号是正文的 1.5-2 倍**：视觉层级清晰

### 可用字体清单

通过 `font_manager.py` 管理，首次使用时自动下载：

| ID | 名称 | 可用字重 | 适用场景 |
|----|------|---------|---------|
| `source-han-sans` | 思源黑体 | Regular, Bold, Light, Heavy | 通用标题、正文 |
| `source-han-serif` | 思源宋体 | Regular, Bold, Light | 高级感、文化内容 |
| `lxgw-wenkai` | 霞鹜文楷 | Regular, Bold, Light | 文艺、生活、手写感 |
| `smiley-sans` | 得意黑 | Regular | 活泼、搞笑 |
| `montserrat` | Montserrat | Regular, Bold | 英文标题 |
| `inter` | Inter | Regular, Bold | 英文正文、标签 |

---

## 五、颜色选择（按垂类）

不同垂类有不同的色彩调性，`accent_color` 应根据内容类型选择：

| 垂类 | 推荐色系 | accent_color 参考 |
|------|---------|------------------|
| 美妆 | 暖粉系 | `#F7CAC9`（暖粉）、`#B76E79`（玫瑰金） |
| 美食 | 暖橙系 | `#F4A460`（暖橙）、`#FFF8DC`（奶油） |
| 穿搭 | 米杏系 | `#E8D5C4`（米杏）、`#C4A882`（浅驼） |
| 科技 | 冷蓝系 | `#4A90D9`（冷蓝）、`#2C3E50`（深灰） |
| 知识/教育 | 纯白 + 品牌色 | `#FFFFFF` + 品牌色点缀 |
| 旅行 | 大地色 | `#D4A574`（暖地球色）、`#87CEEB`（雾蓝） |
| 健身/运动 | 活力色 | `#FF6B35`（活力橙）、`#2ECC71`（活力绿） |

**选色原则：**
- 同一组图文使用同一个 `accent_color`
- 颜色饱和度适中，避免过于鲜艳（莫兰迪色系优先）
- 深色底模板（`xhs-premium`）用浅色/金色点缀：`#C9A96E`（金色）

---

## 六、轮播图一致性

小红书轮播图（多页图文）必须保持视觉一致性：

### 强制规则

1. **同一组图文使用相同模板**：封面用 `xhs-cover`，内页全部用同一个内容模板
2. **`accent_color` 贯穿所有页面**：每页的 `--data` 中都传入相同的 `accent_color`
3. **字体不变**：模板已锁定字体，不要在页面间切换模板
4. **背景风格统一**：纯模板页面用相同底色/渐变，美图叠字页面用相同色调的背景图

### 推荐轮播结构

```
第1页：xhs-cover（封面标题，吸引点击）
第2页：xhs-infocard / xhs-fresh（内容正文第1部分）
第3页：xhs-infocard / xhs-fresh（内容正文第2部分）
...
第N页：xhs-infocard / xhs-fresh（总结/CTA）
```

### 文件命名

```
assets/posters/
  cover.png        （封面）
  page-1.png       （内页1）
  page-2.png       （内页2）
  page-3.png       （内页3）
```

---

## 七、AI 生图 + 文字叠加工作流

当需要在 AI 生成的美图上叠加文字时，使用两步工作流：

### 步骤

```
1. openrouter_generate.py → 生成背景图（纯视觉，不含文字）
2. poster_render.py --template xhs-photo-title --bg-image bg.png → 叠加排版
```

### 详细流程

```bash
# 第1步：用 AI 生成高质量背景图
python3 skills/asset-generation/scripts/openrouter_generate.py \
  --prompt "春季公园樱花盛开，温暖阳光，清新自然，摄影风格" \
  --ar 3:4 --size 2K \
  --output assets/posters/bg-cover.png

# 第2步：用 xhs-photo-title 模板叠加文字
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-photo-title \
  --bg-image assets/posters/bg-cover.png \
  --data '{"title":"早春穿搭灵感","subtitle":"温柔又高级","tags":["穿搭","春季","日常"]}' \
  --output assets/posters/cover.png
```

**注意事项：**
- AI 生图时 **不要在 prompt 中要求生成文字**——AI 文字生成不可靠
- 背景图的主体内容应集中在上半部分，因为 `xhs-photo-title` 的文字区域在下方
- 背景图分辨率建议与模板输出一致（默认 1080x1440，即 3:4）

---

## 八、完整调用示例

### 场景 1：知识清单卡片

```bash
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-infocard \
  --data '{"title":"5个高效学习法","body":"1. 番茄钟：25分钟专注\n2. 费曼技巧：用教别人来学习\n3. 间隔重复：科学复习节奏\n4. 主动回忆：合上书考自己\n5. 思维导图：构建知识网络","tags":["学习","效率","自律"],"accent_color":"#4A90D9"}' \
  --output assets/posters/page-1.png
```

### 场景 2：小清新穿搭分享

```bash
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-fresh \
  --data '{"title":"春季穿搭 | 照着穿就对了","subtitle":"通勤约会都能hold住","body":"1. 奶白针织开衫 + 高腰牛仔裤\n2. 碎花连衣裙 + 小白鞋\n3. 西装外套 + 阔腿裤","tags":["穿搭","春季","通勤"],"footer":"@穿搭日记","accent_color":"#E8D5C4"}' \
  --output assets/posters/page-1.png
```

### 场景 3：高级感旅行图文

```bash
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-premium \
  --data '{"title":"京都三日行","subtitle":"一场关于美学的旅行","body":"Day 1: 岚山竹林\nDay 2: 伏见稻荷\nDay 3: 金阁寺","tags":["旅行","京都","日本"],"accent_color":"#C9A96E"}' \
  --output assets/posters/page-1.png
```

### 场景 4：美图 + 文字叠加封面

```bash
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-photo-title \
  --bg-image ai_generated_photo.png \
  --data '{"title":"早春穿搭灵感","subtitle":"温柔又高级","tags":["穿搭","春季"]}' \
  --output assets/posters/cover.png
```

### 场景 5：轮播封面

```bash
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-cover \
  --data '{"title":"5个改变人生的习惯","subtitle":"坚持一个月你会感谢自己","accent_color":"#4A90D9"}' \
  --output assets/posters/cover.png
```

### 场景 6：完整轮播图（封面 + 多内页）

```bash
# 封面
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-cover \
  --data '{"title":"高效学习指南","subtitle":"5个方法让你学习效率翻倍","accent_color":"#4A90D9"}' \
  --output assets/posters/cover.png

# 内页1
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-infocard \
  --data '{"title":"方法一：番茄钟","body":"1. 设定25分钟倒计时\n2. 全神贯注做一件事\n3. 铃响后休息5分钟\n4. 每4个番茄休息15分钟","tags":["学习","效率"],"accent_color":"#4A90D9"}' \
  --output assets/posters/page-1.png

# 内页2
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-infocard \
  --data '{"title":"方法二：费曼技巧","body":"1. 选择一个概念\n2. 用简单语言解释给别人\n3. 发现说不清的地方\n4. 回去重新学习","tags":["学习","效率"],"accent_color":"#4A90D9"}' \
  --output assets/posters/page-2.png
```

### 场景 7：从 JSON 文件读取数据

```bash
# 数据较多时，可以先写入 JSON 文件
cat > poster-data.json << 'EOF'
{
  "title": "春季必买清单",
  "subtitle": "这些单品闭眼入",
  "body": "1. 奶白色针织开衫\n2. 高腰直筒牛仔裤\n3. 碎花连衣裙\n4. 小白鞋\n5. 帆布托特包",
  "tags": ["穿搭", "春季", "购物清单"],
  "footer": "@穿搭日记",
  "accent_color": "#E8A87C"
}
EOF

python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-fresh \
  --data poster-data.json \
  --output assets/posters/page-1.png
```

### 场景 8：自定义输出尺寸

```bash
# 抖音竖屏尺寸 (9:16)
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-cover \
  --data '{"title":"今日穿搭","accent_color":"#E8D5C4"}' \
  --width 1080 --height 1920 \
  --output assets/posters/douyin-cover.png

# JPEG 格式（文件更小）
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-fresh \
  --data '{"title":"测试","tags":["test"]}' \
  --format jpeg \
  --output assets/posters/test.jpeg
```

---

## 九、脚本参数速查

### poster_render.py

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--template` | str（必填） | 内置模板 ID 或自定义 HTML 路径 | — |
| `--data` | str（必填） | JSON 文件路径或 inline JSON 字符串 | — |
| `--output` | str（必填） | 输出图片路径 | — |
| `--bg-image` | str | 背景图路径（xhs-photo-title 等模板用） | — |
| `--width` | int | 输出宽度 px | `1080` |
| `--height` | int | 输出高度 px | `1440` |
| `--scale` | float | 渲染倍率（2 = Retina 清晰度） | `2` |
| `--format` | str | 输出格式 `png` / `jpeg` | `png` |

### font_manager.py

| 参数 | 说明 |
|------|------|
| `--font <ID>` | 获取指定字体路径（自动下载） |
| `--weight <W>` | 字重：`regular` / `bold` / `light` / `heavy` |
| `--list` | 列出所有字体及下载状态 |

```bash
# 查看所有可用字体
python3 skills/asset-generation/scripts/font_manager.py --list

# 获取指定字体路径
python3 skills/asset-generation/scripts/font_manager.py --font source-han-sans --weight bold
```

### 输出格式（stdout JSON）

```json
{
  "success": true,
  "output": "/absolute/path/to/poster.png",
  "template": "xhs-fresh",
  "width": 1080,
  "height": 1440,
  "size_kb": 342.5
}
```

### 依赖

| 依赖 | 安装命令 | 说明 |
|------|---------|------|
| `playwright` | `pip install playwright && playwright install chromium` | 浏览器渲染引擎 |
| `jinja2` | `pip install jinja2` | HTML 模板引擎 |
| `font_manager.py` | 无需安装 | 自动下载管理字体 |
