#!/usr/bin/env python3
"""
OpenRouter 图片生成工具（主力生图工具）
通过 OpenRouter API 调用 Gemini 等模型生成高质量图片。

支持模型:
  - google/gemini-3.1-flash-image-preview (推荐，最强画质，支持 4K/扩展比例)
  - google/gemini-2.5-flash-image (备用，性价比高)
  - black-forest-labs/flux.2-pro (Flux 系列)

用法:
    # 基础生图
    python3 openrouter_generate.py --prompt "一只可爱的猫咪" --output cat.png

    # 指定宽高比 + 分辨率
    python3 openrouter_generate.py --prompt "..." --aspect-ratio 3:4 --image-size 2K --output result.png

    # 4K 超高清
    python3 openrouter_generate.py --prompt "..." --image-size 4K --output hd.png

    # 指定 seed 保持一致性
    python3 openrouter_generate.py --prompt "..." --seed 42 --output consistent.png

    # 附带参考图（图生图 / 编辑）
    python3 openrouter_generate.py --prompt "把背景换成海边" --ref-image input.png --output edited.png

    # 多图输入（多张参考图）
    python3 openrouter_generate.py --prompt "合并这两张图的风格" --ref-image a.png --ref-image b.png --output merged.png

    # 使用 Gemini 2.5 Flash
    python3 openrouter_generate.py --prompt "..." --model google/gemini-2.5-flash-image --output result.png

环境变量（从 .env 读取）:
    OPENROUTER_API_KEY  OpenRouter API 密钥
"""

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

import requests

# ── 配置 ──────────────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/gemini-3.1-flash-image-preview"

# 宽高比 → 像素映射（1K 基准）
ASPECT_RATIO_PIXELS = {
    "1:1": (1024, 1024),
    "2:3": (832, 1248),
    "3:2": (1248, 832),
    "3:4": (864, 1184),
    "4:3": (1184, 864),
    "4:5": (896, 1152),
    "5:4": (1152, 896),
    "9:16": (768, 1344),
    "16:9": (1344, 768),
    "21:9": (1536, 672),
    # 扩展比例 (仅 gemini-3.1-flash-image-preview)
    "1:4": None,
    "4:1": None,
    "1:8": None,
    "8:1": None,
}

VALID_IMAGE_SIZES = {"0.5K", "1K", "2K", "4K"}

# 模型能力映射
MODEL_FEATURES = {
    "google/gemini-3.1-flash-image-preview": {
        "extended_ratios": True,
        "half_k": True,
        "max_size": "4K",
        "reasoning": True,
    },
    "google/gemini-2.5-flash-image": {
        "extended_ratios": False,
        "half_k": False,
        "max_size": "4K",
        "reasoning": False,
    },
}


# ── .env 读取 ────────────────────────────────────────────────────────


def load_env() -> dict[str, str]:
    current = Path(__file__).resolve().parent
    for _ in range(10):
        candidate = current / ".env"
        if candidate.exists():
            env_vars = {}
            with open(candidate) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, value = line.partition("=")
                        env_vars[key.strip()] = value.strip()
            return env_vars
        current = current.parent
    return {}


def get_api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        env_vars = load_env()
        key = env_vars.get("OPENROUTER_API_KEY", "")
    if not key:
        print("[错误] 未配置 OPENROUTER_API_KEY", file=sys.stderr)
        sys.exit(1)
    return key


# ── 图片提取 ─────────────────────────────────────────────────────────


def extract_image_data(data: dict) -> list[tuple[bytes, str]]:
    """从 OpenRouter 响应中提取所有图片数据，返回 [(bytes, ext), ...]"""
    message = data.get("choices", [{}])[0].get("message", {})
    content = message.get("content")
    images = message.get("images")
    results = []

    b64_pattern = re.compile(r"data:(image/[^;]+);base64,(.+)", re.DOTALL)

    # 方式1: message.images[]
    if isinstance(images, list):
        for img in images:
            url = (img.get("image_url") or {}).get("url") or img.get("url", "")
            if url:
                m = b64_pattern.match(url)
                if m:
                    results.append((base64.b64decode(m.group(2)), m.group(1).split("/")[1]))
                    continue
            source = img.get("source", {})
            if source.get("data"):
                ext = (source.get("media_type") or "image/png").split("/")[1]
                results.append((base64.b64decode(source["data"]), ext))

    if results:
        return results

    # 方式2: content 是字符串
    if isinstance(content, str):
        m = b64_pattern.search(content)
        if m:
            return [(base64.b64decode(m.group(2)), m.group(1).split("/")[1])]

    # 方式3: content 是数组
    if isinstance(content, list):
        for part in content:
            if part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url", "")
                m = b64_pattern.match(url)
                if m:
                    results.append((base64.b64decode(m.group(2)), m.group(1).split("/")[1]))
            elif part.get("type") == "image":
                source = part.get("source", {})
                if source.get("data"):
                    ext = (source.get("media_type") or "image/png").split("/")[1]
                    results.append((base64.b64decode(source["data"]), ext))
            elif part.get("type") == "text" and isinstance(part.get("text"), str):
                m = b64_pattern.search(part["text"])
                if m:
                    results.append((base64.b64decode(m.group(2)), m.group(1).split("/")[1]))

    return results


