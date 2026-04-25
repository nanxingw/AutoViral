#!/usr/bin/env python3
"""
NewsNow 多平台热搜聚合工具
数据源: ourongxing/newsnow (https://newsnow.busiyi.world)

支持 50+ 平台的热搜/热榜数据获取，包括:
  - 抖音 (douyin)
  - 微博 (weibo)
  - 知乎 (zhihu)
  - 百度 (baidu)
  - 哔哩哔哩 (bilibili)
  - 今日头条 (toutiao)
  - 36氪 (36kr)
  等

用法:
    python3 newsnow_trends.py douyin           # 获取抖音热搜
    python3 newsnow_trends.py weibo zhihu      # 获取微博+知乎
    python3 newsnow_trends.py --list           # 列出所有支持的平台
    python3 newsnow_trends.py --all-cn         # 获取所有主要中文平台
    python3 newsnow_trends.py douyin --top 20  # 只显示前20条
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

# ── 配置 ──────────────────────────────────────────────────────────────

API_BASE = "https://newsnow.busiyi.world/api/s"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
}
TIMEOUT = 15
MAX_RETRIES = 2

# 主要中文平台 ID
MAIN_CN_PLATFORMS = [
    "douyin",
    "weibo",
    "zhihu",
    "baidu",
    "bilibili",
    "toutiao",
    "36kr",
    "ithome",
    "thepaper",
]

# 完整平台列表
PLATFORM_INFO = {
    # 社交/短视频
    "douyin": "抖音热搜",
    "weibo": "微博热搜",
    "bilibili": "哔哩哔哩热门",
    # 搜索/资讯
    "baidu": "百度热搜",
    "toutiao": "今日头条",
    "zhihu": "知乎热榜",
    # 科技
    "36kr": "36氪",
    "ithome": "IT之家",
    "coolapk": "酷安热榜",
    "v2ex": "V2EX",
    # 新闻
    "thepaper": "澎湃新闻",
    "cls": "财联社",
    "wallstreetcn": "华尔街见闻",
    "zaobao": "联合早报",
    "cankaoxiaoxi": "参考消息",
    # 国际
    "hackernews": "Hacker News",
    "producthunt": "Product Hunt",
    "github-trending": "GitHub Trending",
    "reddit": "Reddit",
    "twitter": "Twitter/X Trending",
}

# ── 核心函数 ──────────────────────────────────────────────────────────


def fetch_platform(platform_id: str) -> dict:
    """获取指定平台的热搜数据"""
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(
                API_BASE,
                params={"id": platform_id, "latest": ""},
                headers=HEADERS,
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()

            if data.get("status") in ("success", "cache") and "items" in data:
                return {
                    "platform": platform_id,
                    "name": PLATFORM_INFO.get(platform_id, platform_id),
                    "status": "ok",
                    "updated_time": data.get("updatedTime", ""),
                    "items": [
                        {
                            "rank": i + 1,
                            "title": item.get("title", ""),
                            "url": item.get("url", ""),
                            "mobile_url": item.get("mobileUrl", ""),
                        }
                        for i, item in enumerate(data.get("items", []))
                    ],
                }

        except requests.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 + attempt)
                continue
            return {
                "platform": platform_id,
                "name": PLATFORM_INFO.get(platform_id, platform_id),
                "status": "error",
                "error": str(e),
                "items": [],
            }

    return {
        "platform": platform_id,
        "name": PLATFORM_INFO.get(platform_id, platform_id),
        "status": "error",
        "error": "max retries exceeded",
        "items": [],
    }


def fetch_multiple(platform_ids: list[str], max_workers: int = 5) -> list[dict]:
    """并发获取多个平台数据"""
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(fetch_platform, pid): pid
            for pid in platform_ids
        }
        for future in as_completed(futures):
            results.append(future.result())

    # 按原始顺序排序
    order = {pid: i for i, pid in enumerate(platform_ids)}
    results.sort(key=lambda r: order.get(r["platform"], 999))
    return results


# ── 输出格式化 ──────────────────────────────────────────────────────


def print_table(results: list[dict], top_n: int = 0):
    """表格形式输出"""
    for result in results:
        items = result["items"]
        if top_n > 0:
            items = items[:top_n]

        name = result["name"]
        status = result["status"]

        print(f"\n{'='*65}")
        print(f"  {name} ({result['platform']}) — {status}")
        print(f"{'='*65}")

        if status != "ok":
            print(f"  错误: {result.get('error', '未知错误')}")
            continue

        for item in items:
            print(f"  {item['rank']:>3}. {item['title']}")
            if item.get("url"):
                print(f"       {item['url']}")

    print()


def print_json(results: list[dict], top_n: int = 0):
    """JSON 形式输出"""
    if top_n > 0:
        for r in results:
            r["items"] = r["items"][:top_n]

    output = {
        "fetch_time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "platforms": results,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def print_platform_list():
    """输出支持的平台列表"""
    print("\n支持的平台:")
    print(f"{'ID':<20} {'名称'}")
    print(f"{'-'*20} {'-'*20}")
    for pid, name in sorted(PLATFORM_INFO.items()):
        print(f"{pid:<20} {name}")
    print(f"\n共 {len(PLATFORM_INFO)} 个平台")
    print(f"\n主要中文平台快捷方式 (--all-cn): {', '.join(MAIN_CN_PLATFORMS)}")


# ── 主入口 ──────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="NewsNow 多平台热搜聚合工具")
    parser.add_argument(
        "platforms",
        nargs="*",
        help="平台ID (如: douyin weibo zhihu)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="列出所有支持的平台",
    )
    parser.add_argument(
        "--all-cn",
        action="store_true",
        help="获取所有主要中文平台",
    )
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
        help="每个平台只显示前N条",
    )
    args = parser.parse_args()

    if args.list:
        print_platform_list()
        return

    platforms = args.platforms or []
    if args.all_cn:
        platforms = MAIN_CN_PLATFORMS

    if not platforms:
        parser.print_help()
        sys.exit(1)

    print(
        f"[*] 正在获取 {len(platforms)} 个平台的热搜数据...",
        file=sys.stderr,
    )
    results = fetch_multiple(platforms)

    ok_count = sum(1 for r in results if r["status"] == "ok")
    total_items = sum(len(r["items"]) for r in results)
    print(
        f"[*] 完成: {ok_count}/{len(platforms)} 个平台成功, 共 {total_items} 条",
        file=sys.stderr,
    )

    if args.format == "table":
        print_table(results, args.top)
    else:
        print_json(results, args.top)


if __name__ == "__main__":
    main()
