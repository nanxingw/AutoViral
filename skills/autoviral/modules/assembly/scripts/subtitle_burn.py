#!/usr/bin/env python3
"""
字幕烧录器 — 使用 moviepy + Pillow 将字幕硬编码到视频中

支持 SRT / ASS / JSON 字幕格式，内置 5 种预设样式（含卡拉 OK 逐词高亮）。

用法:
    # 基本用法：将 SRT 字幕烧录到视频
    python3 subtitle_burn.py --video input.mp4 --subs subtitles.srt --output output.mp4

    # 使用 ASS 字幕 + 电影风格
    python3 subtitle_burn.py --video input.mp4 --subs subtitles.ass --output output.mp4 --style cinematic

    # 使用 JSON 字幕 + karaoke 逐词高亮
    python3 subtitle_burn.py --video input.mp4 --subs captions.json --output output.mp4 --style karaoke

    # 自定义字体和颜色
    python3 subtitle_burn.py --video input.mp4 --subs subtitles.srt --output output.mp4 \
        --font ~/.autoviral/fonts/NotoSansCJKsc-Bold.otf --fontsize 56 \
        --color "#FFD700" --stroke-color "#333333" --stroke-width 4 --position 0.80

字幕 JSON 格式:
    [
      {"start": 0.5, "end": 2.0, "text": "今天分享三个技巧"},
      {"start": 2.5, "end": 5.0, "text": "第一个是穿搭",
       "words": [
         {"start": 2.5, "end": 3.0, "word": "第一个"},
         {"start": 3.0, "end": 3.5, "word": "是"},
         {"start": 3.5, "end": 5.0, "word": "穿搭"}
       ]}
    ]

预设样式:
    modern     白色文字，黑色描边(3)，字号 48，位置 0.85（默认）
    cinematic  #F5F0E8 文字，阴影效果，字号 42，位置 0.88
    bold       白色文字，黑色描边(5)，字号 56，位置 0.82
    minimal    白色文字 + 半透明黑色背景条，字号 36，位置 0.90
    karaoke    白色文字 + 黄色逐词高亮(#FFD700)，字号 48，位置 0.85（需 JSON 含 words）
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

try:
    from moviepy import CompositeVideoClip, ImageClip, VideoFileClip
except ImportError:
    from moviepy.editor import CompositeVideoClip, ImageClip, VideoFileClip
from PIL import Image, ImageDraw, ImageFont

# ── 导入 font_manager ────────────────────────────────────────────────
# font_manager 位于兄弟 skill 目录 asset-generation/scripts/
sys.path.insert(
    0, str(Path(__file__).resolve().parent.parent.parent / "asset-generation" / "scripts")
)

FONTS_DIR = Path.home() / ".autoviral" / "fonts"
DEFAULT_FONT = FONTS_DIR / "NotoSansCJKsc-Regular.otf"

# ── 预设样式 ──────────────────────────────────────────────────────────

STYLE_PRESETS = {
    "modern": {
        "fontsize": 48,
        "color": "#FFFFFF",
        "stroke_color": "#000000",
        "stroke_width": 3,
        "position": 0.85,
        "shadow": False,
        "bg_bar": False,
        "karaoke": False,
    },
    "cinematic": {
        "fontsize": 42,
        "color": "#F5F0E8",
        "stroke_color": "#000000",
        "stroke_width": 2,
        "position": 0.88,
        "shadow": True,
        "bg_bar": False,
        "karaoke": False,
    },
    "bold": {
        "fontsize": 56,
        "color": "#FFFFFF",
        "stroke_color": "#000000",
        "stroke_width": 5,
        "position": 0.82,
        "shadow": False,
        "bg_bar": False,
        "karaoke": False,
    },
    "minimal": {
        "fontsize": 36,
        "color": "#FFFFFF",
        "stroke_color": "#000000",
        "stroke_width": 0,
        "position": 0.90,
        "shadow": False,
        "bg_bar": True,
        "karaoke": False,
    },
    "karaoke": {
        "fontsize": 48,
        "color": "#FFFFFF",
        "stroke_color": "#000000",
        "stroke_width": 3,
        "position": 0.85,
        "shadow": False,
        "bg_bar": False,
        "karaoke": True,
        "highlight_color": "#FFD700",
    },
}


# ── 字幕解析 ──────────────────────────────────────────────────────────


def parse_srt(path: str) -> list[dict]:
    """解析 SRT 字幕文件.

    Returns:
        [{"start": float, "end": float, "text": str}, ...]
    """
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    entries = []
    # Split by blank lines into blocks
    blocks = re.split(r"\n\s*\n", content.strip())

    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue

        # Parse timestamp line (line index 1)
        ts_match = re.match(
            r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*"
            r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})",
            lines[1].strip(),
        )
        if not ts_match:
            continue

        g = ts_match.groups()
        start = int(g[0]) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3]) / 1000
        end = int(g[4]) * 3600 + int(g[5]) * 60 + int(g[6]) + int(g[7]) / 1000
        text = "\n".join(lines[2:]).strip()
        # Strip HTML-like tags commonly found in SRT
        text = re.sub(r"<[^>]+>", "", text)

        entries.append({"start": start, "end": end, "text": text})

    return entries


def parse_ass(path: str) -> list[dict]:
    """解析 ASS 字幕文件，提取 Dialogue 行.

    Returns:
        [{"start": float, "end": float, "text": str}, ...]
    """
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    entries = []

    for line in content.split("\n"):
        line = line.strip()
        if not line.startswith("Dialogue:"):
            continue

        # Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
        parts = line.split(",", 9)
        if len(parts) < 10:
            continue

        start_str = parts[1].strip()
        end_str = parts[2].strip()
        text = parts[9].strip()

        # Parse ASS timestamps H:MM:SS.CC
        start = _ass_time_to_seconds(start_str)
        end = _ass_time_to_seconds(end_str)
        if start is None or end is None:
            continue

        # Strip ASS override tags like {\kf50}, {\an8}, {\pos(x,y)} etc
        text = re.sub(r"\{[^}]*\}", "", text)
        # Replace \N and \n with actual newlines
        text = text.replace("\\N", "\n").replace("\\n", "\n")
        text = text.strip()

        if text:
            entries.append({"start": start, "end": end, "text": text})

    return entries


def _ass_time_to_seconds(ts: str) -> float | None:
    """将 ASS 时间格式 H:MM:SS.CC 转为秒."""
    m = re.match(r"(\d+):(\d{2}):(\d{2})\.(\d{2})", ts)
    if not m:
        return None
    h, mi, s, cs = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    return h * 3600 + mi * 60 + s + cs / 100.0


def parse_json_subs(path: str) -> list[dict]:
    """解析 JSON 字幕文件.

    期望格式: [{start, end, text, words?}, ...]

    Returns:
        [{"start": float, "end": float, "text": str, "words"?: [...]}, ...]
    """
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    entries = []
    for item in data:
        entry = {
            "start": float(item["start"]),
            "end": float(item["end"]),
            "text": str(item["text"]),
        }
        if "words" in item and isinstance(item["words"], list):
            entry["words"] = [
                {
                    "start": float(w["start"]),
                    "end": float(w["end"]),
                    "word": str(w["word"]),
                }
                for w in item["words"]
            ]
        entries.append(entry)

    return entries


def detect_and_parse(path: str) -> list[dict]:
    """根据文件扩展名自动选择解析器.

    Returns:
        [{"start": float, "end": float, "text": str, "words"?: [...]}, ...]
    """
    ext = Path(path).suffix.lower()
    if ext == ".srt":
        return parse_srt(path)
    elif ext == ".ass":
        return parse_ass(path)
    elif ext == ".json":
        return parse_json_subs(path)
    else:
        raise ValueError(f"不支持的字幕格式: {ext}（支持 .srt / .ass / .json）")


# ── 字体管理 ──────────────────────────────────────────────────────────


def resolve_font(font_path: str | None) -> str:
    """解析字体路径，确保字体可用.

    优先级:
    1. 用户指定的路径
    2. 默认字体路径
    3. 尝试调用 font_manager.py 下载
    4. 查找 ~/.autoviral/fonts/ 下任意 .otf/.ttf 文件
    5. 报错退出（不使用系统字体）

    Returns:
        可用字体文件的绝对路径
    """
    # 1. 用户指定路径
    if font_path:
        p = Path(font_path).expanduser().resolve()
        if p.is_file():
            return str(p)
        # Try within fonts dir
        in_fonts = FONTS_DIR / p.name
        if in_fonts.is_file():
            print(f"[*] 字体未在指定路径找到，使用 {in_fonts}", file=sys.stderr)
            return str(in_fonts)

    # 2. 默认字体
    if DEFAULT_FONT.is_file():
        return str(DEFAULT_FONT)

    # 3. 尝试调用 font_manager 下载默认字体
    try:
        from font_manager import get_font_path as fm_get_font_path

        downloaded = fm_get_font_path("source-han-sans", "regular")
        if downloaded and Path(downloaded).is_file():
            print(f"[*] 已通过 font_manager 下载字体: {downloaded}", file=sys.stderr)
            return downloaded
    except Exception as e:
        print(f"[!] font_manager 调用失败: {e}", file=sys.stderr)

    # 4. 查找 fonts 目录下任意字体文件
    if FONTS_DIR.is_dir():
        for ext in ("*.otf", "*.ttf"):
            found = list(FONTS_DIR.glob(ext))
            if found:
                print(f"[*] 使用已有字体: {found[0]}", file=sys.stderr)
                return str(found[0])

    # 5. 报错 — 绝不使用系统字体
    print(
        "[ERROR] 无可用字体。请确保 ~/.autoviral/fonts/ 下有字体文件，\n"
        "        或运行 font_manager.py 下载: python3 font_manager.py --font source-han-sans",
        file=sys.stderr,
    )
    sys.exit(1)


# ── 渲染逻辑 ──────────────────────────────────────────────────────────


def hex_to_rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    """将 #RRGGBB 转为 RGBA 元组."""
    h = hex_color.lstrip("#")
    if len(h) == 6:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    elif len(h) == 8:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        alpha = int(h[6:8], 16)
    else:
        r, g, b = 255, 255, 255
    return (r, g, b, alpha)


