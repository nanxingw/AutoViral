#!/usr/bin/env python3
"""
即梦 AI (VolcEngine) 图片和视频生成工具
通过火山引擎 Visual API 生成图片和视频。

用法:
    # 文生图
    python3 jimeng_generate.py image --prompt "一只可爱的猫咪" --output cat.png

    # 指定尺寸（竖屏 9:16）
    python3 jimeng_generate.py image --prompt "..." --width 1088 --height 1920 --output frame.png

    # 参考图生图
    python3 jimeng_generate.py image --prompt "..." --ref-image ref.png --output result.png

    # 文生视频
    python3 jimeng_generate.py video --prompt "镜头缓慢推进，猫咪转头看向镜头" --output clip.mp4

    # 图生视频（首帧驱动）
    python3 jimeng_generate.py video --prompt "猫咪慢慢眨眼" --first-frame frame.png --output clip.mp4

    # 指定视频宽高比
    python3 jimeng_generate.py video --prompt "..." --resolution 9:16 --output clip.mp4

环境变量（从 .env 读取）:
    JIMENG_ACCESS_KEY  火山引擎 Access Key
    JIMENG_SECRET_KEY  火山引擎 Secret Key
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# ── 配置 ──────────────────────────────────────────────────────────────

BASE_URL = "https://visual.volcengineapi.com"
REGION = "cn-north-1"
SERVICE = "cv"
API_VERSION = "2022-08-31"
SUBMIT_ACTION = "CVSync2AsyncSubmitTask"
QUERY_ACTION = "CVSync2AsyncGetResult"

IMAGE_REQ_KEY = "jimeng_t2i_v40"
VIDEO_T2V_REQ_KEY = "jimeng_ti2v_v30_pro"
VIDEO_I2V_REQ_KEY = "jimeng_ti2v_v30_pro"

POLL_INTERVAL = 2  # seconds
POLL_TIMEOUT = 300  # 5 minutes


# ── .env 读取 ────────────────────────────────────────────────────────


def load_env() -> dict[str, str]:
    """从 .env 文件加载环境变量"""
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


def get_credentials() -> tuple[str, str]:
    """获取 API 凭证，优先环境变量，其次 .env 文件"""
    ak = os.environ.get("JIMENG_ACCESS_KEY", "")
    sk = os.environ.get("JIMENG_SECRET_KEY", "")
    if not ak or not sk:
        env_vars = load_env()
        ak = ak or env_vars.get("JIMENG_ACCESS_KEY", "")
        sk = sk or env_vars.get("JIMENG_SECRET_KEY", "")
    if not ak or not sk:
        print("[错误] 未配置 JIMENG_ACCESS_KEY / JIMENG_SECRET_KEY", file=sys.stderr)
        sys.exit(1)
    return ak, sk


# ── HMAC-SHA256 签名 (AWS SigV4 风格) ────────────────────────────────


def sha256(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def hmac_sha256_hex(key: bytes, msg: str) -> str:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).hexdigest()


def sign_request(
    access_key: str, secret_key: str, action: str, payload: str
) -> dict:
    """生成签名请求"""
    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = timestamp[:8]

    host = "visual.volcengineapi.com"
    payload_hash = sha256(payload)
    query_params = f"Action={action}&Version={API_VERSION}"

    canonical_headers = (
        f"host:{host}\n"
        f"x-content-sha256:{payload_hash}\n"
        f"x-date:{timestamp}\n"
    )
    signed_headers = "host;x-content-sha256;x-date"

    canonical_request = "\n".join([
        "POST", "/", query_params, canonical_headers, signed_headers, payload_hash
    ])

    credential_scope = f"{date_stamp}/{REGION}/{SERVICE}/request"
    string_to_sign = "\n".join([
        "HMAC-SHA256", timestamp, credential_scope, sha256(canonical_request)
    ])

    k_date = hmac_sha256(secret_key.encode("utf-8"), date_stamp)
    k_region = hmac_sha256(k_date, REGION)
    k_service = hmac_sha256(k_region, SERVICE)
    k_signing = hmac_sha256(k_service, "request")
    signature = hmac_sha256_hex(k_signing, string_to_sign)

    authorization = (
        f"HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    return {
        "url": f"{BASE_URL}/?{query_params}",
        "headers": {
            "Content-Type": "application/json",
            "Host": host,
            "X-Date": timestamp,
            "X-Content-Sha256": payload_hash,
            "Authorization": authorization,
        },
        "body": payload,
    }


# ── 提交与轮询 ──────────────────────────────────────────────────────


def submit_and_poll(
    access_key: str, secret_key: str, payload: dict
) -> dict:
    """提交异步任务并轮询结果"""
    body = json.dumps(payload)
    req = sign_request(access_key, secret_key, SUBMIT_ACTION, body)

    print("[*] 提交生成任务...", file=sys.stderr)
    resp = requests.post(req["url"], headers=req["headers"], data=req["body"], timeout=30)
    resp.raise_for_status()
    data = resp.json()

    if data.get("code") and data["code"] not in (0, 10000):
        raise RuntimeError(f"提交失败: {data.get('message', json.dumps(data))}")

    task_id = data.get("data", {}).get("task_id")
    if not task_id:
        if data.get("data"):
            return data["data"]
        raise RuntimeError(f"无 task_id: {json.dumps(data)}")

    print(f"[*] 任务已提交 (task_id: {task_id})，轮询中...", file=sys.stderr)
    deadline = time.time() + POLL_TIMEOUT

    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)

        query_body = json.dumps({"req_key": payload["req_key"], "task_id": task_id})
        query_req = sign_request(access_key, secret_key, QUERY_ACTION, query_body)
        query_resp = requests.post(
            query_req["url"], headers=query_req["headers"], data=query_req["body"], timeout=30
        )
        query_data = query_resp.json()

        status = query_data.get("data", {}).get("status", "")
        if status in ("done", "SUCCESS"):
            print("[*] 生成完成!", file=sys.stderr)
            return query_data["data"]
        if status in ("failed", "FAILED"):
            raise RuntimeError(
                f"任务失败: {query_data['data'].get('message', json.dumps(query_data))}"
            )

        elapsed = int(time.time() - (deadline - POLL_TIMEOUT))
        print(f"[*] 等待中... ({elapsed}s)", file=sys.stderr, end="\r")

    raise RuntimeError("任务超时 (5分钟)")


# ── 图片生成 ─────────────────────────────────────────────────────────


def generate_image(
    access_key: str,
    secret_key: str,
    prompt: str,
    output_path: str,
    width: int = 1088,
    height: int = 1088,
    ref_image: str | None = None,
) -> dict:
    """文生图 / 参考图生图"""
    width = max(576, min(1728, width))
    height = max(576, min(1728, height))

    payload: dict = {
        "req_key": IMAGE_REQ_KEY,
        "prompt": prompt,
        "width": width,
        "height": height,
        "return_url": True,
        "logo_info": {"add_logo": False},
    }

    if ref_image:
        ref_path = Path(ref_image)
        if ref_path.exists():
            b64 = base64.b64encode(ref_path.read_bytes()).decode()
            payload["binary_data_base64"] = [b64]
        else:
            print(f"[警告] 参考图不存在: {ref_image}", file=sys.stderr)

    result = submit_and_poll(access_key, secret_key, payload)

    # 提取图片 URL 或 base64
    image_urls = result.get("image_urls") or []
    resp_data = result.get("resp_data") or []
    b64_list = result.get("binary_data_base64") or []

    image_url = (
        (image_urls[0] if image_urls else None)
        or (resp_data[0].get("image_url") if resp_data and isinstance(resp_data[0], dict) else None)
    )
    image_b64 = b64_list[0] if b64_list else None

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    if image_url:
        print(f"[*] 下载图片...", file=sys.stderr)
        img_resp = requests.get(image_url, timeout=60)
        img_resp.raise_for_status()
        out.write_bytes(img_resp.content)
    elif image_b64:
        out.write_bytes(base64.b64decode(image_b64))
    else:
        raise RuntimeError("响应中无图片数据")

    size_kb = out.stat().st_size / 1024
    return {
        "success": True,
        "output": str(out.resolve()),
        "size_kb": round(size_kb, 1),
        "width": width,
        "height": height,
    }


# ── 视频生成 ─────────────────────────────────────────────────────────


def generate_video(
    access_key: str,
    secret_key: str,
    prompt: str,
    output_path: str,
    first_frame: str | None = None,
    last_frame: str | None = None,
    resolution: str | None = None,
) -> dict:
    """文生视频 / 图生视频"""
    is_i2v = bool(first_frame)
    req_key = VIDEO_I2V_REQ_KEY if is_i2v else VIDEO_T2V_REQ_KEY

    payload: dict = {
        "req_key": req_key,
        "prompt": prompt,
        "return_url": True,
    }

    if first_frame:
        ff_path = Path(first_frame)
        if first_frame.startswith(("http://", "https://")):
            payload["image_urls"] = [first_frame]
        elif ff_path.exists():
            b64 = base64.b64encode(ff_path.read_bytes()).decode()
            payload["binary_data_base64"] = [b64]
        else:
            print(f"[警告] 首帧文件不存在: {first_frame}", file=sys.stderr)

    if last_frame:
        lf_path = Path(last_frame)
        if last_frame.startswith(("http://", "https://")):
            urls = payload.get("image_urls", [])
            urls.append(last_frame)
            payload["image_urls"] = urls
        elif lf_path.exists():
            b64_list = payload.get("binary_data_base64", [])
            b64_list.append(base64.b64encode(lf_path.read_bytes()).decode())
            payload["binary_data_base64"] = b64_list

    if resolution:
        payload["aspect_ratio"] = resolution

    result = submit_and_poll(access_key, secret_key, payload)

    video_urls = result.get("video_urls") or []
    resp_data = result.get("resp_data") or []
    video_url = (
        (video_urls[0] if video_urls else None)
        or result.get("video_url")
        or (resp_data[0].get("video_url") if resp_data and isinstance(resp_data[0], dict) else None)
    )

    if not video_url:
        raise RuntimeError("响应中无视频 URL")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"[*] 下载视频...", file=sys.stderr)
    vid_resp = requests.get(video_url, timeout=120)
    vid_resp.raise_for_status()
    out.write_bytes(vid_resp.content)

    size_mb = out.stat().st_size / (1024 * 1024)
    return {
        "success": True,
        "output": str(out.resolve()),
        "size_mb": round(size_mb, 2),
        "mode": "image-to-video" if is_i2v else "text-to-video",
    }


# ── 主入口 ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="即梦 AI 图片/视频生成工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # image 子命令
    img_parser = subparsers.add_parser("image", help="生成图片")
    img_parser.add_argument("--prompt", required=True, help="图片描述")
    img_parser.add_argument("--output", required=True, help="输出文件路径")
    img_parser.add_argument("--width", type=int, default=1088, help="宽度 (576-1728)")
    img_parser.add_argument("--height", type=int, default=1088, help="高度 (576-1728)")
    img_parser.add_argument("--ref-image", help="参考图片路径")

    # video 子命令
    vid_parser = subparsers.add_parser("video", help="生成视频")
    vid_parser.add_argument("--prompt", required=True, help="视频动作描述")
    vid_parser.add_argument("--output", required=True, help="输出文件路径")
    vid_parser.add_argument("--first-frame", help="首帧图片路径或URL")
    vid_parser.add_argument("--last-frame", help="末帧图片路径或URL")
    vid_parser.add_argument("--resolution", help="宽高比 (如 9:16, 16:9)")

    args = parser.parse_args()
    access_key, secret_key = get_credentials()

    try:
        if args.command == "image":
            result = generate_image(
                access_key, secret_key,
                prompt=args.prompt,
                output_path=args.output,
                width=args.width,
                height=args.height,
                ref_image=args.ref_image,
            )
        else:
            result = generate_video(
                access_key, secret_key,
                prompt=args.prompt,
                output_path=args.output,
                first_frame=args.first_frame,
                last_frame=args.last_frame,
                resolution=args.resolution,
            )

        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        error = {"success": False, "error": str(e)}
        print(json.dumps(error, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
