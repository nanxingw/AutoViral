#!/usr/bin/env python3
"""
图文排版渲染器 — HTML/CSS 模板驱动的小红书图文生成
使用 Jinja2 模板 + Playwright 浏览器截图，生成专业级图文排版。

内置模板:
  - xhs-fresh     小清新：柔和渐变、圆角卡片、大量留白
  - xhs-premium   高级感：深色调、不对称布局、细线条
  - xhs-infocard  信息卡片：编号列表、网格布局
  - xhs-photo-title 美图叠字：背景图 + 半透明遮罩 + 大标题
  - xhs-cover     封面标题：居中大字 + 渐变底色

用法:
    # 纯模板生成
    python3 poster_render.py \\
      --template xhs-fresh \\
      --data '{"title":"春季穿搭","subtitle":"5套照着穿","body":"...","tags":["穿搭"]}' \\
      --output poster.png

    # AI 图 + 文字叠加
    python3 poster_render.py \\
      --template xhs-photo-title \\
      --bg-image ai_photo.png \\
      --data '{"title":"早春穿搭灵感","tags":["穿搭"]}' \\
      --output cover.png

    # 自定义模板
    python3 poster_render.py \\
      --template /path/to/custom/index.html \\
      --data data.json \\
      --output output.png
"""

import argparse
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path

# ── 路径设置 ────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = SCRIPT_DIR.parent / "templates"

# 导入 font_manager
sys.path.insert(0, str(SCRIPT_DIR))
from font_manager import get_font_path, get_font_family, FONT_REGISTRY

# ── 模板字体映射 ────────────────────────────────────────────────────

TEMPLATE_FONTS = {
    "xhs-fresh": [
        ("lxgw-wenkai", "regular"),
        ("lxgw-wenkai", "bold"),
        ("inter", "regular"),
        ("inter", "bold"),
    ],
    "xhs-premium": [
        ("source-han-serif", "light"),
        ("source-han-serif", "regular"),
        ("source-han-serif", "bold"),
        ("montserrat", "regular"),
        ("montserrat", "bold"),
    ],
    "xhs-infocard": [
        ("source-han-sans", "regular"),
        ("source-han-sans", "bold"),
        ("source-han-sans", "heavy"),
    ],
    "xhs-photo-title": [
        ("source-han-sans", "bold"),
        ("source-han-sans", "heavy"),
        ("montserrat", "regular"),
        ("montserrat", "bold"),
    ],
    "xhs-cover": [
        ("source-han-sans", "bold"),
        ("source-han-sans", "heavy"),
        ("source-han-sans", "regular"),
    ],
}

# ── 内置模板列表 ────────────────────────────────────────────────────

BUILTIN_TEMPLATES = list(TEMPLATE_FONTS.keys())


def is_builtin_template(template_id: str) -> bool:
    """Check if template_id is a built-in template."""
    return template_id in BUILTIN_TEMPLATES


def get_template_dir(template_id: str) -> Path:
    """Get the directory for a built-in template."""
    return TEMPLATES_DIR / template_id


# ── 字体处理 ────────────────────────────────────────────────────────

def font_to_base64_url(font_path: str) -> str:
    """Convert a local font file to a base64 data URL."""
    path = Path(font_path)
    mime = mimetypes.guess_type(str(path))[0]
    if mime is None:
        ext = path.suffix.lower()
        mime = {
            ".ttf": "font/ttf",
            ".otf": "font/otf",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
        }.get(ext, "font/ttf")
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{data}"


def css_font_weight(weight: str) -> str:
    """Map weight string to CSS font-weight value."""
    return {
        "light": "300",
        "regular": "400",
        "bold": "700",
        "heavy": "900",
    }.get(weight, "400")


def prepare_font_faces(template_id: str) -> str:
    """Download required fonts and generate @font-face CSS declarations.

    Uses file:// URLs for Playwright local rendering.
    """
    font_specs = TEMPLATE_FONTS.get(template_id, [])
    if not font_specs:
        return ""

    declarations = []
    for font_id, weight in font_specs:
        font_path = get_font_path(font_id, weight)
        if not font_path:
            print(f"[!] 字体不可用，跳过: {font_id}/{weight}", file=sys.stderr)
            continue

        family = get_font_family(font_id)
        css_weight = css_font_weight(weight)
        # Use file:// URL for Playwright local rendering
        file_url = Path(font_path).as_uri()

        declarations.append(f"""@font-face {{
  font-family: '{family}';
  src: url('{file_url}') format('{"opentype" if font_path.endswith(".otf") else "truetype"}');
  font-weight: {css_weight};
  font-style: normal;
  font-display: block;
}}""")

    return "\n\n".join(declarations)


# ── 图片处理 ────────────────────────────────────────────────────────

def image_to_data_url(image_path: str) -> str:
    """Convert a local image file to a base64 data URL."""
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"图片文件不存在: {image_path}")

    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{data}"


# ── 模板渲染 ────────────────────────────────────────────────────────

