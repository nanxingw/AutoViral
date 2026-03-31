#!/usr/bin/env python3
"""
逐词高亮字幕生成器 — 专业 karaoke 风格 ASS 字幕
支持自动语音识别（stable-ts）和外部时间戳两种模式，内置多种平台预设样式。

用法:
    # 自动模式：从视频/音频提取词级时间戳并生成 ASS 字幕
    python3 caption_generate.py --input video.mp4 --output subtitles.ass --style douyin-highlight

    # 手动模式：从 JSON 时间戳文件生成 ASS 字幕
    python3 caption_generate.py --timestamps captions.json --output subtitles.ass --style xhs-soft

    # 自定义颜色和字号
    python3 caption_generate.py --timestamps captions.json --output subtitles.ass \
        --highlight-color "#FF6699" --base-color "#FFFFFF" --font-size 56

时间戳 JSON 格式:
    {
      "segments": [
        {
          "text": "今天分享三个穿搭技巧",
          "words": [
            {"word": "今天", "start": 0.5, "end": 0.9},
            {"word": "分享", "start": 0.9, "end": 1.3}
          ]
        }
      ]
    }

预设样式:
    douyin-highlight  白底黄色逐词高亮，黑描边（默认）
    douyin-bold       大号粗体，无高亮，纯白
    xhs-soft          柔和细体，浅描边，淡入淡出
    funny             大号彩色，弹跳缩放动画
    minimal           小号无描边，半透明阴影
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# ── 导入 font_manager ────────────────────────────────────────────────
# font_manager 位于兄弟 skill 目录 asset-generation/scripts/
sys.path.insert(
    0, str(Path(__file__).resolve().parent.parent.parent / "asset-generation" / "scripts")
)
from font_manager import get_font_family, get_font_path

# ── 预设样式 ──────────────────────────────────────────────────────────

PRESET_STYLES = {
    "douyin-highlight": {
        "font_id": "source-han-sans",
        "font_weight": "bold",
        "font_size": 52,
        "base_color": "#FFFFFF",
        "highlight_color": "#FFFF00",
        "outline_color": "#000000",
        "back_color": "#80000000",
        "bold": 1,
        "italic": 0,
        "outline_width": 3,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 960,
        "margin_l": 20,
        "margin_r": 20,
        "karaoke": True,
        "effect_tags": "",
    },
    "douyin-bold": {
        "font_id": "source-han-sans",
        "font_weight": "heavy",
        "font_size": 64,
        "base_color": "#FFFFFF",
        "highlight_color": "#FFFFFF",
        "outline_color": "#000000",
        "back_color": "#80000000",
        "bold": 1,
        "italic": 0,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 960,
        "margin_l": 20,
        "margin_r": 20,
        "karaoke": False,
        "effect_tags": "",
    },
    "xhs-soft": {
        "font_id": "lxgw-wenkai",
        "font_weight": "regular",
        "font_size": 48,
        "base_color": "#FFFFFF",
        "highlight_color": "#FFFFFF",
        "outline_color": "#CCCCCC",
        "back_color": "#00000000",
        "bold": 0,
        "italic": 0,
        "outline_width": 2,
        "shadow": 0,
        "alignment": 2,
        "margin_v": 600,
        "margin_l": 20,
        "margin_r": 20,
        "karaoke": True,
        "effect_tags": "\\fad(200,150)",
    },
    "funny": {
        "font_id": "smiley-sans",
        "font_weight": "regular",
        "font_size": 60,
        "base_color": "#FFFF00",
        "highlight_color": "#FF0000",
        "outline_color": "#000000",
        "back_color": "#80000000",
        "bold": 1,
        "italic": 0,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 960,
        "margin_l": 20,
        "margin_r": 20,
        "karaoke": True,
        "effect_tags": "\\t(\\fscy120)",
    },
    "minimal": {
        "font_id": "source-han-sans",
        "font_weight": "regular",
        "font_size": 44,
        "base_color": "#FFFFFF",
        "highlight_color": "#FFFFFF",
        "outline_color": "#000000",
        "back_color": "#40000000",
        "bold": 0,
        "italic": 0,
        "outline_width": 0,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 1200,
        "margin_l": 20,
        "margin_r": 20,
        "karaoke": False,
        "effect_tags": "",
    },
}


# ── 工具函数 ──────────────────────────────────────────────────────────


def hex_to_ass_color(hex_color: str, alpha: str = "00") -> str:
    """将 #RRGGBB 或 #AARRGGBB 转为 ASS 颜色格式 &HAABBGGRR.

    Args:
        hex_color: 十六进制颜色, 如 "#FFFF00" 或 "#80FF0000"
        alpha: 默认 alpha 值 (00=不透明, FF=全透明), 仅在 hex_color 为 6 位时使用

    Returns:
        ASS 颜色字符串, 如 "&H0000FFFF"
    """
    h = hex_color.lstrip("#")
    if len(h) == 8:
        # #AARRGGBB format
        a, r, g, b = h[0:2], h[2:4], h[4:6], h[6:8]
    elif len(h) == 6:
        r, g, b = h[0:2], h[2:4], h[4:6]
        a = alpha
    else:
        # Fallback
        r, g, b, a = "FF", "FF", "FF", "00"
    return f"&H{a.upper()}{b.upper()}{g.upper()}{r.upper()}"


def seconds_to_ass_time(seconds: float) -> str:
    """将秒数转为 ASS 时间格式 H:MM:SS.CC (百分之一秒).

    Args:
        seconds: 时间, 单位秒

    Returns:
        ASS 时间字符串, 如 "0:00:01.50"
    """
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds % 1) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def duration_to_centiseconds(start: float, end: float) -> int:
    """计算持续时间, 返回百分之一秒 (centiseconds).

    Args:
        start: 起始时间 (秒)
        end:   结束时间 (秒)

    Returns:
        持续时间, 单位 centisecond, 最小为 1
    """
    cs = int(round((end - start) * 100))
    return max(cs, 1)


# ── 时间戳解析 ────────────────────────────────────────────────────────


def parse_timestamps_json(path: str) -> list[dict]:
    """从 JSON 文件解析词级时间戳.

    Returns:
        [{"word": str, "start": float, "end": float}, ...]
    """
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    words = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []):
            words.append({
                "word": w["word"].strip(),
                "start": float(w["start"]),
                "end": float(w["end"]),
            })
    return words


def extract_audio(input_path: str) -> str:
    """用 ffmpeg 从视频中提取 16kHz 单声道 WAV.

    Returns:
        临时 WAV 文件路径
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    cmd = [
        "ffmpeg", "-i", input_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        "-y", tmp.name,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 音频提取失败: {result.stderr[:500]}")
    return tmp.name


def transcribe_with_stable_ts(audio_path: str, model_name: str = "medium",
                               language: str = "zh") -> list[dict]:
    """用 stable-ts 转录音频, 返回词级时间戳.

    Returns:
        [{"word": str, "start": float, "end": float}, ...]
    """
    try:
        import stable_whisper
    except ImportError:
        raise RuntimeError(
            "stable-ts 未安装。请运行: pip install stable-ts"
        )

    print(f"[*] 加载 Whisper 模型: {model_name} ...", file=sys.stderr)
    model = stable_whisper.load_model(model_name)

    print(f"[*] 转录中 (语言={language}) ...", file=sys.stderr)
    result = model.transcribe(audio_path, language=language)

    words = []
    for segment in result.segments:
        for w in segment.words:
            words.append({
                "word": w.word.strip(),
                "start": float(w.start),
                "end": float(w.end),
            })

    print(f"[*] 识别到 {len(words)} 个词", file=sys.stderr)
    return words


# ── 分行逻辑 ──────────────────────────────────────────────────────────


def group_words_into_lines(words: list[dict], max_words: int = 8) -> list[list[dict]]:
    """将词列表按 max_words 分组为行.

    每行包含最多 max_words 个词。当检测到时间间隙 > 0.5s 时也会换行。

    Returns:
        [[{"word", "start", "end"}, ...], ...]
    """
    if not words:
        return []

    lines = []
    current_line = []

    for w in words:
        # 时间间隙检测: 如果当前行非空且与上一个词的间隙 > 0.5s, 强制换行
        if current_line and (w["start"] - current_line[-1]["end"]) >= 0.5:
            lines.append(current_line)
            current_line = []

        current_line.append(w)

        if len(current_line) >= max_words:
            lines.append(current_line)
            current_line = []

    if current_line:
        lines.append(current_line)

    return lines


def compute_lead_times(lines: list[list[dict]], lead_time_ms: int = 80) -> list[float]:
    """计算每行的提前显示时间 (秒).

    Lead time 让字幕提前出现在屏幕上, 但不改变词的 \\kf 持续时间。

    Returns:
        每行对应的显示起始时间列表 (秒)
    """
    lead_sec = lead_time_ms / 1000.0
    result = []
    for line in lines:
        if not line:
            result.append(0.0)
            continue
        original_start = line[0]["start"]
        result.append(max(0.0, original_start - lead_sec))
    return result


# ── ASS 生成 ──────────────────────────────────────────────────────────


def build_style_config(style_name: str, overrides: dict) -> dict:
    """合并预设样式与用户覆盖参数.

    Args:
        style_name: 预设样式名
        overrides:  用户传入的覆盖参数 (font, font_size, highlight_color 等)

    Returns:
        完整样式配置字典
    """
    if style_name not in PRESET_STYLES:
        raise ValueError(
            f"未知样式: {style_name}。可选: {', '.join(PRESET_STYLES.keys())}"
        )

    config = dict(PRESET_STYLES[style_name])

    # 应用用户覆盖
    if overrides.get("font"):
        config["font_id"] = overrides["font"]
    if overrides.get("font_size"):
        config["font_size"] = overrides["font_size"]
    if overrides.get("highlight_color"):
        config["highlight_color"] = overrides["highlight_color"]
    if overrides.get("base_color"):
        config["base_color"] = overrides["base_color"]
    if overrides.get("stroke_width") is not None:
        config["outline_width"] = overrides["stroke_width"]
    if overrides.get("position"):
        pos = overrides["position"]
        if pos == "top":
            config["margin_v"] = 400
        elif pos == "center":
            config["margin_v"] = 960
        elif pos == "bottom":
            config["margin_v"] = 1200

    return config


def build_ass(lines: list[list[dict]], config: dict,
              line_starts: list[float] | None = None) -> str:
    """生成完整的 ASS 字幕文件内容.

    Args:
        lines:       分行后的词列表
        config:      样式配置字典
        line_starts: 每行的显示起始时间 (含 lead time), None 则使用第一个词的 start

    Returns:
        ASS 文件内容字符串
    """
    # 获取字体 family 名称
    font_family = get_font_family(config["font_id"])
    if not font_family:
        font_family = "Sans"

    # 确保字体已下载 (触发 font_manager 下载)
    font_path = get_font_path(config["font_id"], config["font_weight"])
    if font_path:
        print(f"[*] 字体: {font_family} ({font_path})", file=sys.stderr)
    else:
        print(f"[!] 字体下载失败, 使用系统默认: {font_family}", file=sys.stderr)

    # ASS 颜色
    primary_color = hex_to_ass_color(config["base_color"])
    secondary_color = hex_to_ass_color(config["highlight_color"])
    outline_color = hex_to_ass_color(config["outline_color"])
    back_color = hex_to_ass_color(config["back_color"])

    # ── Script Info ──
    ass = []
    ass.append("[Script Info]")
    ass.append("ScriptType: v4.00+")
    ass.append("PlayResX: 1080")
    ass.append("PlayResY: 1920")
    ass.append("WrapStyle: 0")
    ass.append("ScaledBorderAndShadow: yes")
    ass.append("Title: AutoViral Pro Captions")
    ass.append("")

    # ── V4+ Styles ──
    # Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,
    #         BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY,
    #         Spacing, Angle, BorderStyle, Outline, Shadow, Alignment,
    #         MarginL, MarginR, MarginV, Encoding
    ass.append("[V4+ Styles]")
    ass.append(
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding"
    )
    style_line = (
        f"Style: Default,{font_family},{config['font_size']},"
        f"{primary_color},{secondary_color},{outline_color},{back_color},"
        f"{config['bold']},{config['italic']},0,0,"
        f"100,100,0,0,"
        f"1,{config['outline_width']},{config['shadow']},{config['alignment']},"
        f"{config['margin_l']},{config['margin_r']},{config['margin_v']},1"
    )
    ass.append(style_line)
    ass.append("")

    # ── Events ──
    ass.append("[Events]")
    ass.append(
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    )

    for line_idx, line_words in enumerate(lines):
        if not line_words:
            continue

        # 行显示起始: 使用 lead time 调整后的值, 或原始第一个词的 start
        if line_starts and line_idx < len(line_starts):
            line_start = line_starts[line_idx]
        else:
            line_start = line_words[0]["start"]
        line_end = line_words[-1]["end"]

        start_str = seconds_to_ass_time(line_start)
        end_str = seconds_to_ass_time(line_end)

        # 构建 karaoke 文本
        text_parts = []

        # 添加全局效果标签
        if config["effect_tags"]:
            text_parts.append("{" + config["effect_tags"] + "}")

        if config["karaoke"]:
            # 逐词 karaoke 模式: 每个词前加 \kf 标签
            # \kf 值从行显示起始时间开始累计, 第一个词包含 lead time 间隙
            for i, w in enumerate(line_words):
                if i == 0:
                    # 第一个词: 从行显示起始到词结束
                    kf_val = duration_to_centiseconds(line_start, w["end"])
                else:
                    kf_val = duration_to_centiseconds(w["start"], w["end"])
                text_parts.append("{\\kf" + str(kf_val) + "}" + w["word"])
        else:
            # 非 karaoke 模式: 直接拼接文本
            text_parts.append("".join(w["word"] for w in line_words))

        text = "".join(text_parts)

        dialogue = (
            f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{text}"
        )
        ass.append(dialogue)

    ass.append("")
    return "\n".join(ass)


# ── 主流程 ────────────────────────────────────────────────────────────


def generate_captions(
    input_path: str | None = None,
    timestamps_path: str | None = None,
    output_path: str = "subtitles.ass",
    style: str = "douyin-highlight",
    language: str = "zh",
    model: str = "medium",
    max_words: int = 8,
    lead_time: int = 80,
    **kwargs,
) -> dict:
    """生成逐词高亮 ASS 字幕文件.

    Args:
        input_path:      视频/音频路径 (auto 模式)
        timestamps_path: 时间戳 JSON 路径 (手动模式)
        output_path:     输出 ASS 文件路径
        style:           预设样式名
        language:        语言代码 (auto 模式)
        model:           Whisper 模型名 (auto 模式)
        max_words:       每行最大词数
        lead_time:       字幕提前出现毫秒数
        **kwargs:        样式覆盖参数

    Returns:
        结果字典 (stdout JSON)
    """
    mode = "auto" if input_path else "timestamps"
    temp_audio = None

    try:
        # 1. 获取词级时间戳
        if input_path:
            # Auto 模式: 提取音频 → stable-ts 识别
            if not os.path.isfile(input_path):
                return {"success": False, "error": f"输入文件不存在: {input_path}"}

            print("[*] 提取音频 ...", file=sys.stderr)
            temp_audio = extract_audio(input_path)

            words = transcribe_with_stable_ts(temp_audio, model, language)
        elif timestamps_path:
            # Timestamps 模式: 从 JSON 读取
            if not os.path.isfile(timestamps_path):
                return {"success": False, "error": f"时间戳文件不存在: {timestamps_path}"}
            words = parse_timestamps_json(timestamps_path)
        else:
            return {"success": False, "error": "需要 --input 或 --timestamps 参数"}

        if not words:
            return {"success": False, "error": "未检测到任何词"}

        # 2. 分行
        lines = group_words_into_lines(words, max_words)

        # 3. 计算 lead time (不修改词时间戳, 只调整行显示起始)
        line_starts = compute_lead_times(lines, lead_time)

        # 4. 构建样式配置
        config = build_style_config(style, kwargs)

        # 5. 生成 ASS
        ass_content = build_ass(lines, config, line_starts)

        # 6. 写入文件
        output = Path(output_path).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(ass_content, encoding="utf-8")

        # 7. 统计
        total_words = sum(len(line) for line in lines)
        duration = words[-1]["end"] - words[0]["start"] if words else 0.0

        result = {
            "success": True,
            "output": str(output),
            "segments": len(lines),
            "words": total_words,
            "duration_sec": round(duration, 2),
            "style": style,
            "mode": mode,
        }
        if mode == "auto":
            result["model"] = model

        return result

    finally:
        # 清理临时音频文件
        if temp_audio and os.path.exists(temp_audio):
            try:
                os.unlink(temp_audio)
            except OSError:
                pass


# ── CLI ───────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="逐词高亮字幕生成器 — 专业 karaoke 风格 ASS 字幕"
    )

    # 输入模式 (二选一)
    input_group = parser.add_mutually_exclusive_group()
    input_group.add_argument(
        "--input", metavar="FILE",
        help="视频/音频路径 (auto 模式: ffmpeg 提取 + stable-ts 识别)",
    )
    input_group.add_argument(
        "--timestamps", metavar="JSON",
        help="词级时间戳 JSON 文件路径 (手动模式)",
    )

    # 输出
    parser.add_argument(
        "--output", required=True, metavar="FILE",
        help="输出 ASS 文件路径",
    )

    # 样式
    parser.add_argument(
        "--style", default="douyin-highlight",
        choices=list(PRESET_STYLES.keys()),
        help="预设样式 (默认: douyin-highlight)",
    )

    # Auto 模式参数
    parser.add_argument("--language", default="zh", help="语言代码 (默认: zh)")
    parser.add_argument("--model", default="medium", help="Whisper 模型 (默认: medium)")

    # 样式覆盖
    parser.add_argument("--font", help="字体 ID (覆盖预设)")
    parser.add_argument("--font-size", type=int, help="字号 (覆盖预设)")
    parser.add_argument("--highlight-color", help="高亮颜色, 如 #FFFF00 (覆盖预设)")
    parser.add_argument("--base-color", help="基础颜色, 如 #FFFFFF (覆盖预设)")
    parser.add_argument("--stroke-width", type=int, help="描边宽度 (覆盖预设)")
    parser.add_argument(
        "--position", choices=["center", "top", "bottom"],
        help="字幕位置 (覆盖预设)",
    )

    # 行为参数
    parser.add_argument("--max-words", type=int, default=8, help="每行最大词数 (默认: 8)")
    parser.add_argument("--lead-time", type=int, default=80, help="字幕提前出现毫秒数 (默认: 80)")

    args = parser.parse_args()

    if not args.input and not args.timestamps:
        parser.error("需要 --input 或 --timestamps 参数")

    # 收集样式覆盖参数
    overrides = {}
    if args.font:
        overrides["font"] = args.font
    if args.font_size:
        overrides["font_size"] = args.font_size
    if args.highlight_color:
        overrides["highlight_color"] = args.highlight_color
    if args.base_color:
        overrides["base_color"] = args.base_color
    if args.stroke_width is not None:
        overrides["stroke_width"] = args.stroke_width
    if args.position:
        overrides["position"] = args.position

    result = generate_captions(
        input_path=args.input,
        timestamps_path=args.timestamps,
        output_path=args.output,
        style=args.style,
        language=args.language,
        model=args.model,
        max_words=args.max_words,
        lead_time=args.lead_time,
        **overrides,
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
