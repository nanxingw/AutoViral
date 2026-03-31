# Pro Captions + Poster Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add professional word-by-word karaoke captions and HTML/CSS template-based poster rendering to AutoViral's content pipeline.

**Architecture:** Three scripts — a shared `font_manager.py` for font downloading/management, `caption_generate.py` for stable-ts + ASS karaoke subtitles, and `poster_render.py` for Jinja2 + Playwright HTML template rendering. Each script follows the existing pattern (argparse CLI, stdout JSON, load_env for .env).

**Tech Stack:** Python 3.12, stable-ts (Whisper), ffmpeg ASS filters, Playwright, Jinja2

**Specs:**
- `docs/superpowers/specs/2026-03-31-pro-captions-design.md`
- `docs/superpowers/specs/2026-03-31-poster-render-design.md`

---

### Task 1: font_manager.py — Shared Font Management

**Files:**
- Create: `skills/asset-generation/scripts/font_manager.py`

- [ ] **Step 1: Create font_manager.py with font registry and download logic**

Follow the existing script pattern from `openrouter_generate.py` (shebang, docstring, argparse, stdout JSON).

```python
#!/usr/bin/env python3
"""
字体管理器 — 自动下载和管理字体文件
供 caption_generate.py 和 poster_render.py 共同使用。

用法:
    # 获取字体路径（自动下载如果不存在）
    python3 font_manager.py --font source-han-sans --weight regular

    # 列出所有字体及状态
    python3 font_manager.py --list

    # 作为模块导入
    from font_manager import get_font_path
    path = get_font_path("source-han-sans", "regular")
"""

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

FONTS_DIR = Path.home() / ".autoviral" / "fonts"

# ── 字体注册表 ──────────────────────────────────────────────────────

FONT_REGISTRY = {
    "source-han-sans": {
        "family": "Source Han Sans SC",
        "weights": {
            "regular": {
                "filename": "NotoSansCJKsc-Regular.otf",
                "url": "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
            },
            "bold": {
                "filename": "NotoSansCJKsc-Bold.otf",
                "url": "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf",
            },
            "light": {
                "filename": "NotoSansCJKsc-Light.otf",
                "url": "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Light.otf",
            },
            "heavy": {
                "filename": "NotoSansCJKsc-Black.otf",
                "url": "https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Black.otf",
            },
        },
    },
    "source-han-serif": {
        "family": "Source Han Serif SC",
        "weights": {
            "regular": {
                "filename": "NotoSerifCJKsc-Regular.otf",
                "url": "https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf",
            },
            "bold": {
                "filename": "NotoSerifCJKsc-Bold.otf",
                "url": "https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf",
            },
            "light": {
                "filename": "NotoSerifCJKsc-Light.otf",
                "url": "https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Light.otf",
            },
        },
    },
    "lxgw-wenkai": {
        "family": "LXGW WenKai",
        "weights": {
            "regular": {
                "filename": "LXGWWenKai-Regular.ttf",
                "url": "https://github.com/lxgw/LxgwWenKai/releases/download/v1.501/LXGWWenKai-Regular.ttf",
            },
            "bold": {
                "filename": "LXGWWenKai-Bold.ttf",
                "url": "https://github.com/lxgw/LxgwWenKai/releases/download/v1.501/LXGWWenKai-Bold.ttf",
            },
            "light": {
                "filename": "LXGWWenKai-Light.ttf",
                "url": "https://github.com/lxgw/LxgwWenKai/releases/download/v1.501/LXGWWenKai-Light.ttf",
            },
        },
    },
    "smiley-sans": {
        "family": "Smiley Sans",
        "weights": {
            "regular": {
                "filename": "SmileySans-Oblique.ttf",
                "url": "https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/SmileySans-Oblique.ttf",
            },
        },
    },
    "montserrat": {
        "family": "Montserrat",
        "weights": {
            "regular": {
                "filename": "Montserrat-Regular.ttf",
                "url": "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Regular.ttf",
            },
            "bold": {
                "filename": "Montserrat-Bold.ttf",
                "url": "https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-Bold.ttf",
            },
        },
    },
    "inter": {
        "family": "Inter",
        "weights": {
            "regular": {
                "filename": "Inter-Regular.ttf",
                "url": "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.ttf",
            },
            "bold": {
                "filename": "Inter-Bold.ttf",
                "url": "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Bold.ttf",
            },
        },
    },
}


def ensure_fonts_dir():
    """Create fonts directory if it doesn't exist."""
    FONTS_DIR.mkdir(parents=True, exist_ok=True)


def download_font(url: str, dest: Path) -> bool:
    """Download a font file from URL to dest path."""
    try:
        print(f"[*] 下载字体: {dest.name} ...", file=sys.stderr)
        urllib.request.urlretrieve(url, str(dest))
        print(f"[✓] 已下载: {dest}", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[✗] 下载失败: {e}", file=sys.stderr)
        return False


def get_font_path(font_id: str, weight: str = "regular") -> str | None:
    """Get the absolute path to a font file, downloading if necessary.

    Args:
        font_id: Font identifier (e.g., 'source-han-sans', 'lxgw-wenkai')
        weight: Font weight ('regular', 'bold', 'light', 'heavy')

    Returns:
        Absolute path to font file, or None if unavailable
    """
    if font_id not in FONT_REGISTRY:
        return None

    font_info = FONT_REGISTRY[font_id]
    weights = font_info["weights"]

    if weight not in weights:
        # Fallback to regular
        weight = "regular"
    if weight not in weights:
        return None

    entry = weights[weight]
    dest = FONTS_DIR / entry["filename"]

    if not dest.exists():
        ensure_fonts_dir()
        if not download_font(entry["url"], dest):
            return None

    return str(dest)


def get_font_family(font_id: str) -> str | None:
    """Get the CSS font-family name for a font."""
    if font_id not in FONT_REGISTRY:
        return None
    return FONT_REGISTRY[font_id]["family"]


def list_fonts() -> list[dict]:
    """List all available fonts and their download status."""
    result = []
    for font_id, info in FONT_REGISTRY.items():
        for weight, entry in info["weights"].items():
            dest = FONTS_DIR / entry["filename"]
            result.append({
                "id": font_id,
                "family": info["family"],
                "weight": weight,
                "filename": entry["filename"],
                "installed": dest.exists(),
                "path": str(dest) if dest.exists() else None,
            })
    return result


def main():
    parser = argparse.ArgumentParser(description="字体管理器")
    parser.add_argument("--font", help="字体 ID")
    parser.add_argument("--weight", default="regular", help="字重 (regular/bold/light/heavy)")
    parser.add_argument("--list", action="store_true", help="列出所有字体")
    args = parser.parse_args()

    if args.list:
        fonts = list_fonts()
        print(json.dumps(fonts, ensure_ascii=False, indent=2))
        return

    if not args.font:
        parser.print_help()
        sys.exit(1)

    path = get_font_path(args.font, args.weight)
    if path:
        family = get_font_family(args.font)
        print(json.dumps({"path": path, "family": family}, ensure_ascii=False))
    else:
        print(json.dumps({"success": False, "error": f"字体不可用: {args.font}/{args.weight}"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test font_manager.py**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
python3 skills/asset-generation/scripts/font_manager.py --list
python3 skills/asset-generation/scripts/font_manager.py --font source-han-sans --weight regular
# Should auto-download and print JSON with path
```

