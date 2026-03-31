# 图文排版体系设计

> **Goal:** 为 asset-generation skill 新增 HTML/CSS 模板驱动的图文排版能力，支持纯模板生成和 AI 图 + 文字叠加两种模式，内置小红书主流风格模板。

## 背景

当前图文内容的文字叠加仅靠 ffmpeg drawtext，排版能力极其有限：无自动换行、无 CSS grid/flex、字体选择单一（系统 PingFang）、布局全靠手动 x/y 坐标。

小红书头部内容的排版质量远超 drawtext 能达到的水平。需要一个基于 HTML/CSS 的渲染管线，利用浏览器排版引擎实现专业级图文设计。

## 决策记录

| 决策 | 选项 | 理由 |
|------|------|------|
| 渲染方案 | HTML/CSS + Playwright 截图 | CSS 排版引擎最成熟，自动换行/间距/渐变/阴影全支持 |
| 模板引擎 | Jinja2 | Python 生态最通用，与现有脚本一致 |
| 两种模式 | 纯模板生成 + AI 图叠字 | 小红书内容形态多样，两种都需要 |
| 字体 | font_manager.py 统一管理 | 与字幕能力共享，自动下载 |
| 分辨率 | 2x Retina 渲染后输出 1080px | 锐利文字边缘，专业质感 |

## 新增/修改文件

### 1. `skills/asset-generation/scripts/poster_render.py`（新建）

HTML/CSS 模板驱动的图文渲染脚本。

**参数：**

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--template` | str (必填) | 内置模板 ID 或自定义 HTML 路径 | — |
| `--data` | str (必填) | 数据 JSON 路径或 inline JSON 字符串 | — |
| `--output` | str (必填) | 输出图片路径 | — |
| `--bg-image` | str | 背景图路径（AI 生成的图叠字用） | — |
| `--width` | int | 输出宽度 px | `1080` |
| `--height` | int | 输出高度 px | `1440` |
| `--scale` | float | 渲染倍率 | `2` |
| `--format` | str | 输出格式 png/jpeg | `png` |

**数据 JSON 格式：**

```json
{
  "title": "春季穿搭 | 这5套照着穿就对了",
  "subtitle": "通勤、约会、逛街都能hold住",
  "body": "1. 奶白色针织开衫 + 高腰牛仔裤\n2. 碎花连衣裙 + 小白鞋\n3. 西装外套 + 阔腿裤",
  "tags": ["穿搭", "春季", "通勤"],
  "footer": "@你的小红书号",
  "accent_color": "#E8A87C"
}
```

不同模板可接受不同字段，agent 根据模板要求构造 JSON。

**核心逻辑：**

```python
def render_poster(template, data, output_path, bg_image=None,
                  width=1080, height=1440, scale=2, fmt="png"):
    # 1. 加载模板
    if is_builtin_template(template):
        html_path, css_path = get_builtin_template(template)
    else:
        html_path = template  # 自定义 HTML 路径

    # 2. 准备字体
    font_paths = prepare_fonts(data.get("fonts", template_default_fonts))
    # 生成 @font-face CSS 声明

    # 3. Jinja2 渲染 HTML
    html_content = render_jinja2(html_path, css_path, data, font_faces, bg_image)

    # 4. Playwright 截图
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height},
                                device_scale_factor=scale)
        page.set_content(html_content)
        page.wait_for_load_state("networkidle")
        # 截图指定元素或全页
        page.locator(".poster").screenshot(path=output_path, type=fmt)
        browser.close()

    # 5. 输出结果
```

**使用示例：**

```bash
# 纯模板生成（知识卡片）
python3 poster_render.py \
  --template xhs-infocard \
  --data '{"title":"5个高效学习法","body":"1. 番茄钟...\n2. 费曼技巧...","tags":["学习","效率"]}' \
  --output card.png

# AI 图 + 文字叠加（穿搭封面）
python3 poster_render.py \
  --template xhs-photo-title \
  --bg-image ai_generated_outfit.png \
  --data '{"title":"早春穿搭灵感","subtitle":"温柔又高级","tags":["穿搭","春季"]}' \
  --output cover.png
```

**输出格式（stdout JSON）：**
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

### 2. `skills/asset-generation/templates/`（新建目录）

内置模板存放目录，每个模板一个子目录：

```
templates/
  xhs-fresh/
    index.html
    style.css
  xhs-premium/
    index.html
    style.css
  xhs-infocard/
    index.html
    style.css
  xhs-photo-title/
    index.html
    style.css
  xhs-cover/
    index.html
    style.css
