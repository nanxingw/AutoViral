#!/usr/bin/env python3
"""
检查可用的生成服务提供商
读取项目 .env 文件，检测配置了哪些 API 密钥，报告可用能力。

用法:
    python3 check_providers.py                    # JSON 输出
    python3 check_providers.py --format table     # 表格输出
"""

import argparse
import json
import os
import sys
from pathlib import Path

# 查找 .env 文件
# 查找顺序：AUTOVIRAL_PROJECT_DIR → ~/.autoviral/ → 脚本目录向上 → cwd 向上
def find_env_file() -> Path | None:
    if env_path := os.environ.get("AUTOVIRAL_ENV"):
        p = Path(env_path)
        if p.exists():
            return p

    search_roots = []
    if project_dir := os.environ.get("AUTOVIRAL_PROJECT_DIR"):
        search_roots.append(Path(project_dir))
    search_roots.append(Path.home() / ".autoviral")
    search_roots.append(Path(__file__).resolve().parent)
    search_roots.append(Path.cwd())

    for root in search_roots:
        current = root
        for _ in range(10):
            candidate = current / ".env"
            if candidate.exists():
                return candidate
            current = current.parent

    return None


def parse_env(env_path: Path) -> dict[str, str]:
    """解析 .env 文件"""
    env_vars = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                env_vars[key.strip()] = value.strip()
    return env_vars


def check_providers(env_vars: dict[str, str]) -> dict:
    """检查各个 provider 的配置状态"""
    providers = []

    # OpenRouter (Gemini) — 主力图片生成
    openrouter_key = env_vars.get("OPENROUTER_API_KEY", "")
    openrouter_ready = bool(openrouter_key)
    providers.append({
        "name": "openrouter",
        "display_name": "OpenRouter (Gemini 3.1 Flash)",
        "available": openrouter_ready,
        "supports_image": True,
        "supports_video": False,
        "missing_keys": ["OPENROUTER_API_KEY"] if not openrouter_key else [],
        "script": "openrouter_generate.py",
        "note": "主力图片生成，支持 4K/宽高比/seed/图生图，模型: gemini-3.1-flash-image-preview",
        "models": [
            "google/gemini-3.1-flash-image-preview (推荐，最强画质)",
            "google/gemini-2.5-flash-image (备用，性价比高)",
        ],
        "features": ["aspect_ratio", "image_size (0.5K-4K)", "seed", "ref-image", "temperature"],
    })

    # 即梦 (Jimeng / VolcEngine) — 视频生成 + 备用图片
    jimeng_ak = env_vars.get("JIMENG_ACCESS_KEY", "")
    jimeng_sk = env_vars.get("JIMENG_SECRET_KEY", "")
    jimeng_ready = bool(jimeng_ak and jimeng_sk)
    providers.append({
        "name": "jimeng",
        "display_name": "即梦 AI (VolcEngine)",
        "available": jimeng_ready,
        "supports_image": True,
        "supports_video": True,
        "missing_keys": [
            k for k, v in [
                ("JIMENG_ACCESS_KEY", jimeng_ak),
                ("JIMENG_SECRET_KEY", jimeng_sk),
            ] if not v
        ],
        "script": "jimeng_generate.py",
        "note": "视频生成主力 + 备用图片，支持文生图/文生视频/图生视频",
    })

    # Google Lyria 3 Pro — 音乐生成（复用 OpenRouter key）
    providers.append({
        "name": "lyria",
        "display_name": "Google Lyria 3 Pro (Music)",
        "available": openrouter_ready,
        "supports_image": False,
        "supports_video": False,
        "supports_music": True,
        "missing_keys": ["OPENROUTER_API_KEY"] if not openrouter_key else [],
        "script": "music_generate.py",
        "note": "AI 音乐生成，支持文生音乐/图生音乐，~2分钟完整曲目",
    })

    # 汇总可用能力
    can_image = any(p["available"] and p.get("supports_image") for p in providers)
    can_video = any(p["available"] and p.get("supports_video") for p in providers)
    can_music = any(p["available"] and p.get("supports_music") for p in providers)

    # 推荐选择
    recommended_image = next(
        (p["script"] for p in providers if p["available"] and p.get("supports_image")),
        None,
    )
    recommended_video = next(
        (p["script"] for p in providers if p["available"] and p.get("supports_video")),
        None,
    )
    recommended_music = next(
        (p["script"] for p in providers if p["available"] and p.get("supports_music")),
        None,
    )

    return {
        "providers": providers,
        "capabilities": {
            "image_generation": can_image,
            "video_generation": can_video,
            "music_generation": can_music,
        },
        "recommended": {
            "image": recommended_image,
            "video": recommended_video,
            "music": recommended_music,
        },
    }


def print_table(result: dict):
    print(f"\n{'='*65}")
    print("  生成服务提供商配置检查")
    print(f"{'='*65}")
    print(f"{'提供商':<25} {'图片':>6} {'视频':>6} {'音乐':>6} {'状态':>8}")
    print(f"{'-'*25} {'-'*6} {'-'*6} {'-'*6} {'-'*8}")

    for p in result["providers"]:
        img = "✓" if p.get("supports_image") else "✗"
        vid = "✓" if p.get("supports_video") else "✗"
        mus = "✓" if p.get("supports_music") else "✗"
        status = "可用" if p["available"] else "未配置"
        print(f"{p['display_name']:<25} {img:>6} {vid:>6} {mus:>6} {status:>8}")
        if not p["available"] and p["missing_keys"]:
            print(f"  缺少: {', '.join(p['missing_keys'])}")

    caps = result["capabilities"]
    rec = result["recommended"]
    img_rec = rec["image"]
    vid_rec = rec["video"]
    mus_rec = rec.get("music")
    print(f"\n{'─'*65}")
    img_suffix = f"  → 使用 {img_rec}" if img_rec else ""
    vid_suffix = f"  → 使用 {vid_rec}" if vid_rec else ""
    mus_suffix = f"  → 使用 {mus_rec}" if mus_rec else ""
    print(f"  图片生成: {'✓ 可用' if caps['image_generation'] else '✗ 不可用'}{img_suffix}")
    print(f"  视频生成: {'✓ 可用' if caps['video_generation'] else '✗ 不可用'}{vid_suffix}")
    print(f"  音乐生成: {'✓ 可用' if caps.get('music_generation') else '✗ 不可用'}{mus_suffix}")
    print(f"{'='*65}\n")


def main():
    parser = argparse.ArgumentParser(description="检查生成服务提供商配置")
    parser.add_argument("--format", choices=["json", "table"], default="json")
    args = parser.parse_args()

    env_path = find_env_file()
    if not env_path:
        print("[错误] 找不到 .env 文件", file=sys.stderr)
        sys.exit(1)

    print(f"[*] 读取配置: {env_path}", file=sys.stderr)
    env_vars = parse_env(env_path)
    result = check_providers(env_vars)

    if args.format == "table":
        print_table(result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