- [ ] **Step 3: Commit**

```bash
git add skills/asset-generation/scripts/font_manager.py
git commit -m "feat: add font_manager.py for shared font downloading and management"
```

---

### Task 2: caption_generate.py — Pro Karaoke Captions

**Files:**
- Create: `skills/content-assembly/scripts/caption_generate.py`

**Dependencies:** `pip install stable-ts` (includes whisper + torch)

- [ ] **Step 1: Create caption_generate.py**

Follow the pattern from `music_generate.py` (shebang, docstring, argparse, stdout JSON). The script must:

1. Support two modes:
   - `--input video.mp4` (auto mode): extract audio with ffmpeg, run stable-ts for word-level timestamps, generate ASS
   - `--timestamps captions.json` (manual mode): read word-level timestamps from JSON, generate ASS

2. Include 5 preset styles as Python dicts:
   - `douyin-highlight`: Source Han Sans Bold 52px, white base `&H00FFFFFF`, yellow highlight `&H0000FFFF`, black outline 3px, position center (Alignment=2, MarginV=960)
   - `douyin-bold`: Source Han Sans Heavy 64px, pure white, black outline 4px, no karaoke highlight, position center
   - `xhs-soft`: LXGW WenKai 48px, white base, light gray outline 2px, fad(200,150), position upper-center (MarginV=600)
   - `funny`: Smiley Sans 60px, yellow/red alternating, black outline 4px, `\t(\fscy120)` bounce per word, position center
   - `minimal`: Inter + Source Han Sans 44px, white with shadow only (no outline), semi-transparent `&H40000000` shadow, position bottom-center (MarginV=1200)