```

**内置模板：**

| 模板 ID | 风格 | 适用内容 | 字体 |
|---------|------|---------|------|
| `xhs-fresh` | 小清新：柔和渐变背景、圆角卡片、大量留白 | 生活/美妆/穿搭 | 霞鹜文楷 + Inter |
| `xhs-premium` | 高级感：深色调、不对称布局、细线条装饰 | 时尚/旅行/品牌 | 思源宋体 + Montserrat |
| `xhs-infocard` | 信息卡片：纯色背景、网格布局、编号列表 | 知识/清单/教程 | 思源黑体 + Inter |
| `xhs-photo-title` | 美图叠字：背景图 + 半透明遮罩 + 大标题 | AI 图 + 文字 | 思源黑体 Bold + Montserrat |
| `xhs-cover` | 封面标题：居中大字 + 副标题 + 渐变底色 | 轮播首图/封面 | 思源黑体 Bold |

**模板 HTML 结构规范：**

- 根元素 `.poster` 设置 `width`/`height` 为 100%
- 通过 `@font-face` 加载 font_manager 管理的本地字体
- 支持 `{{ bg_image }}` 变量注入背景图（base64 或 file:// URL）
- 所有文字元素使用 CSS class 控制，不硬编码样式
- 安全边距：四周至少 48px padding

**模板设计规范：**

- 标题字号：48-60px，行高 1.2
- 正文字号：28-32px，行高 1.6
- 标签字号：24px，圆角 pill 形背景
- 字体层级：最多 3 级（标题/正文/标签）
- 颜色：支持 `accent_color` 变量覆盖主题色

### 3. `skills/asset-generation/modules/poster-design.md`（新建）

Agent 阅读的图文排版方法论指南。

**内容结构：**

1. **何时用模板渲染 vs 纯 AI 生图**
   - 有大量文字（清单、教程、对比）→ 模板渲染
   - 以视觉/人物/场景为主 → 纯 AI 生图
   - 图 + 文字混合 → AI 生图 + `xhs-photo-title` 模板叠加

2. **模板选择指南**
   - 生活/美妆/穿搭 → `xhs-fresh`
   - 时尚/旅行/品牌 → `xhs-premium`
   - 知识/清单/教程 → `xhs-infocard`
   - AI 图 + 文字 → `xhs-photo-title`
   - 轮播封面 → `xhs-cover`

3. **数据构造规范**
   - title 控制在 15 字内（缩略图也要可读）
   - tags 3-5 个
   - body 分点不超过 7 条
   - accent_color 按垂类选择

4. **字体搭配原则**
   - 标题：粗体（思源黑体 Bold）
   - 正文：常规（思源黑体 Regular）
   - 氛围/手写感：霞鹜文楷
   - 英文标题：Montserrat Bold
   - 英文正文：Inter Regular

5. **颜色选择（按垂类）**
   - 美妆 → 暖粉 `#F7CAC9` / 玫瑰金 `#B76E79`
   - 美食 → 暖橙 `#F4A460` / 奶油 `#FFF8DC`
   - 穿搭 → 米杏 `#E8D5C4` / 浅驼 `#C4A882`
   - 科技 → 冷蓝 `#4A90D9` / 深灰 `#2C3E50`
   - 知识 → 纯白 `#FFFFFF` + 品牌色点缀
   - 旅行 → 暖地球色 `#D4A574` / 雾蓝 `#87CEEB`

6. **轮播图一致性**
   - 同一组图文使用相同模板和色系
   - 封面用 `xhs-cover`，内页用对应内容模板
   - accent_color 贯穿所有页面

7. **与 AI 生图的配合流程**
   ```
   openrouter_generate.py → 生成背景图
   poster_render.py --bg-image bg.png → 叠加排版
   ```

### 4. `skills/asset-generation/SKILL.md` 更新

在"生成脚本"章节新增：
- `poster_render.py` 用法文档和示例命令
- `font_manager.py` 用法文档
- templates 目录说明

在 modules 表格中新增 `poster-design` 模块。

在"文件命名规范"中追加：
```
assets/posters/
  cover.png        （封面）
  page-1.png       （内页1）
  page-2.png       （内页2）
```

## 不改动的部分

- **openrouter_generate.py** — 不改，AI 生图逻辑不变
- **check_providers.py** — 不改，Playwright 是本地渲染
- **content-assembly skill** — 不改（图文排版属于 asset-generation 阶段）
- **前端** — 无 UI 改动
- **evaluator** — 现有评审标准不涉及排版质量

## 依赖

| 依赖 | 用途 | 安装 |
|------|------|------|
| `playwright` | 浏览器渲染 HTML→PNG | `pip install playwright && playwright install chromium` |
| `jinja2` | HTML 模板引擎 | `pip install jinja2` |

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `skills/asset-generation/scripts/poster_render.py` |
| 新建 | `skills/asset-generation/templates/xhs-fresh/index.html` |
| 新建 | `skills/asset-generation/templates/xhs-fresh/style.css` |
| 新建 | `skills/asset-generation/templates/xhs-premium/index.html` |
| 新建 | `skills/asset-generation/templates/xhs-premium/style.css` |
| 新建 | `skills/asset-generation/templates/xhs-infocard/index.html` |
| 新建 | `skills/asset-generation/templates/xhs-infocard/style.css` |
| 新建 | `skills/asset-generation/templates/xhs-photo-title/index.html` |
| 新建 | `skills/asset-generation/templates/xhs-photo-title/style.css` |
| 新建 | `skills/asset-generation/templates/xhs-cover/index.html` |
| 新建 | `skills/asset-generation/templates/xhs-cover/style.css` |
| 新建 | `skills/asset-generation/modules/poster-design.md` |
| 修改 | `skills/asset-generation/SKILL.md` |

> 注：`font_manager.py` 已在 pro-captions spec 中列出，不重复计入。
