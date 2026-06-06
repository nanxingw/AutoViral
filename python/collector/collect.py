#!/usr/bin/env python3
"""
Douyin creator-analytics collector — PRD-0006 §D4 (slice S5).

Restored from the pre-refactor f2 + browser_cookie3 scraper
(git tag pre-skill-rewrite-snapshot:
 skills/autoviral/modules/research/scripts/creator-analytics/). It now ships as
bundled workstation infrastructure (python/collector/) and runs under the
MANAGED venv (~/.autoviral/collector-venv) that slice S4 provisions, NOT the
host interpreter — see src/infra/collector-env.ts.

Usage:
    python3 collect.py --url <douyin profile URL or share link> [--browser chrome]

Output contract (consumed by the PURE D4 parse boundary in
src/domain/collector-parse.ts):
    * On SUCCESS: prints ONE JSON object (the CreatorData shape) to STDOUT,
      exit 0.
    * On FAILURE: prints ONE JSON error envelope {"error", "message",
      "platform"} to STDOUT and exits 0 (NOT non-zero / stderr). Emitting the
      structured error on stdout lets the TS side parse a single stream and map
      auth/cookie failures to an actionable "re-login" prompt instead of a
      generic crash. (The old version used stderr+exit-1; the boundary now
      reads stdout for both.)

Cookies/tokens stay LOCAL: browser_cookie3 reads the user's already-logged-in
douyin.com sessionid out of their own browser; nothing is uploaded or persisted
by this script beyond the JSON it prints.
"""

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone


def emit_error(code: str, message: str, platform: str = "douyin") -> None:
    """Print a structured error envelope to STDOUT and exit 0.

    The TS parse boundary (parseCollectorResult) recognises this shape and maps
    NOT_LOGGED_IN / COOKIE_NOT_FOUND (and cookie-expiry API_ERRORs) to a
    re-login prompt. Exit 0 (not 1) so the envelope is read as data, not noise.
    """
    print(
        json.dumps({"error": code, "message": message, "platform": platform}, ensure_ascii=False),
        flush=True,
    )
    sys.exit(0)


def emit_success(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    sys.exit(0)


COOKIE_DOMAIN = ".douyin.com"
REQUIRED_COOKIE = "sessionid"


def read_cookies(browser: str):
    """Extract & validate douyin.com cookies from the user's browser.

    Returns the cookie string, or calls emit_error() and never returns.
    """
    try:
        import browser_cookie3
    except ImportError as e:  # the managed venv should have this (S4); be honest if not.
        emit_error(
            "DEPENDENCY_ERROR",
            f"Missing dependency: {e}. Run `autoviral setup` to provision the collector venv.",
        )

    browser_fn = {
        "chrome": browser_cookie3.chrome,
        "firefox": browser_cookie3.firefox,
        "edge": browser_cookie3.edge,
    }.get(browser)
    if not browser_fn:
        emit_error("BROWSER_NOT_FOUND", f"Unsupported browser: {browser}. Use chrome, firefox, or edge.")

    try:
        cj = browser_fn(domain_name=COOKIE_DOMAIN)
    except PermissionError:
        emit_error(
            "COOKIE_NOT_FOUND",
            f"Cannot read {browser} cookies. Make sure {browser} is fully closed, then retry.",
        )
    except Exception as e:  # noqa: BLE001
        emit_error("COOKIE_NOT_FOUND", f"Cannot read cookies from {browser}: {e}")

    cookies = {c.name: c.value for c in cj}
    if REQUIRED_COOKIE not in cookies or not cookies[REQUIRED_COOKIE]:
        emit_error(
            "NOT_LOGGED_IN",
            "No valid session found. Log in to douyin.com in your browser first, "
            "then close the browser and retry.",
        )
    return "; ".join(f"{k}={v}" for k, v in cookies.items())


def build_kwargs(cookie_str: str) -> dict:
    return {
        "headers": {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "Referer": "https://www.douyin.com/",
            "Cookie": cookie_str,
        },
        "proxies": {"http://": None, "https://": None},
        "cookie": cookie_str,
    }


def fmt_ts(ts) -> str:
    try:
        return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError, OSError):
        return str(ts)


def compute_summary(works: list, follower_count: int) -> dict:
    if not works:
        return {
            "total_works_collected": 0,
            "avg_play": 0,
            "avg_digg": 0,
            "avg_comment": 0,
            "avg_share": 0,
            "avg_collect": 0,
            "engagement_rate": 0,
        }
    n = len(works)

    def avg(key):
        return sum(w.get(key, 0) for w in works) // n

    avg_play = avg("play_count")
    avg_digg = avg("digg_count")
    avg_comment = avg("comment_count")
    avg_share = avg("share_count")
    avg_collect = avg("collect_count")
    total_engagement = avg_digg + avg_comment + avg_share + avg_collect
    engagement_rate = round(total_engagement / avg_play, 4) if avg_play > 0 else 0
    return {
        "total_works_collected": n,
        "avg_play": avg_play,
        "avg_digg": avg_digg,
        "avg_comment": avg_comment,
        "avg_share": avg_share,
        "avg_collect": avg_collect,
        "engagement_rate": engagement_rate,
    }