3. Core ASS generation logic:
   - Write `[Script Info]` with PlayResX=1080, PlayResY=1920
   - Write `[V4+ Styles]` with style config (font from font_manager.get_font_path)
   - Write `[Events]` with Dialogue lines using `\kf` karaoke tags for word-by-word highlight
   - Apply `--lead-time` (default 80ms) by shifting subtitle start times earlier
   - Group words into lines with `--max-words` (default 8) per line

4. ASS karaoke format per line:
   ```
   Dialogue: 0,0:00:00.42,0:00:02.50,Default,,0,0,0,,{\kf40}今天 {\kf40}分享 {\kf40}三个
   ```
   Where `\kf` value = word duration in centiseconds

5. Hex color conversion: user passes `#FFFF00` → convert to ASS BGR `&H0000FFFF`

6. stdout JSON output:
   ```json
   {"success": true, "output": "/abs/path.ass", "segments": 12, "words": 87, "duration_sec": 45.2, "style": "douyin-highlight", "mode": "auto"}
   ```

7. Error output:
   ```json
   {"success": false, "error": "..."}
   ```

Key implementation details:
- For auto mode, use `stable_whisper.load_model(model)` then `model.transcribe(audio_path, language=language)`
- Extract word segments via `result.segments` → each segment has `.words` with `.start`, `.end`, `.word`
- Audio extraction: `ffmpeg -i input -vn -acodec pcm_s16le -ar 16000 -ac 1 -y temp_audio.wav`
- Import `font_manager` from sibling directory: `sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "asset-generation" / "scripts"))`
- Clean up temp audio file after processing

- [ ] **Step 2: Install dependencies and test auto mode**

```bash
pip install stable-ts
# Test with any video file that has speech
python3 skills/content-assembly/scripts/caption_generate.py \
  --input /path/to/test-video.mp4 \
  --output /tmp/test-captions.ass \
  --style douyin-highlight \
  --language zh
# Verify: cat /tmp/test-captions.ass to check ASS structure
# Verify: ffmpeg -i /path/to/test-video.mp4 -vf "ass=/tmp/test-captions.ass" -t 10 -y /tmp/test-captioned.mp4
```

- [ ] **Step 3: Test timestamps mode**

Create a test JSON file and run:
```bash
cat > /tmp/test-timestamps.json << 'EOF'
{
  "segments": [
    {
      "text": "今天分享三个穿搭技巧",
      "words": [
        {"word": "今天", "start": 0.5, "end": 0.9},
        {"word": "分享", "start": 0.9, "end": 1.3},
        {"word": "三个", "start": 1.3, "end": 1.7},
        {"word": "穿搭", "start": 1.7, "end": 2.1},
        {"word": "技巧", "start": 2.1, "end": 2.5}
      ]
    }
  ]
}
EOF
python3 skills/content-assembly/scripts/caption_generate.py \
  --timestamps /tmp/test-timestamps.json \
  --output /tmp/test-manual.ass \
  --style xhs-soft
```

- [ ] **Step 4: Commit**

```bash
git add skills/content-assembly/scripts/caption_generate.py
git commit -m "feat: add caption_generate.py with karaoke word-by-word highlight subtitles"
```

---

