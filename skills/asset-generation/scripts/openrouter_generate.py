#!/usr/bin/env python3
"""
OpenRouter (Gemini) 图片生成工具
通过 OpenRouter API 调用 Gemini 模型生成图片。
仅支持图片生成，不支持视频。

用法:
    python3 openrouter_generate.py --prompt "一只可爱的猫咪坐在窗台上" --output cat.png
    python3 openrouter_generate.py --prompt "..." --output result.png --model google/gemini-2.5-flash-preview

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
DEFAULT_MODEL = "google/gemini-3-pro-image-preview"


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


# ── 图片生成 ─────────────────────────────────────────────────────────


def extract_image_data(data: dict) -> tuple[bytes, str] | None:
    """从 OpenRouter 响应中提取图片数据"""
    message = data.get("choices", [{}])[0].get("message", {})
    content = message.get("content")
    images = message.get("images")

    b64_pattern = re.compile(r"data:(image/[^;]+);base64,(.+)")

    # 方式1: message.images[]
    if isinstance(images, list):
        for img in images:
            url = (img.get("image_url") or {}).get("url") or img.get("url", "")
            if url:
                m = b64_pattern.match(url)
                if m:
                    return base64.b64decode(m.group(2)), m.group(1).split("/")[1]
            source = img.get("source", {})
            if source.get("data"):
                ext = (source.get("media_type") or "image/png").split("/")[1]
                return base64.b64decode(source["data"]), ext

    # 方式2: content 是字符串
    if isinstance(content, str):
        m = b64_pattern.search(content)
        if m:
            return base64.b64decode(m.group(2)), m.group(1).split("/")[1]

    # 方式3: content 是数组
    if isinstance(content, list):
        for part in content:
            if part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url", "")
                m = b64_pattern.match(url)
                if m:
                    return base64.b64decode(m.group(2)), m.group(1).split("/")[1]
            if part.get("type") == "image":
                source = part.get("source", {})
                if source.get("data"):
                    ext = (source.get("media_type") or "image/png").split("/")[1]
                    return base64.b64decode(source["data"]), ext
            if part.get("type") == "text" and isinstance(part.get("text"), str):
                m = b64_pattern.search(part["text"])
                if m:
                    return base64.b64decode(m.group(2)), m.group(1).split("/")[1]

    return None


def generate_image(
    api_key: str,
    prompt: str,
    output_path: str,
    model: str = DEFAULT_MODEL,
) -> dict:
    """调用 OpenRouter Gemini 生成图片"""
    print(f"[*] 使用模型: {model}", file=sys.stderr)
    print(f"[*] 生成中...", file=sys.stderr)

    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3271",
        },
        json={
            "model": model,
            "modalities": ["text", "image"],
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": prompt}],
                }
            ],
        },
        timeout=120,
    )

    if not resp.ok:
        raise RuntimeError(f"API 错误 {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    result = extract_image_data(data)

    if not result:
        raise RuntimeError("响应中无图片数据")

    img_bytes, ext = result
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(img_bytes)

    size_kb = out.stat().st_size / 1024
    print(f"[*] 图片已保存: {out} ({size_kb:.1f} KB)", file=sys.stderr)

    return {
        "success": True,
        "output": str(out.resolve()),
        "size_kb": round(size_kb, 1),
        "model": model,
    }


# ── 主入口 ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="OpenRouter (Gemini) 图片生成工具")
    parser.add_argument("--prompt", required=True, help="图片描述")
    parser.add_argument("--output", required=True, help="输出文件路径")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"模型 (默认: {DEFAULT_MODEL})")
    args = parser.parse_args()

    api_key = get_api_key()

    try:
        result = generate_image(api_key, args.prompt, args.output, args.model)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        error = {"success": False, "error": str(e)}
        print(json.dumps(error, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
