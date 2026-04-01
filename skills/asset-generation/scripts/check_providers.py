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
# 查找所有 .env 文件并合并，后找到的覆盖先找到的
# 查找顺序：~/.autoviral/ → 脚本目录向上 → cwd 向上 → AUTOVIRAL_PROJECT_DIR
# 越靠后优先级越高（项目根目录的 .env 覆盖全局配置）
def find_all_env_files() -> list[Path]:
    """找到所有 .env 文件，返回按优先级从低到高排列的列表"""
    found: list[Path] = []
    seen: set[str] = set()

    search_roots = []
    search_roots.append(Path.home() / ".autoviral")
    search_roots.append(Path(__file__).resolve().parent)
    search_roots.append(Path.cwd())
    if project_dir := os.environ.get("AUTOVIRAL_PROJECT_DIR"):
        search_roots.append(Path(project_dir))

    for root in search_roots:
        current = root
        for _ in range(10):
            candidate = current / ".env"
            resolved = str(candidate.resolve())
            if candidate.exists() and resolved not in seen:
                found.append(candidate)
                seen.add(resolved)
            current = current.parent

    if env_path := os.environ.get("AUTOVIRAL_ENV"):
        p = Path(env_path)
        if p.exists() and str(p.resolve()) not in seen:
            found.append(p)

    return found


def find_env_file() -> Path | None:
    """兼容旧接口，返回最高优先级的 .env 文件"""
    files = find_all_env_files()
    return files[-1] if files else None


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


def check_dreamina_cli() -> dict:
    """检查 Dreamina CLI 是否已安装且已登录"""
    import shutil
    import subprocess

    result = {
        "name": "dreamina",
        "display_name": "Dreamina CLI (即梦官方)",
        "available": False,
        "installed": False,
        "logged_in": False,
        "supports_image": True,
        "supports_video": True,
        "missing_keys": [],
        "script": "dreamina (CLI)",
        "note": "视频生成首选，Seedance 2.0 模型，支持多模态/多帧/首尾帧视频生成",
        "commands": [
            "text2video", "image2video", "frames2video",
            "multiframe2video", "multimodal2video",
            "text2image", "image2image", "image_upscale",
        ],
    }

    # Check if installed
    if not shutil.which("dreamina"):
        result["missing_keys"] = ["CLI 未安装 (curl -fsSL https://jimeng.jianying.com/cli | bash)"]
        return result
    result["installed"] = True

    # Check if logged in
    try:
        proc = subprocess.run(
            ["dreamina", "user_credit"],
            capture_output=True, text=True, timeout=10,
        )
        if proc.returncode == 0:
            import json as _json
            try:
                credit_data = _json.loads(proc.stdout)
                result["logged_in"] = True
                result["available"] = True
                credit = credit_data.get("credit") or credit_data.get("remaining", "?")
                result["note"] += f"，剩余积分: {credit}"
            except Exception:
                result["logged_in"] = True
                result["available"] = True
        else:
            result["missing_keys"] = ["未登录 (dreamina login)"]
    except Exception:
        result["missing_keys"] = ["登录检查失败"]

    return result


def check_providers(env_vars: dict[str, str]) -> dict:
    """检查各个 provider 的配置状态"""
    providers = []

    # Dreamina CLI — 视频生成首选
    dreamina_result = check_dreamina_cli()
    providers.append(dreamina_result)

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

    # 即梦 API (Jimeng / VolcEngine) — 视频生成备用 + 备用图片
    jimeng_ak = env_vars.get("JIMENG_ACCESS_KEY", "")
    jimeng_sk = env_vars.get("JIMENG_SECRET_KEY", "")
    jimeng_ready = bool(jimeng_ak and jimeng_sk)
    providers.append({
        "name": "jimeng",
        "display_name": "即梦 API (VolcEngine)",
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
        "note": "视频生成备用 + 备用图片（Dreamina CLI 不可用时使用）",
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

    # 推荐选择（图片优先 OpenRouter/Gemini，视频优先 Dreamina CLI）
    recommended_image = next(
        (p["script"] for p in providers
         if p["available"] and p.get("supports_image") and p["name"] == "openrouter"),
        next(
            (p["script"] for p in providers
             if p["available"] and p.get("supports_image") and p["name"] != "dreamina"),
            next(
                (p["script"] for p in providers if p["available"] and p.get("supports_image")),
                None,
            ),
        ),
    )
    recommended_video = next(
        (p["script"] for p in providers
         if p["available"] and p.get("supports_video") and p["name"] == "dreamina"),
        next(
            (p["script"] for p in providers if p["available"] and p.get("supports_video")),
            None,
        ),
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

    env_files = find_all_env_files()
    if not env_files:
        print("[错误] 找不到 .env 文件", file=sys.stderr)
        sys.exit(1)

    # 合并所有 .env 文件，后面的覆盖前面的
    env_vars: dict[str, str] = {}
    for ef in env_files:
        print(f"[*] 读取配置: {ef}", file=sys.stderr)
        env_vars.update(parse_env(ef))
    result = check_providers(env_vars)

    if args.format == "table":
        print_table(result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