### Task 3: poster_render.py + Templates — HTML/CSS Poster Rendering

**Files:**
- Create: `skills/asset-generation/scripts/poster_render.py`
- Create: `skills/asset-generation/templates/xhs-fresh/index.html`
- Create: `skills/asset-generation/templates/xhs-fresh/style.css`
- Create: `skills/asset-generation/templates/xhs-premium/index.html`
- Create: `skills/asset-generation/templates/xhs-premium/style.css`
- Create: `skills/asset-generation/templates/xhs-infocard/index.html`
- Create: `skills/asset-generation/templates/xhs-infocard/style.css`
- Create: `skills/asset-generation/templates/xhs-photo-title/index.html`
- Create: `skills/asset-generation/templates/xhs-photo-title/style.css`
- Create: `skills/asset-generation/templates/xhs-cover/index.html`
- Create: `skills/asset-generation/templates/xhs-cover/style.css`

**Dependencies:** `pip install playwright jinja2 && playwright install chromium`

- [ ] **Step 1: Create poster_render.py**

Follow existing script patterns. The script must:

1. Accept args: `--template`, `--data` (JSON path or inline string), `--output`, `--bg-image`, `--width` (default 1080), `--height` (default 1440), `--scale` (default 2), `--format` (png/jpeg)

2. Template resolution:
   - If `--template` is a built-in ID (e.g., `xhs-fresh`), load from `skills/asset-generation/templates/{id}/`
   - If `--template` is a file path, load that HTML directly
   - Template directory found relative to script: `Path(__file__).resolve().parent.parent / "templates"`

3. Font preparation:
   - Import `font_manager` (same as caption_generate.py)
   - For each template's required fonts, call `get_font_path()` to ensure downloaded
   - Generate `@font-face` CSS declarations with `file://` URLs to local font files

4. Jinja2 rendering:
   - Load `index.html` as Jinja2 template
   - Load `style.css` content
   - Render with data JSON + font_faces CSS + bg_image (as base64 data URL if local file)
   - Wrap in full HTML document with viewport meta tag

5. Playwright rendering:
   - Launch chromium headless
   - Set viewport to width × height with device_scale_factor = scale
   - `page.set_content(html)` then `page.wait_for_load_state("networkidle")`
   - Screenshot `.poster` element (or full page if no `.poster`)
   - Close browser

6. stdout JSON: `{"success": true, "output": "/abs/path.png", "template": "xhs-fresh", "width": 1080, "height": 1440, "size_kb": 342.5}`

- [ ] **Step 2: Create 5 HTML/CSS templates**

Each template pair (`index.html` + `style.css`) in its own subdirectory under `templates/`.

**Template design principles (ALL templates):**
- Root `.poster` element: `width: 100%; height: 100%; overflow: hidden; position: relative;`
- Padding: `48px` on all sides (safe area)
- Font sizes: title 48-60px (line-height 1.2), body 28-32px (line-height 1.6), tags 24px
- Max 3 font-size levels
- All text elements use CSS classes, no inline styles
- Tags rendered as pill-shaped spans with rounded corners
- Support `{{ bg_image }}` variable for background image injection

**xhs-fresh (小清新):**
- Background: linear-gradient `#FFF5EE` → `#F0E6DC`
- Card: white `#FFFFFF` with border-radius 24px, box-shadow, centered
- Font: LXGW WenKai for title, Inter for tags
- Accent: `{{ accent_color }}` defaulting to `#E8A87C`
- Decorative: thin top border line using accent color

**xhs-premium (高级感):**
- Background: dark `#1A1A2E`
- Layout: asymmetric — title left-aligned upper 1/3, body right-aligned lower half
- Font: Source Han Serif for title (light weight), Montserrat for English
- Accent: gold `#C9A96E` thin horizontal rule
- Minimal decorations, lots of breathing room

**xhs-infocard (信息卡片):**
- Background: solid `{{ accent_color }}` defaulting to `#4A90D9`, or white
- Layout: numbered list with large circled numbers, grid-like spacing
- Font: Source Han Sans for all text
- Each list item: left number circle + right text block
- Clean, structured, professional