def render_text_image(
    text: str,
    font: ImageFont.FreeTypeFont,
    color: tuple,
    stroke_color: tuple,
    stroke_width: int,
    video_width: int,
    shadow: bool = False,
    bg_bar: bool = False,
) -> Image.Image:
    """使用 Pillow 渲染单行字幕文字为 RGBA 图片.

    Args:
        text:         字幕文字
        font:         Pillow 字体对象
        color:        文字颜色 RGBA
        stroke_color: 描边颜色 RGBA
        stroke_width: 描边宽度
        video_width:  视频宽度（用于居中）
        shadow:       是否添加阴影
        bg_bar:       是否添加半透明背景条

    Returns:
        RGBA Image
    """
    # Measure text size
    dummy_img = Image.new("RGBA", (1, 1))
    dummy_draw = ImageDraw.Draw(dummy_img)
    bbox = dummy_draw.textbbox(
        (0, 0), text, font=font, stroke_width=stroke_width
    )
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Add padding
    pad_x = stroke_width + 10
    pad_y = stroke_width + 6
    if shadow:
        pad_x += 4
        pad_y += 4

    img_w = text_w + pad_x * 2
    img_h = text_h + pad_y * 2

    img = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background bar for "minimal" style
    if bg_bar:
        bar_color = (0, 0, 0, 160)  # semi-transparent black
        draw.rounded_rectangle(
            [(0, 0), (img_w, img_h)],
            radius=8,
            fill=bar_color,
        )

    # Text position within the image
    tx = pad_x - bbox[0]
    ty = pad_y - bbox[1]

    # Shadow effect for "cinematic" style
    if shadow:
        shadow_offset = 3
        shadow_color = (0, 0, 0, 180)
        draw.text(
            (tx + shadow_offset, ty + shadow_offset),
            text,
            font=font,
            fill=shadow_color,
        )

    # Draw text with stroke
    draw.text(
        (tx, ty),
        text,
        font=font,
        fill=color,
        stroke_width=stroke_width,
        stroke_fill=stroke_color if stroke_width > 0 else None,
    )

    return img