async def collect(url: str, cookie_str: str, max_posts=None) -> dict:
    # Quiet f2's internal logging so stdout stays a single clean JSON doc.
    import logging

    logging.disable(logging.WARNING)

    from f2.apps.douyin.crawler import DouyinCrawler
    from f2.apps.douyin.filter import UserProfileFilter, UserPostFilter
    from f2.apps.douyin.model import UserPost, UserProfile
    from f2.apps.douyin.utils import SecUserIdFetcher

    # 1. URL → sec_user_id
    try:
        sec_user_id = await SecUserIdFetcher.get_sec_user_id(url)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Cannot resolve URL '{url}'. Provide a valid Douyin profile URL or share link. ({e})")
    if not sec_user_id:
        raise ValueError(
            f"Cannot extract sec_user_id from '{url}'. Expected "
            "https://www.douyin.com/user/MS4wLjAB... or https://v.douyin.com/..."
        )

    kwargs = build_kwargs(cookie_str)

    # 2. profile
    async with DouyinCrawler(kwargs) as crawler:
        profile_resp = await crawler.fetch_user_profile(UserProfile(sec_user_id=sec_user_id))
    profile = UserProfileFilter(profile_resp)
    if profile.nickname is None:
        raise RuntimeError("Profile fetch failed — cookie may be expired. Re-login and retry.")

    account = {
        "sec_user_id": sec_user_id,
        "nickname": profile.nickname,
        "signature": profile.signature or "",
        "uid": profile.uid,
        "unique_id": getattr(profile, "unique_id", ""),
        "follower_count": profile.follower_count or 0,
        "following_count": profile.following_count or 0,
        "total_favorited": profile.total_favorited or 0,
        "aweme_count": profile.aweme_count or 0,
    }

    # 3. posts (read stats from raw aweme_list — no per-post calls)
    works = []
    max_cursor = 0
    limit = max_posts if max_posts else float("inf")
    async with DouyinCrawler(kwargs) as crawler:
        while len(works) < limit:
            resp = await crawler.fetch_user_post(
                UserPost(sec_user_id=sec_user_id, max_cursor=max_cursor, count=20)
            )
            post_filter = UserPostFilter(resp)
            if not post_filter.has_aweme:
                break
            raw = post_filter._to_raw()
            for aweme in raw.get("aweme_list", []):
                if len(works) >= limit:
                    break
                stats = aweme.get("statistics", {})
                works.append({
                    "aweme_id": aweme.get("aweme_id", ""),
                    "desc": aweme.get("desc", ""),
                    "create_time": fmt_ts(aweme.get("create_time", 0)),
                    "aweme_type": aweme.get("aweme_type", 0),
                    "play_count": stats.get("play_count", 0),
                    "digg_count": stats.get("digg_count", 0),
                    "comment_count": stats.get("comment_count", 0),
                    "share_count": stats.get("share_count", 0),
                    "collect_count": stats.get("collect_count", 0),
                })
            if not post_filter.has_more:
                break
            max_cursor = post_filter.max_cursor

    return {
        "platform": "douyin",
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "account": account,
        "works": works,
        "summary": compute_summary(works, account["follower_count"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect Douyin creator analytics")
    parser.add_argument("--url", required=True, help="Douyin profile URL or share link")
    parser.add_argument("--browser", default="chrome", choices=["chrome", "firefox", "edge"])
    parser.add_argument("--max-posts", type=int, default=None)
    args = parser.parse_args()

    if not ("douyin.com" in args.url or "v.douyin.com" in args.url):
        emit_error("INVALID_URL", f"'{args.url}' is not a valid Douyin profile URL or share link.")

    cookie_str = read_cookies(args.browser)

    try:
        result = asyncio.run(collect(args.url, cookie_str, max_posts=args.max_posts))
    except ValueError as e:
        emit_error("INVALID_URL", str(e))
    except RuntimeError as e:
        # f2's "profile fetch failed — cookie may be expired" lands here; the TS
        # boundary maps cookie-expiry API_ERRORs to a re-login prompt.
        emit_error("API_ERROR", str(e))
    except Exception as e:  # noqa: BLE001
        emit_error("API_ERROR", f"Unexpected error: {e}")

    emit_success(result)


if __name__ == "__main__":
    main()
