#!/usr/bin/env python3
"""
Lyria 背景配乐生成工具
通过 OpenRouter API 调用 Google Lyria 模型生成背景音乐。

用法:
    python3 lyria_music.py --prompt "upbeat lo-fi hip hop, chill study vibes" --output bgm.mp3
    python3 lyria_music.py --prompt "cinematic orchestral, epic and inspiring" --output bgm.mp3 --model google/lyria-3-pro-preview

模型:
    google/lyria-3-clip-preview  — 30秒片段 (默认，适合短视频)
    google/lyria-3-pro-preview   — 完整歌曲 (1-2分钟)

环境变量（从 .env 读取）:
    OPENROUTER_API_KEY  OpenRouter API 密钥
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path

import requests

# ── 配置 ──────────────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/lyria-3-clip-preview"


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
        print("[ERROR] OPENROUTER_API_KEY not configured", file=sys.stderr)
        sys.exit(1)
    return key


# ── 音乐生成 ─────────────────────────────────────────────────────────


def generate_music(
    api_key: str,
    prompt: str,
    output_path: str,
    model: str = DEFAULT_MODEL,
) -> dict:
    """调用 OpenRouter Lyria 生成背景音乐"""
    print(f"[*] Model: {model}", file=sys.stderr)
    print(f"[*] Generating music...", file=sys.stderr)

    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3271",
        },
        json={
            "model": model,
            "modalities": ["text", "audio"],
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": prompt}],
                }
            ],
        },
        timeout=180,
    )

    if not resp.ok:
        raise RuntimeError(f"API error {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    message = data.get("choices", [{}])[0].get("message", {})
    content = message.get("content")

    # Extract audio data from response
    audio_data = None

    if isinstance(content, list):
        for part in content:
            # Check inline_data (Gemini audio format)
            if part.get("type") == "inline_data" or "inline_data" in part:
                inline = part.get("inline_data", part)
                if inline.get("data"):
                    audio_data = base64.b64decode(inline["data"])
                    break
            # Check audio_url format
            if part.get("type") == "audio_url":
                url = (part.get("audio_url") or {}).get("url", "")
                if url.startswith("data:"):
                    # data:audio/mp3;base64,...
                    b64 = url.split(",", 1)[1] if "," in url else ""
                    if b64:
                        audio_data = base64.b64decode(b64)
                        break
            # Check for base64 audio in text
            if part.get("type") == "audio" and part.get("source", {}).get("data"):
                audio_data = base64.b64decode(part["source"]["data"])
                break

    # Fallback: check message.audio
    if not audio_data:
        audio = message.get("audio")
        if isinstance(audio, dict) and audio.get("data"):
            audio_data = base64.b64decode(audio["data"])

    if not audio_data:
        raise RuntimeError(f"No audio data found in response. Keys: {list(message.keys())}")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio_data)

    size_kb = out.stat().st_size / 1024
    print(f"[*] Music saved: {out} ({size_kb:.1f} KB)", file=sys.stderr)

    return {
        "success": True,
        "output": str(out.resolve()),
        "size_kb": round(size_kb, 1),
        "model": model,
    }


# ── 主入口 ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Lyria background music generator")
    parser.add_argument("--prompt", required=True, help="Music description/style")
    parser.add_argument("--output", required=True, help="Output file path (.mp3)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Model (default: {DEFAULT_MODEL})")
    args = parser.parse_args()

    api_key = get_api_key()

    try:
        result = generate_music(api_key, args.prompt, args.output, args.model)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        error = {"success": False, "error": str(e)}
        print(json.dumps(error, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
