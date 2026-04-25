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