def load_and_render_template(
    template: str,
    data: dict,
    font_faces: str,
    bg_image: str | None = None,
    width: int = 1080,
    height: int = 1440,
) -> str:
    """Load template, render with Jinja2, and return full HTML string."""
    from jinja2 import Template

    if is_builtin_template(template):
        template_dir = get_template_dir(template)
        html_path = template_dir / "index.html"
        css_path = template_dir / "style.css"

        if not html_path.exists():
            raise FileNotFoundError(f"模板文件不存在: {html_path}")

        html_raw = html_path.read_text(encoding="utf-8")
        css_raw = css_path.read_text(encoding="utf-8") if css_path.exists() else ""
    else:
        # Custom HTML path
        custom_path = Path(template)
        if not custom_path.exists():
            raise FileNotFoundError(f"自定义模板不存在: {template}")

        html_raw = custom_path.read_text(encoding="utf-8")
        css_path = custom_path.parent / "style.css"
        css_raw = css_path.read_text(encoding="utf-8") if css_path.exists() else ""

    # Process bg_image: convert local file to data URL
    bg_image_url = ""
    if bg_image:
        if bg_image.startswith(("http://", "https://", "data:")):
            bg_image_url = bg_image
        else:
            bg_image_url = image_to_data_url(bg_image)
    # Also check --bg-image passed via data
    if not bg_image_url and data.get("bg_image"):
        bi = data["bg_image"]
        if bi.startswith(("http://", "https://", "data:")):
            bg_image_url = bi
        elif Path(bi).exists():
            bg_image_url = image_to_data_url(bi)

    # Prepare Jinja2 context
    context = {
        **data,
        "font_faces": font_faces,
        "bg_image": bg_image_url,
        "width": width,
        "height": height,
    }

    # Render the HTML with Jinja2
    jinja_template = Template(html_raw)
    rendered_body = jinja_template.render(**context)

    # Build full HTML document
    full_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
/* ── Font Faces ── */
{font_faces}

/* ── Reset ── */
*, *::before, *::after {{
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}}
html, body {{
  width: {width}px;
  height: {height}px;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}}

/* ── Template Styles ── */
{css_raw}
</style>
</head>
<body>
{rendered_body}
</body>
</html>"""

    return full_html


# ── Playwright 截图 ─────────────────────────────────────────────────

def render_with_playwright(
    html: str,
    output_path: str,
    width: int = 1080,
    height: int = 1440,
    scale: float = 2,
    fmt: str = "png",
) -> dict:
    """Render HTML with Playwright and screenshot the .poster element."""
    from playwright.sync_api import sync_playwright

    output = Path(output_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            viewport={"width": width, "height": height},
            device_scale_factor=scale,
        )

        page.set_content(html)
        page.wait_for_load_state("networkidle")

        # Try to screenshot .poster element, fall back to full page
        poster = page.locator(".poster")
        if poster.count() > 0:
            poster.first.screenshot(path=str(output), type=fmt)
        else:
            page.screenshot(path=str(output), type=fmt)

        browser.close()

    size_kb = round(output.stat().st_size / 1024, 1)
    return {
        "output": str(output),
        "size_kb": size_kb,
    }


# ── 数据加载 ────────────────────────────────────────────────────────

def load_data(data_str: str) -> dict:
    """Load data from JSON file path or inline JSON string."""
    # Try as file path first
    data_path = Path(data_str)
    if data_path.exists() and data_path.is_file():
        with open(data_path, "r", encoding="utf-8") as f:
            return json.load(f)

    # Try as inline JSON
    try:
        return json.loads(data_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"无法解析数据: 既非有效文件路径，也非有效 JSON 字符串。错误: {e}")


# ── 主函数 ──────────────────────────────────────────────────────────

def render_poster(
    template: str,
    data: dict,
    output_path: str,
    bg_image: str | None = None,
    width: int = 1080,
    height: int = 1440,
    scale: float = 2,
    fmt: str = "png",
) -> dict:
    """High-level render function: template → HTML → Playwright → PNG.

    Returns result dict for stdout JSON output.
    """
    # 1. Prepare fonts
    template_id = template if is_builtin_template(template) else None
    font_faces = prepare_font_faces(template_id) if template_id else ""

    # 2. Render HTML
    html = load_and_render_template(
        template=template,
        data=data,
        font_faces=font_faces,
        bg_image=bg_image,
        width=width,
        height=height,
    )

    # 3. Playwright screenshot
    result = render_with_playwright(
        html=html,
        output_path=output_path,
        width=width,
        height=height,
        scale=scale,
        fmt=fmt,
    )

    return {
        "success": True,
        "output": result["output"],
        "template": template_id or template,
        "width": width,
        "height": height,
        "size_kb": result["size_kb"],
    }


def main():
    parser = argparse.ArgumentParser(
        description="图文排版渲染器 — HTML/CSS 模板驱动的小红书图文生成"
    )
    parser.add_argument(
        "--template", required=True,
        help=f"内置模板 ID ({', '.join(BUILTIN_TEMPLATES)}) 或自定义 HTML 路径",
    )
    parser.add_argument(
        "--data", required=True,
        help="数据 JSON 文件路径或 inline JSON 字符串",
    )
    parser.add_argument(
        "--output", required=True,
        help="输出图片路径",
    )
    parser.add_argument(
        "--bg-image",
        help="背景图路径（用于 xhs-photo-title 等模板）",
    )
    parser.add_argument(
        "--width", type=int, default=1080,
        help="输出宽度 px (默认 1080)",
    )
    parser.add_argument(
        "--height", type=int, default=1440,
        help="输出高度 px (默认 1440)",
    )
    parser.add_argument(
        "--scale", type=float, default=2,
        help="渲染倍率 (默认 2，即 Retina)",
    )
    parser.add_argument(
        "--format", dest="fmt", choices=["png", "jpeg"], default="png",
        help="输出格式 (默认 png)",
    )
    args = parser.parse_args()

    try:
        data = load_data(args.data)
        result = render_poster(
            template=args.template,
            data=data,
            output_path=args.output,
            bg_image=args.bg_image,
            width=args.width,
            height=args.height,
            scale=args.scale,
            fmt=args.fmt,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        error_result = {"success": False, "error": str(e)}
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
