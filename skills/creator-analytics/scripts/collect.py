#!/usr/bin/env python3
"""
Creator Analytics — Social media creator data collector.

Usage:
    python3 collect.py --platform douyin --url <URL>       # First time: saves URL
    python3 collect.py --platform douyin                   # After: uses saved URL
    python3 collect.py --platform douyin --list-accounts   # Show saved accounts

Outputs JSON to stdout. Errors go to stderr with exit code 1.
"""

import argparse
import asyncio
import json
import os
import sys

# Allow relative imports when run as script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SUPPORTED_PLATFORMS = ["douyin"]
CONFIG_DIR = os.path.expanduser("~/.config/creator-analytics")
CONFIG_FILE = os.path.join(CONFIG_DIR, "accounts.json")


def error_exit(code: str, message: str, platform: str = ""):
    err = {"error": code, "message": message}
    if platform:
        err["platform"] = platform
    print(json.dumps(err, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)


def load_accounts() -> dict:
    """Load saved accounts config."""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_account(platform: str, url: str, nickname: str = "", sec_user_id: str = ""):
    """Save account info for a platform."""
    os.makedirs(CONFIG_DIR, exist_ok=True)
    accounts = load_accounts()
    accounts[platform] = {
        "url": url,
        "nickname": nickname,
        "sec_user_id": sec_user_id,
    }
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(accounts, f, ensure_ascii=False, indent=2)


def get_saved_url(platform: str) -> str | None:
    """Get saved URL for a platform."""
    accounts = load_accounts()
    entry = accounts.get(platform)
    return entry["url"] if entry else None


SETUP_GUIDES = {
    "douyin": {
        "name": "抖音 (Douyin)",
        "login_url": "https://www.douyin.com",
        "steps": [
            "1. 在浏览器中打开 douyin.com 并登录（扫码或手机号）",
            "2. 登录成功后，完全关闭浏览器（必须关闭，否则无法读取 cookie）",
            "3. 打开抖音 APP → 「我」→ 右上角分享按钮 → 「复制链接」",
            "   链接格式类似: https://v.douyin.com/i2wyU53P/",
            "   或者在网页版打开个人主页，复制地址栏 URL",
            "   格式类似: https://www.douyin.com/user/MS4wLjABAAAA...",
        ],
    },
}


def interactive_setup(platform: str) -> str:
    """Guide user through first-time setup, return the profile URL."""
    guide = SETUP_GUIDES.get(platform)
    if not guide:
        error_exit(
            "PLATFORM_NOT_SUPPORTED",
            f"Platform '{platform}' is not yet supported.",
            platform,
        )

    print(f"\n{'=' * 50}", file=sys.stderr)
    print(f"  Creator Analytics — 首次设置 ({guide['name']})", file=sys.stderr)
    print(f"{'=' * 50}\n", file=sys.stderr)
    print("还没有保存的账号，请按以下步骤操作：\n", file=sys.stderr)

    for step in guide["steps"]:
        print(f"  {step}", file=sys.stderr)

    print(file=sys.stderr)

    # Check if running in a TTY (interactive terminal)
    if not sys.stdin.isatty():
        error_exit(
            "NO_URL",
            "No saved account. Run with --url <profile_url> to set up "
            "(only needed once, will be saved for future use). "
            f"See setup guide for {guide['name']}:\n"
            + "\n".join(f"  {s}" for s in guide["steps"]),
            platform,
        )

    url = input("请粘贴你的个人主页链接: ").strip()

    if not url:
        error_exit("NO_URL", "未输入链接。", platform)

    # Basic URL validation
    if not ("douyin.com" in url or "v.douyin.com" in url):
        error_exit(
            "INVALID_URL",
            f"'{url}' 不像是有效的抖音链接。请提供 douyin.com/user/... 或 v.douyin.com/... 格式的链接。",
            platform,
        )

    print(f"\n  链接已收到，正在获取数据...\n", file=sys.stderr)
    return url


def main():
    parser = argparse.ArgumentParser(
        description="Collect creator analytics from social media platforms"
    )
    parser.add_argument(
        "--platform",
        required=True,
        choices=SUPPORTED_PLATFORMS,
        help="Target platform (currently: douyin)",
    )
    parser.add_argument(
        "--url",
        default=None,
        help="Creator profile URL or share link (saved after first use)",
    )
    parser.add_argument(
        "--browser",
        default="chrome",
        choices=["chrome", "firefox", "edge"],
        help="Browser for cookie extraction (default: chrome)",
    )
    parser.add_argument(
        "--max-posts",
        type=int,
        default=None,
        help="Max posts to collect (default: all)",
    )
    parser.add_argument(
        "--list-accounts",
        action="store_true",
        help="List saved accounts and exit",
    )

    args = parser.parse_args()

    # List saved accounts
    if args.list_accounts:
        accounts = load_accounts()
        if not accounts:
            print(json.dumps({"message": "No saved accounts. Use --url to add one."}, ensure_ascii=False))
        else:
            print(json.dumps(accounts, ensure_ascii=False, indent=2))
        return

    # Resolve URL: explicit > saved > interactive guide
    url = args.url
    if not url:
        url = get_saved_url(args.platform)
        if not url:
            url = interactive_setup(args.platform)

    # Check dependencies
    try:
        import browser_cookie3  # noqa: F401
        import f2  # noqa: F401
    except ImportError as e:
        error_exit(
            "DEPENDENCY_ERROR",
            f"Missing dependency: {e}. Run: pip3 install f2 browser_cookie3",
            args.platform,
        )

    # Dynamic platform import
    if args.platform == "douyin":
        from platforms.douyin import DouyinCollector as Collector
    else:
        error_exit(
            "PLATFORM_NOT_SUPPORTED",
            f"Platform '{args.platform}' is not yet supported. Available: {', '.join(SUPPORTED_PLATFORMS)}",
            args.platform,
        )

    collector = Collector(browser=args.browser)

    # Validate cookies
    valid, err = collector.validate_cookies()
    if not valid:
        error_exit(err["code"], err["message"], args.platform)

    # Collect data
    try:
        result = asyncio.run(collector.collect(url, max_posts=args.max_posts))

        # Save account info for next time
        account = result.get("account", {})
        save_account(
            args.platform,
            url=url,
            nickname=account.get("nickname", ""),
            sec_user_id=account.get("sec_user_id", ""),
        )

        print(json.dumps(result, ensure_ascii=False, indent=2))
    except ValueError as e:
        error_exit("INVALID_URL", str(e), args.platform)
    except RuntimeError as e:
        error_exit("API_ERROR", str(e), args.platform)
    except Exception as e:
        error_exit("API_ERROR", f"Unexpected error: {e}", args.platform)


if __name__ == "__main__":
    main()