def extract_text_content(data: dict) -> str:
    """提取响应中的文本内容"""
    message = data.get("choices", [{}])[0].get("message", {})
    content = message.get("content")
    if isinstance(content, str):
        # 去除 base64 图片数据
        return re.sub(r"data:image/[^;]+;base64,[A-Za-z0-9+/=]+", "[image]", content).strip()
    if isinstance(content, list):
        texts = []
        for part in content:
            if part.get("type") == "text":
                texts.append(part.get("text", ""))
        return "\n".join(texts).strip()
    return ""


# ── 图片生成 ─────────────────────────────────────────────────────────


def generate_image(
    api_key: str,
    prompt: str,
    output_path: str,
    model: str = DEFAULT_MODEL,
    aspect_ratio: str | None = None,
    image_size: str | None = None,
    seed: int | None = None,
    ref_images: list[str] | None = None,
    temperature: float | None = None,
) -> dict:
    """调用 OpenRouter 生成图片

    Args:
        api_key: OpenRouter API key
        prompt: 图片描述/指令
        output_path: 输出文件路径
        model: 模型 ID
        aspect_ratio: 宽高比 (1:1, 3:4, 9:16, 16:9, 4K 等)
        image_size: 分辨率等级 (0.5K, 1K, 2K, 4K)
        seed: 随机种子（用于可重复生成）
        ref_images: 参考图片路径列表（用于图生图/编辑）
        temperature: 生成温度 (0.0-2.0)
    """
    print(f"[*] 模型: {model}", file=sys.stderr)
    if aspect_ratio:
        print(f"[*] 宽高比: {aspect_ratio}", file=sys.stderr)
    if image_size:
        print(f"[*] 分辨率: {image_size}", file=sys.stderr)
    if seed is not None:
        print(f"[*] Seed: {seed}", file=sys.stderr)

    # 构建消息内容
    content_parts: list[dict] = []

    # 添加参考图片
    if ref_images:
        for ref_path in ref_images:
            if ref_path.startswith(("http://", "https://")):
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": ref_path},
                })
                print(f"[*] 参考图(URL): {ref_path[:80]}", file=sys.stderr)
            else:
                p = Path(ref_path)
                if p.exists():
                    b64 = base64.b64encode(p.read_bytes()).decode()
                    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    })
                    print(f"[*] 参考图(本地): {ref_path}", file=sys.stderr)
                else:
                    print(f"[警告] 参考图不存在: {ref_path}", file=sys.stderr)

    # 添加文本 prompt
    content_parts.append({"type": "text", "text": prompt})

    # 构建请求体
    payload: dict = {
        "model": model,
        "modalities": ["text", "image"],
        "messages": [{"role": "user", "content": content_parts}],
    }

    # image_config
    image_config: dict = {}
    if aspect_ratio:
        if aspect_ratio not in ASPECT_RATIO_PIXELS:
            print(f"[警告] 非标准宽高比 {aspect_ratio}，尝试发送", file=sys.stderr)
        image_config["aspect_ratio"] = aspect_ratio
    if image_size:
        if image_size not in VALID_IMAGE_SIZES:
            print(f"[警告] 非标准分辨率 {image_size}，有效值: {VALID_IMAGE_SIZES}", file=sys.stderr)
        image_config["image_size"] = image_size

    if image_config:
        payload["image_config"] = image_config

    # 可选参数
    if seed is not None:
        payload["seed"] = seed
    if temperature is not None:
        payload["temperature"] = temperature

    print(f"[*] 生成中...", file=sys.stderr)

    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3271",
        },
        json=payload,
        timeout=180,
    )

    if not resp.ok:
        raise RuntimeError(f"API 错误 {resp.status_code}: {resp.text[:500]}")

    data = resp.json()

    # 检查 API 错误
    if data.get("error"):
        raise RuntimeError(f"API 错误: {data['error'].get('message', json.dumps(data['error']))}")

    # 提取图片
    image_results = extract_image_data(data)
    if not image_results:
        text = extract_text_content(data)
        raise RuntimeError(f"响应中无图片数据。模型回复: {text[:200]}")

    # 保存图片
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    saved_files = []

    if len(image_results) == 1:
        img_bytes, ext = image_results[0]
        out.write_bytes(img_bytes)
        saved_files.append(str(out.resolve()))
    else:
        # 多图：在文件名后加序号
        stem = out.stem
        suffix = out.suffix or ".png"
        for i, (img_bytes, ext) in enumerate(image_results):
            if i == 0:
                file_path = out
            else:
                file_path = out.parent / f"{stem}-{i+1}{suffix}"
            file_path.write_bytes(img_bytes)
            saved_files.append(str(file_path.resolve()))

    total_kb = sum(Path(f).stat().st_size for f in saved_files) / 1024
    print(f"[*] 已保存 {len(saved_files)} 张图片 ({total_kb:.1f} KB)", file=sys.stderr)

    # 提取文本
    text_content = extract_text_content(data)

    # 获取像素尺寸信息
    pixel_info = None
    if aspect_ratio and aspect_ratio in ASPECT_RATIO_PIXELS:
        pixel_info = ASPECT_RATIO_PIXELS[aspect_ratio]

    result = {
        "success": True,
        "output": saved_files[0],
        "all_outputs": saved_files,
        "count": len(saved_files),
        "size_kb": round(total_kb, 1),
        "model": model,
        "aspect_ratio": aspect_ratio,
        "image_size": image_size,
        "seed": seed,
    }

    if pixel_info:
        result["approx_pixels"] = f"{pixel_info[0]}x{pixel_info[1]}"
    if text_content:
        result["text"] = text_content[:500]

    return result


