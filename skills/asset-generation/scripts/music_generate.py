#!/usr/bin/env python3
"""
OpenRouter 音乐生成工具（Google Lyria 3 Pro）
通过 OpenRouter API 调用 Google Lyria 3 Pro 模型生成高质量背景音乐。

默认生成纯器乐（无人声），适合短视频/播客/Vlog 等场景的 BGM。

用法:
    # 基础生成（纯器乐 BGM）
    python3 music_generate.py --prompt "轻快的电子风格背景音乐" --output bgm.mp3

    # 带人声的音乐
    python3 music_generate.py --prompt "一首温柔的民谣" --vocal --output song.mp3

    # 指定 seed 保持一致性
    python3 music_generate.py --prompt "..." --seed 42 --output consistent.mp3

    # 附带参考图（根据图片氛围生成配乐）
    python3 music_generate.py --prompt "为这张图生成配乐" --ref-image cover.png --output bgm.mp3

    # 多张参考图
    python3 music_generate.py --prompt "根据这些画面生成音乐" --ref-image a.png --ref-image b.png --output bgm.mp3

    # 调节创意度
    python3 music_generate.py --prompt "..." --temperature 1.2 --output creative.mp3

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
DEFAULT_MODEL = "google/lyria-3-pro-preview"

# Audio base64 data URL pattern (shared between extract and streaming)
AUDIO_B64_PATTERN = re.compile(r"data:(audio/[^;]+);base64,(.+)", re.DOTALL)


# ── .env 读取 ────────────────────────────────────────────────────────


def load_env() -> dict[str, str]:
    """从 .env 文件加载环境变量。
    查找顺序：
    1. AUTOVIRAL_PROJECT_DIR 环境变量指定的项目目录
    2. ~/.autoviral/.env
    3. 从脚本所在目录向上查找
    4. 从 cwd 向上查找
    """
    search_roots = []

    # 优先：项目目录（服务端通过环境变量传递）
    if project_dir := os.environ.get("AUTOVIRAL_PROJECT_DIR"):
        search_roots.append(Path(project_dir))

    # 其次：~/.autoviral/ 数据目录
    search_roots.append(Path.home() / ".autoviral")

    # 再次：脚本所在目录向上
    search_roots.append(Path(__file__).resolve().parent)

    # 最后：cwd 向上
    search_roots.append(Path.cwd())

    for root in search_roots:
        current = root
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


# ── 音频提取 ─────────────────────────────────────────────────────────


def extract_audio_data(data: dict) -> list[tuple[bytes, str]]:
    """从 OpenRouter 响应中提取所有音频数据，返回 [(bytes, ext), ...]

    音频可能以 data:audio/mp3;base64,... 或 data:audio/mpeg;base64,...
    等格式嵌入在响应中，结构与图片响应类似。
    """
    message = data.get("choices", [{}])[0].get("message", {})
    content = message.get("content")
    images = message.get("images")  # 音频也可能通过 images 字段返回
    results = []

    b64_pattern = re.compile(r"data:(audio/[^;]+);base64,(.+)", re.DOTALL)

    # 方式1: message.images[] — 音频可能以 image_url 格式返回
    if isinstance(images, list):
        for item in images:
            url = (item.get("image_url") or {}).get("url") or item.get("url", "")
            if url:
                m = b64_pattern.match(url)
                if m:
                    ext = _mime_to_ext(m.group(1))
                    results.append((base64.b64decode(m.group(2)), ext))
                    continue
            # inline_data / source 格式
            source = item.get("source", {})
            if source.get("data"):
                ext = _mime_to_ext(source.get("media_type", "audio/mp3"))
                results.append((base64.b64decode(source["data"]), ext))
            inline = item.get("inline_data", {})
            if inline.get("data"):
                ext = _mime_to_ext(inline.get("mime_type", "audio/mp3"))
                results.append((base64.b64decode(inline["data"]), ext))

    if results:
        return results

    # 方式2: content 是数组
    if isinstance(content, list):
        for part in content:
            if part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url", "")
                m = b64_pattern.match(url)
                if m:
                    ext = _mime_to_ext(m.group(1))
                    results.append((base64.b64decode(m.group(2)), ext))
            elif part.get("type") == "audio":
                source = part.get("source", {})
                if source.get("data"):
                    ext = _mime_to_ext(source.get("media_type", "audio/mp3"))
                    results.append((base64.b64decode(source["data"]), ext))
            # inline_data 格式
            inline = part.get("inline_data", {})
            if inline.get("data"):
                mime = inline.get("mime_type", "audio/mp3")
                if mime.startswith("audio/"):
                    ext = _mime_to_ext(mime)
                    results.append((base64.b64decode(inline["data"]), ext))
            # text 中嵌入 base64
            if part.get("type") == "text" and isinstance(part.get("text"), str):
                m = b64_pattern.search(part["text"])
                if m:
                    ext = _mime_to_ext(m.group(1))
                    results.append((base64.b64decode(m.group(2)), ext))

    if results:
        return results

    # 方式3: content 是字符串（直接嵌入 base64）
    if isinstance(content, str):
        m = b64_pattern.search(content)
        if m:
            ext = _mime_to_ext(m.group(1))
            return [(base64.b64decode(m.group(2)), ext)]

    return results


def _mime_to_ext(mime_type: str) -> str:
    """将 audio MIME type 转为文件扩展名"""
    mapping = {
        "audio/mp3": "mp3",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/wave": "wav",
        "audio/ogg": "ogg",
        "audio/flac": "flac",
        "audio/aac": "aac",
        "audio/mp4": "m4a",
    }
    return mapping.get(mime_type, mime_type.split("/")[-1])


def extract_text_content(data: dict) -> str:
    """提取响应中的文本内容（可能包含歌词等）"""
    message = data.get("choices", [{}])[0].get("message", {})
    content = message.get("content")
    if isinstance(content, str):
        # 去除 base64 音频数据
        return re.sub(r"data:audio/[^;]+;base64,[A-Za-z0-9+/=]+", "[audio]", content).strip()
    if isinstance(content, list):
        texts = []
        for part in content:
            if part.get("type") == "text":
                texts.append(part.get("text", ""))
        return "\n".join(texts).strip()
    return ""


# ── 音乐生成 ─────────────────────────────────────────────────────────


def generate_music(
    api_key: str,
    prompt: str,
    output_path: str,
    vocal: bool = False,
    seed: int | None = None,
    ref_images: list[str] | None = None,
    temperature: float | None = None,
) -> dict:
    """调用 OpenRouter Lyria 3 Pro 生成音乐

    Args:
        api_key: OpenRouter API key
        prompt: 音乐描述/指令
        output_path: 输出文件路径
        vocal: 是否包含人声（默认 False，纯器乐）
        seed: 随机种子（用于可重复生成）
        ref_images: 参考图片路径列表（根据图片氛围生成配乐）
        temperature: 生成温度 (0.0-2.0)
    """
    model = DEFAULT_MODEL
    print(f"[*] 模型: {model}", file=sys.stderr)
    print(f"[*] 人声: {'是' if vocal else '否（纯器乐）'}", file=sys.stderr)
    if seed is not None:
        print(f"[*] Seed: {seed}", file=sys.stderr)

    # 构建 prompt — 默认加器乐前缀
    final_prompt = prompt
    if not vocal:
        final_prompt = f"Instrumental only, no vocals. {prompt}"

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
    content_parts.append({"type": "text", "text": final_prompt})

    # 构建请求体
    payload: dict = {
        "model": model,
        "modalities": ["text", "audio"],
        "messages": [{"role": "user", "content": content_parts}],
    }

    # 可选参数
    if seed is not None:
        payload["seed"] = seed
    if temperature is not None:
        payload["temperature"] = temperature

    # Lyria requires streaming on OpenRouter
    payload["stream"] = True

    print(f"[*] 生成中（流式）...", file=sys.stderr)

    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3271",
        },
        json=payload,
        timeout=300,
        stream=True,
    )

    if not resp.ok:
        raise RuntimeError(f"API 错误 {resp.status_code}: {resp.text[:500]}")

    # Parse SSE stream to collect audio and text
    collected_audio_chunks: list[bytes] = []
    collected_text: list[str] = []

    for line in resp.iter_lines():
        if not line:
            continue
        line_str = line.decode("utf-8")
        if not line_str.startswith("data: "):
            continue
        data_str = line_str[6:]
        if data_str == "[DONE]":
            break
        try:
            chunk = json.loads(data_str)
        except json.JSONDecodeError:
            continue

        # Check for errors
        if chunk.get("error"):
            raise RuntimeError(f"API 错误: {chunk['error'].get('message', json.dumps(chunk['error']))}")

        delta = chunk.get("choices", [{}])[0].get("delta", {})

        # Extract audio from delta.audio.data (Lyria's primary audio format)
        audio_obj = delta.get("audio")
        if isinstance(audio_obj, dict) and audio_obj.get("data"):
            audio_b64 = audio_obj["data"]
            collected_audio_chunks.append(base64.b64decode(audio_b64))
            print(f"\r[*] 接收音频数据... ({len(collected_audio_chunks)} 段)", file=sys.stderr, end="")

        # Also check delta.images[] (fallback for other audio models)
        images = delta.get("images")
        if isinstance(images, list):
            for img in images:
                url = (img.get("image_url") or {}).get("url") or img.get("url", "")
                if url:
                    m = AUDIO_B64_PATTERN.match(url)
                    if m:
                        collected_audio_chunks.append(base64.b64decode(m.group(2)))

        # Extract text content (lyrics, metadata)
        content = delta.get("content")
        if isinstance(content, str) and content:
            # Check for embedded audio in text
            m = AUDIO_B64_PATTERN.search(content)
            if m:
                collected_audio_chunks.append(base64.b64decode(m.group(2)))
            else:
                collected_text.append(content)

    print("", file=sys.stderr)  # newline after progress

    if not collected_audio_chunks:
        text_so_far = "".join(collected_text)[:200]
        raise RuntimeError(f"响应中无音频数据。模型回复: {text_so_far}")

    # 保存音频（合并所有段）
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Concatenate all audio chunks
    all_audio = b"".join(collected_audio_chunks)
    out.write_bytes(all_audio)
    saved_path = str(out.resolve())

    size_kb = out.stat().st_size / 1024
    print(f"[*] 已保存音频 ({size_kb:.1f} KB)", file=sys.stderr)

    # 歌词
    lyrics = "".join(collected_text).strip() or None

    result = {
        "success": True,
        "output": saved_path,
        "size_kb": round(size_kb, 1),
        "model": model,
        "has_vocals": vocal,
        "lyrics": lyrics,
    }

    return result


# ── 主入口 ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="OpenRouter 音乐生成工具（Google Lyria 3 Pro）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 基础生成（纯器乐 BGM）
  %(prog)s --prompt "轻快的电子风格背景音乐，适合科技产品展示" --output bgm.mp3

  # 带人声的音乐
  %(prog)s --prompt "一首温柔的中文民谣，关于旅行" --vocal --output song.mp3

  # 根据图片氛围生成配乐
  %(prog)s --prompt "为这张图片生成氛围配乐" --ref-image cover.png --output bgm.mp3

  # 多张参考图
  %(prog)s --prompt "根据这组画面生成转场配乐" --ref-image a.png --ref-image b.png --output bgm.mp3

  # 固定 seed 保持风格一致
  %(prog)s --prompt "..." --seed 42 --output consistent.mp3

  # 调高创意度
  %(prog)s --prompt "..." --temperature 1.5 --output creative.mp3

模型:
  google/lyria-3-pro-preview  Google Lyria 3 Pro（固定使用）

说明:
  默认生成纯器乐（无人声），适合短视频/播客/Vlog 等场景。
  使用 --vocal 标志可生成带人声的音乐。
  支持通过 --ref-image 传入参考图片，模型会根据图片氛围生成配乐。
""",
    )
    parser.add_argument("--prompt", required=True, help="音乐描述/生成指令")
    parser.add_argument("--output", required=True, help="输出文件路径（如 bgm.mp3）")
    parser.add_argument(
        "--vocal", action="store_true",
        help="生成带人声的音乐（默认纯器乐，无人声）",
    )
    parser.add_argument(
        "--seed", type=int,
        help="随机种子（同 seed + 同 prompt = 相似结果，用于保持一致性）",
    )
    parser.add_argument(
        "--ref-image", action="append", dest="ref_images",
        help="参考图片路径或 URL（可多次指定，根据图片氛围生成配乐）",
    )
    parser.add_argument(
        "--temperature", type=float,
        help="生成温度 (0.0-2.0，越低越确定性，越高越创意)",
    )

    args = parser.parse_args()
    api_key = get_api_key()

    try:
        result = generate_music(
            api_key,
            prompt=args.prompt,
            output_path=args.output,
            vocal=args.vocal,
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