def render_karaoke_image(
    words: list[dict],
    current_time: float,
    font: ImageFont.FreeTypeFont,
    base_color: tuple,
    highlight_color: tuple,
    stroke_color: tuple,
    stroke_width: int,
    video_width: int,
) -> Image.Image:
    """渲染卡拉 OK 逐词高亮字幕为 RGBA 图片.

    当前时间对应的词以 highlight_color 显示，其余以 base_color 显示。

    Returns:
        RGBA Image
    """
    # Build full text for sizing
    full_text = "".join(w["word"] for w in words)

    dummy_img = Image.new("RGBA", (1, 1))
    dummy_draw = ImageDraw.Draw(dummy_img)
    bbox = dummy_draw.textbbox(
        (0, 0), full_text, font=font, stroke_width=stroke_width
    )
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    pad_x = stroke_width + 10
    pad_y = stroke_width + 6
    img_w = text_w + pad_x * 2
    img_h = text_h + pad_y * 2

    img = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw each word with appropriate color
    x_offset = pad_x - bbox[0]
    y_offset = pad_y - bbox[1]

    for w in words:
        word_text = w["word"]
        # Determine if this word is currently highlighted
        if w["start"] <= current_time < w["end"]:
            color = highlight_color
        elif current_time >= w["end"]:
            color = highlight_color  # already spoken words stay highlighted
        else:
            color = base_color

        # Draw word with stroke
        draw.text(
            (x_offset, y_offset),
            word_text,
            font=font,
            fill=color,
            stroke_width=stroke_width,
            stroke_fill=stroke_color if stroke_width > 0 else None,
        )

        # Advance x position
        word_bbox = draw.textbbox((0, 0), word_text, font=font, stroke_width=0)
        x_offset += word_bbox[2] - word_bbox[0]

    return img


