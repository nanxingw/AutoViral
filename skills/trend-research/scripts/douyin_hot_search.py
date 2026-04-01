#!/usr/bin/env python3
"""
抖音热搜直接获取工具
原理来源: ourongxing/newsnow 项目的抖音热搜实现

工作流程:
1. 访问 login.douyin.com 获取有效 Cookie
2. 使用 Cookie 请求抖音 Web API 获取热搜榜
3. 解析并输出结构化热搜数据

用法:
    python3 douyin_hot_search.py              # 输出 JSON
    python3 douyin_hot_search.py --format table  # 输出表格
    python3 douyin_hot_search.py --top 10      # 只显示前10条
"""

import argparse
import json
import sys
import time
from typing import Optional

import requests

# ── 配置 ──────────────────────────────────────────────────────────────

COOKIE_URL = "https://login.douyin.com/"
HOT_SEARCH_URL = "https://www.douyin.com/aweme/v1/web/hot/search/list/"
HOT_SEARCH_PARAMS = {
    "device_platform": "webapp",
    "aid": "6383",
    "channel": "channel_pc_web",
    "detail_list": "1",
}
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.douyin.com/",
}
MAX_RETRIES = 3
RETRY_DELAY_BASE = 3  # seconds


# ── 核心函数 ──────────────────────────────────────────────────────────


def get_douyin_cookies() -> str:
    """访问 login.douyin.com 获取有效的会话 Cookie"""
    try:
        resp = requests.get(
            COOKIE_URL,
            headers={"User-Agent": HEADERS["User-Agent"]},
            timeout=10,
            allow_redirects=False,
        )
        cookies = resp.headers.get("Set-Cookie", "")
        if not cookies:
            # 从 response cookies 拼接
            cookies = "; ".join(
                f"{k}={v}" for k, v in resp.cookies.items()
            )
        return cookies
    except requests.RequestException as e:
        print(f"[错误] 获取Cookie失败: {e}", file=sys.stderr)
        return ""


def fetch_hot_search(cookies: str) -> Optional[list]:
    """使用获取的 Cookie 请求抖音热搜 API"""
    headers = {**HEADERS, "Cookie": cookies}

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(
                HOT_SEARCH_URL,
                params=HOT_SEARCH_PARAMS,
                headers=headers,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()

            if "data" in data and "word_list" in data["data"]:
                return data["data"]["word_list"]

            # API 返回了数据但格式不对，可能需要新 Cookie
            print(
                f"[警告] 尝试 {attempt + 1}: API 返回格式异常，重试中...",
                file=sys.stderr,
            )

        except requests.RequestException as e:
            print(
                f"[警告] 尝试 {attempt + 1} 失败: {e}",
                file=sys.stderr,
            )

        if attempt < MAX_RETRIES - 1:
            delay = RETRY_DELAY_BASE + attempt * 2
            time.sleep(delay)
            # 重新获取 Cookie
            cookies = get_douyin_cookies()
            headers["Cookie"] = cookies

    return None


def parse_hot_list(word_list: list) -> list[dict]:
    """解析热搜列表为结构化数据"""
    results = []
    for i, item in enumerate(word_list):
        entry = {
            "rank": i + 1,
            "title": item.get("word", ""),
            "hot_value": int(item.get("hot_value", 0)),
            "sentence_id": item.get("sentence_id", ""),
            "url": f"https://www.douyin.com/hot/{item.get('sentence_id', '')}",
            "label": item.get("label", 0),  # 1=热 2=新 3=推荐 等
            "event_time": item.get("event_time", ""),
        }

        # 提取关联视频信息（如果有 detail_list）
        word_cover = item.get("word_cover", {})
        if word_cover and word_cover.get("url_list"):
            entry["cover_url"] = word_cover["url_list"][0]

        results.append(entry)

    return results


# ── 输出格式化 ──────────────────────────────────────────────────────


LABEL_MAP = {0: "", 1: "🔥热", 2: "🆕新", 3: "👍荐"}


def print_table(results: list[dict], top_n: int = 0):
    """表格形式输出热搜"""
    items = results[:top_n] if top_n > 0 else results

    print(f"\n{'='*70}")
    print(f"  抖音热搜榜 (共 {len(results)} 条, 显示 {len(items)} 条)")
    print(f"{'='*70}")
    print(f"{'排名':>4}  {'标签':>4}  {'热度':>10}  {'话题'}")
    print(f"{'-'*4}  {'-'*4}  {'-'*10}  {'-'*40}")

    for item in items:
        label = LABEL_MAP.get(item["label"], "")
        hot = f"{item['hot_value']:,}"
        print(f"{item['rank']:>4}  {label:>4}  {hot:>10}  {item['title']}")

    print(f"{'='*70}\n")


def print_json(results: list[dict], top_n: int = 0):
    """JSON 形式输出"""
    items = results[:top_n] if top_n > 0 else results
    output = {
        "platform": "douyin",
        "fetch_time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total": len(results),
        "showing": len(items),
        "items": items,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


# ── 主入口 ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="抖音热搜获取工具")
    parser.add_argument(
        "--format",
        choices=["json", "table"],
        default="json",
        help="输出格式 (默认: json)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=0,
        help="只显示前N条 (默认: 全部)",
    )
    args = parser.parse_args()

    # Step 1: 获取 Cookie
    print("[*] 正在获取抖音Cookie...", file=sys.stderr)
    cookies = get_douyin_cookies()
    if not cookies:
        print("[错误] 无法获取Cookie，退出", file=sys.stderr)
        sys.exit(1)

    # Step 2: 获取热搜
    print("[*] 正在请求热搜数据...", file=sys.stderr)
    word_list = fetch_hot_search(cookies)
    if not word_list:
        print("[错误] 无法获取热搜数据，退出", file=sys.stderr)
        sys.exit(1)

    # Step 3: 解析
    results = parse_hot_list(word_list)
    print(f"[*] 成功获取 {len(results)} 条热搜", file=sys.stderr)

    # Step 4: 输出
    if args.format == "table":
        print_table(results, args.top)
    else:
        print_json(results, args.top)


if __name__ == "__main__":
    main()