# ── 主入口 ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="OpenRouter 图片生成工具（主力生图）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 基础生图（默认 Gemini 3.1 Flash, 1:1, 1K）
  %(prog)s --prompt "一只猫" --output cat.png

  # 小红书图文（3:4 竖图，2K 高清）
  %(prog)s --prompt "..." --aspect-ratio 3:4 --image-size 2K --output post.png

  # 抖音封面（9:16 全屏竖图，4K）
  %(prog)s --prompt "..." --aspect-ratio 9:16 --image-size 4K --output cover.png

  # 图片编辑（参考图 + 指令）
  %(prog)s --prompt "把背景换成海边日落" --ref-image input.png --output edited.png

  # 固定 seed 保持风格一致
  %(prog)s --prompt "..." --seed 42 --output consistent.png

宽高比选项:
  标准: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
  扩展(仅 Gemini 3.1): 1:4, 4:1, 1:8, 8:1

分辨率选项:
  0.5K  低分辨率(仅 Gemini 3.1)
  1K    标准分辨率(默认)
  2K    高分辨率
  4K    超高分辨率
""",
    )
    parser.add_argument("--prompt", required=True, help="图片描述/生成指令")
    parser.add_argument("--output", required=True, help="输出文件路径")
    parser.add_argument(
        "--model", default=DEFAULT_MODEL,
        help=f"模型 ID (默认: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--aspect-ratio", "--ar",
        choices=list(ASPECT_RATIO_PIXELS.keys()),
        help="宽高比 (如 3:4, 9:16, 16:9)",
    )
    parser.add_argument(
        "--image-size", "--size",
        choices=sorted(VALID_IMAGE_SIZES),
        help="分辨率等级: 0.5K / 1K / 2K / 4K",
    )
    parser.add_argument(
        "--seed", type=int,
        help="随机种子（同 seed + 同 prompt = 相似结果，用于保持一致性）",
    )
    parser.add_argument(
        "--ref-image", action="append", dest="ref_images",
        help="参考图片路径或 URL（可多次指定，用于图生图/编辑）",
    )
    parser.add_argument(
        "--temperature", type=float,
        help="生成温度 (0.0-2.0，越低越确定性，越高越创意)",
    )

    args = parser.parse_args()
    api_key = get_api_key()

    try:
        result = generate_image(
            api_key,
            prompt=args.prompt,
            output_path=args.output,
            model=args.model,
            aspect_ratio=args.aspect_ratio,
            image_size=args.image_size,
            seed=args.seed,
            ref_images=args.ref_images,
            temperature=args.temperature,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        error = {"success": False, "error": str(e)}
        print(json.dumps(error, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