def make_subtitle_clip(
    entry: dict,
    style_config: dict,
    font: ImageFont.FreeTypeFont,
    video_width: int,
    video_height: int,
) -> list:
    """为一条字幕创建 moviepy ImageClip(s).

    对于 karaoke 模式，按帧率生成逐词高亮帧序列。
    对于普通模式，生成一个静态字幕 clip。

    Returns:
        [ImageClip, ...] 列表
    """
    color = hex_to_rgba(style_config["color"])
    stroke_color = hex_to_rgba(style_config["stroke_color"])
    stroke_width = style_config["stroke_width"]
    position_ratio = style_config["position"]
    shadow = style_config.get("shadow", False)
    bg_bar = style_config.get("bg_bar", False)
    is_karaoke = style_config.get("karaoke", False)

    start = entry["start"]
    end = entry["end"]
    duration = end - start

    if duration <= 0:
        return []

    y_pos = int(video_height * position_ratio)

    if is_karaoke and "words" in entry:
        # Karaoke mode: generate frame-by-frame images via make_frame
        highlight_color = hex_to_rgba(style_config.get("highlight_color", "#FFD700"))
        words = entry["words"]

        def make_frame(t):
            current_time = start + t
            img = render_karaoke_image(
                words=words,
                current_time=current_time,
                font=font,
                base_color=color,
                highlight_color=highlight_color,
                stroke_color=stroke_color,
                stroke_width=stroke_width,
                video_width=video_width,
            )
            # Convert RGBA to RGB+A for moviepy
            return img

        # Use make_frame with ImageClip by generating at a fixed interval
        # For simplicity, render a base image and use it; for true karaoke,
        # we use VideoClip with make_frame
        from moviepy.video.VideoClip import VideoClip
        import numpy as np

        def frame_func(t):
            current_time = start + t
            img = render_karaoke_image(
                words=words,
                current_time=current_time,
                font=font,
                base_color=color,
                highlight_color=highlight_color,
                stroke_color=stroke_color,
                stroke_width=stroke_width,
                video_width=video_width,
            )
            # Convert PIL RGBA image to numpy array
            return np.array(img)

        clip = VideoClip(frame_func, duration=duration)
        clip = clip.set_start(start)
        # Set position: centered horizontally, at y_pos vertically
        clip = clip.set_position(("center", y_pos))

        # VideoClip with RGBA needs mask
        def mask_func(t):
            current_time = start + t
            img = render_karaoke_image(
                words=words,
                current_time=current_time,
                font=font,
                base_color=color,
                highlight_color=highlight_color,
                stroke_color=stroke_color,
                stroke_width=stroke_width,
                video_width=video_width,
            )
            alpha = np.array(img)[:, :, 3] / 255.0
            return alpha

        mask_clip = VideoClip(mask_func, ismask=True, duration=duration)
        clip = clip.set_mask(mask_clip)

        return [clip]

    else:
        # Static subtitle mode
        text = entry["text"]
        # Handle multi-line text by rendering each line
        img = render_text_image(
            text=text,
            font=font,
            color=color,
            stroke_color=stroke_color,
            stroke_width=stroke_width,
            video_width=video_width,
            shadow=shadow,
            bg_bar=bg_bar,
        )

        import numpy as np

        img_array = np.array(img)

        # Create ImageClip from RGBA
        clip = ImageClip(img_array[:, :, :3])
        # Create mask from alpha channel
        mask = ImageClip(img_array[:, :, 3] / 255.0, ismask=True)
        clip = clip.set_mask(mask)
        clip = clip.set_start(start).set_duration(duration)
        clip = clip.set_position(("center", y_pos))

        return [clip]