**xhs-photo-title (美图叠字):**
- Background: `{{ bg_image }}` fills full frame via `background-size: cover`
- Overlay: linear-gradient from transparent top to `rgba(0,0,0,0.6)` bottom
- Title: large white text centered in lower 1/3
- Tags: small pills at bottom with semi-transparent background
- Subtitle: smaller text under title

**xhs-cover (封面标题):**
- Background: gradient using `{{ accent_color }}`
- Title: very large (72px+), centered both vertically and horizontally, Source Han Sans Bold
- Subtitle: smaller beneath title
- Minimal — just text on gradient, maybe a thin decorative line

- [ ] **Step 3: Install dependencies and test**

```bash
pip install playwright jinja2
playwright install chromium

# Test pure template
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-fresh \
  --data '{"title":"春季穿搭分享","subtitle":"5套照着穿","body":"1. 针织开衫\n2. 碎花裙","tags":["穿搭","春季"],"footer":"@test"}' \
  --output /tmp/test-fresh.png

# Test photo-title with bg image
python3 skills/asset-generation/scripts/poster_render.py \
  --template xhs-photo-title \
  --bg-image /path/to/any-image.png \
  --data '{"title":"早春穿搭灵感","subtitle":"温柔又高级","tags":["穿搭"]}' \
  --output /tmp/test-photo-title.png

# Open and visually verify
open /tmp/test-fresh.png /tmp/test-photo-title.png
```

- [ ] **Step 4: Commit**

```bash
git add skills/asset-generation/scripts/poster_render.py skills/asset-generation/templates/
git commit -m "feat: add poster_render.py with 5 Xiaohongshu HTML/CSS templates"
```

---

### Task 4: Module Docs + SKILL.md Updates

**Files:**
- Create: `skills/content-assembly/modules/pro-captions.md`
- Create: `skills/asset-generation/modules/poster-design.md`
- Modify: `skills/content-assembly/SKILL.md`
- Modify: `skills/asset-generation/SKILL.md`

- [ ] **Step 1: Create pro-captions.md module**

Write the methodology guide for agent use. Structure:
1. When to add captions (video has speech but no subtitles → must add)
2. Style selection decision tree (oral/tutorial → douyin-highlight, funny → funny, literary → xhs-soft, etc.)
3. Auto vs timestamps mode selection
4. Caption-to-scene relationship (don't obscure subjects, platform safe zones)
5. Beat-sync coordination
6. Burn-in command reference: `ffmpeg -i input.mp4 -vf "ass=subtitles.ass" -c:v libx264 -crf 18 -c:a copy output.mp4`

Include complete script invocation examples with all common parameter combinations.

- [ ] **Step 2: Create poster-design.md module**

Write the methodology guide. Structure:
1. When to use template rendering vs pure AI generation
2. Template selection guide (by content type and emotion)
3. Data construction norms (title ≤15 chars, 3-5 tags, body ≤7 items)
4. Font pairing principles
5. Color selection by vertical (beauty→pink, food→orange, tech→blue, etc.)
6. Carousel consistency (same template + accent_color across all pages)
7. AI image + text overlay workflow

Include complete script invocation examples.

- [ ] **Step 3: Update content-assembly/SKILL.md**

Add a new section after the existing assembly workflow sections:
- Document `caption_generate.py` usage, parameters table, examples
- Add `pro-captions` to the modules table
- Add `scripts/caption_generate.py` to the scripts listing

- [ ] **Step 4: Update asset-generation/SKILL.md**

Add sections for:
- `poster_render.py` usage, parameters table, examples
- `font_manager.py` usage
- Templates directory description and template list
- Add `poster-design` to the modules table
- Add to file naming conventions: `assets/posters/cover.png`, `assets/posters/page-N.png`

- [ ] **Step 5: Commit**

```bash
git add skills/content-assembly/modules/pro-captions.md \
       skills/asset-generation/modules/poster-design.md \
       skills/content-assembly/SKILL.md \
       skills/asset-generation/SKILL.md
git commit -m "docs: add pro-captions and poster-design modules, update SKILL.md files"
```