# ── 主流程 ────────────────────────────────────────────────────────────


def burn_subtitles(
    video_path: str,
    subs_path: str,
    output_path: str,
    font_path: str | None = None,
    fontsize: int | None = None,
    color: str | None = None,
    stroke_color: str | None = None,
    stroke_width: int | None = None,
    position: float | None = None,
    style: str = "modern",
) -> dict:
    """将字幕烧录到视频中.

    Args:
        video_path:    输入视频路径
        subs_path:     字幕文件路径 (SRT/ASS/JSON)
        output_path:   输出视频路径
        font_path:     字体文件路径
        fontsize:      字号
        color:         文字颜色
        stroke_color:  描边颜色
        stroke_width:  描边宽度
        position:      垂直位置 (0-1)
        style:         预设样式名

    Returns:
        结果字典
    """
    import numpy as np

    # 验证输入文件
    if not os.path.isfile(video_path):
        return {"success": False, "error": f"视频文件不存在: {video_path}"}
    if not os.path.isfile(subs_path):
        return {"success": False, "error": f"字幕文件不存在: {subs_path}"}

    # 验证样式
    if style not in STYLE_PRESETS:
        return {
            "success": False,
            "error": f"未知样式: {style}。可选: {', '.join(STYLE_PRESETS.keys())}",
        }

    # 构建样式配置: 预设 + 用户覆盖
    style_config = dict(STYLE_PRESETS[style])
    if fontsize is not None:
        style_config["fontsize"] = fontsize
    if color is not None:
        style_config["color"] = color
    if stroke_color is not None:
        style_config["stroke_color"] = stroke_color
    if stroke_width is not None:
        style_config["stroke_width"] = stroke_width
    if position is not None:
        style_config["position"] = position

    # 解析字幕
    print(f"[*] 解析字幕文件: {subs_path}", file=sys.stderr)
    try:
        entries = detect_and_parse(subs_path)
    except Exception as e:
        return {"success": False, "error": f"字幕解析失败: {e}"}

    if not entries:
        return {"success": False, "error": "字幕文件中未找到任何条目"}

    print(f"[*] 共 {len(entries)} 条字幕", file=sys.stderr)

    # 解析字体
    resolved_font_path = resolve_font(font_path)
    print(f"[*] 字体: {resolved_font_path}", file=sys.stderr)

    try:
        font = ImageFont.truetype(resolved_font_path, style_config["fontsize"])
    except Exception as e:
        return {"success": False, "error": f"字体加载失败: {e}"}

    # 加载视频
    print(f"[*] 加载视频: {video_path}", file=sys.stderr)
    try:
        video = VideoFileClip(video_path)
    except Exception as e:
        return {"success": False, "error": f"视频加载失败: {e}"}

    video_w, video_h = video.size
    fps = video.fps

    print(
        f"[*] 视频信息: {video_w}x{video_h}, {fps:.2f} fps, "
        f"{video.duration:.2f}s",
        file=sys.stderr,
    )

    # 为每条字幕创建 clip
    print(f"[*] 渲染字幕 ...", file=sys.stderr)
    subtitle_clips = []
    for i, entry in enumerate(entries):
        clips = make_subtitle_clip(entry, style_config, font, video_w, video_h)
        subtitle_clips.extend(clips)
        if (i + 1) % 10 == 0 or (i + 1) == len(entries):
            print(
                f"[*] 进度: {i + 1}/{len(entries)} 条字幕已渲染",
                file=sys.stderr,
            )

    if not subtitle_clips:
        return {"success": False, "error": "未生成任何字幕 clip"}

    # 合成
    print(f"[*] 合成视频 ...", file=sys.stderr)
    final = CompositeVideoClip([video] + subtitle_clips)

    # 输出
    output = Path(output_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    # Determine codec from output extension
    out_ext = output.suffix.lower()
    if out_ext in (".mp4", ".m4v"):
        codec = "libx264"
    elif out_ext == ".webm":
        codec = "libvpx"
    elif out_ext == ".avi":
        codec = "png"
    elif out_ext == ".mov":
        codec = "libx264"
    else:
        codec = "libx264"

    print(f"[*] 写入: {output} (codec={codec}, fps={fps})", file=sys.stderr)

    try:
        final.write_videofile(
            str(output),
            fps=fps,
            codec=codec,
            audio_codec="aac",
            logger="bar",
        )
    except Exception as e:
        return {"success": False, "error": f"视频写入失败: {e}"}
    finally:
        video.close()
        final.close()

    file_size_mb = output.stat().st_size / (1024 * 1024)
    print(f"[*] 完成! 文件大小: {file_size_mb:.1f} MB", file=sys.stderr)

    return {
        "success": True,
        "output": str(output),
        "subtitles_count": len(entries),
        "video_duration_sec": round(video.duration, 2),
        "style": style,
        "resolution": f"{video_w}x{video_h}",
        "file_size_mb": round(file_size_mb, 2),
    }


# ── CLI ───────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="字幕烧录器 — 使用 moviepy + Pillow 将字幕硬编码到视频中",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  python3 subtitle_burn.py --video input.mp4 --subs sub.srt --output out.mp4\n"
            "  python3 subtitle_burn.py --video input.mp4 --subs sub.ass --output out.mp4 --style cinematic\n"
            "  python3 subtitle_burn.py --video input.mp4 --subs captions.json --output out.mp4 --style karaoke\n"
        ),
    )

    # 必选参数
    parser.add_argument(
        "--video", required=True, metavar="FILE",
        help="输入视频路径",
    )
    parser.add_argument(
        "--subs", required=True, metavar="FILE",
        help="字幕文件路径 (SRT / ASS / JSON)",
    )
    parser.add_argument(
        "--output", required=True, metavar="FILE",
        help="输出视频路径",
    )

    # 样式预设
    parser.add_argument(
        "--style", default="modern",
        choices=list(STYLE_PRESETS.keys()),
        help="预设样式 (默认: modern)",
    )

    # 样式覆盖参数
    parser.add_argument(
        "--font", metavar="FILE",
        help="字体文件路径 (默认: ~/.autoviral/fonts/NotoSansCJKsc-Regular.otf)",
    )
    parser.add_argument(
        "--fontsize", type=int,
        help="字号 (默认: 由样式决定)",
    )
    parser.add_argument(
        "--color", default=None,
        help="文字颜色, 如 white 或 #FFFFFF (默认: 由样式决定)",
    )
    parser.add_argument(
        "--stroke-color", default=None,
        help="描边颜色 (默认: 由样式决定)",
    )
    parser.add_argument(
        "--stroke-width", type=int, default=None,
        help="描边宽度 (默认: 由样式决定)",
    )
    parser.add_argument(
        "--position", type=float, default=None,
        help="垂直位置, 0-1 从顶部算起 (默认: 由样式决定)",
    )

    args = parser.parse_args()

    # 处理颜色名到 hex 映射
    color_names = {
        "white": "#FFFFFF",
        "black": "#000000",
        "yellow": "#FFD700",
        "red": "#FF0000",
        "blue": "#0000FF",
        "green": "#00FF00",
    }
    color = args.color
    if color and not color.startswith("#"):
        color = color_names.get(color.lower(), color)
    stroke_color = args.stroke_color
    if stroke_color and not stroke_color.startswith("#"):
        stroke_color = color_names.get(stroke_color.lower(), stroke_color)

    result = burn_subtitles(
        video_path=args.video,
        subs_path=args.subs,
        output_path=args.output,
        font_path=args.font,
        fontsize=args.fontsize,
        color=color,
        stroke_color=stroke_color,
        stroke_width=args.stroke_width,
        position=args.position,
        style=args.style,
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
