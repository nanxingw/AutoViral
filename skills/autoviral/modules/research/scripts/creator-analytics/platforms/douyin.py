"""Douyin (抖音) creator analytics collector using f2 library."""

import asyncio
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import browser_cookie3
from f2.apps.douyin.crawler import DouyinCrawler
from f2.apps.douyin.filter import UserProfileFilter, UserPostFilter
from f2.apps.douyin.model import UserPost, UserProfile
from f2.apps.douyin.utils import SecUserIdFetcher

from . import BaseCollector

# Suppress f2's internal logging to keep stdout clean for JSON
import logging

logging.disable(logging.WARNING)


class DouyinCollector(BaseCollector):
    PLATFORM = "douyin"
    COOKIE_DOMAIN = ".douyin.com"
    REQUIRED_COOKIE = "sessionid"

    def __init__(self, browser: str = "chrome"):
        super().__init__(browser)
        self._cookie_str: Optional[str] = None

    def validate_cookies(self) -> Tuple[bool, Optional[Dict]]:
        """Extract and validate Douyin cookies from the user's browser."""
        browser_fn = {
            "chrome": browser_cookie3.chrome,
            "firefox": browser_cookie3.firefox,
            "edge": browser_cookie3.edge,
        }.get(self.browser)

        if not browser_fn:
            return False, {
                "code": "BROWSER_NOT_FOUND",
                "message": f"Unsupported browser: {self.browser}. Use chrome, firefox, or edge.",
            }

        try:
            cj = browser_fn(domain_name=self.COOKIE_DOMAIN)
        except PermissionError:
            return False, {
                "code": "COOKIE_NOT_FOUND",
                "message": f"Cannot read {self.browser} cookies. Make sure {self.browser} is fully closed, then retry.",
            }
        except Exception as e:
            return False, {
                "code": "COOKIE_NOT_FOUND",
                "message": f"Cannot read cookies from {self.browser}: {e}",
            }

        cookies = {c.name: c.value for c in cj}

        if self.REQUIRED_COOKIE not in cookies or not cookies[self.REQUIRED_COOKIE]:
            return False, {
                "code": "NOT_LOGGED_IN",
                "message": "No valid session found. Log in to douyin.com in your browser first, then close the browser and retry.",
            }

        self._cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
        return True, None

    def _build_kwargs(self) -> Dict:
        return {
            "headers": {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36",
                "Referer": "https://www.douyin.com/",
                "Cookie": self._cookie_str,
            },
            "proxies": {"http://": None, "https://": None},
            "cookie": self._cookie_str,
        }

    async def collect(self, url: str, max_posts: Optional[int] = None) -> Dict:
        # 1. Resolve URL → sec_user_id
        try:
            sec_user_id = await SecUserIdFetcher.get_sec_user_id(url)
        except Exception as e:
            raise ValueError(
                f"Cannot resolve URL '{url}'. Provide a valid Douyin profile URL or share link. ({e})"
            )

        if not sec_user_id:
            raise ValueError(
                f"Cannot extract sec_user_id from '{url}'. "
                "Expected format: https://www.douyin.com/user/MS4wLjAB... or https://v.douyin.com/..."
            )

        kwargs = self._build_kwargs()

        # 2. Fetch profile
        async with DouyinCrawler(kwargs) as crawler:
            profile_resp = await crawler.fetch_user_profile(
                UserProfile(sec_user_id=sec_user_id)
            )

        profile = UserProfileFilter(profile_resp)

        if profile.nickname is None:
            raise RuntimeError(
                "Profile fetch failed — cookie may be expired. Re-login and retry."
            )

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

        # 3. Fetch posts (with stats from raw response)
        works = await self._fetch_all_posts(kwargs, sec_user_id, max_posts)

        # 4. Compute summary
        summary = self._compute_summary(works, account["follower_count"])

        return {
            "platform": self.PLATFORM,
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "account": account,
            "works": works,
            "summary": summary,
        }

    async def _fetch_all_posts(
        self, kwargs: Dict, sec_user_id: str, max_posts: Optional[int] = None
    ) -> List[Dict]:
        """Fetch user posts with engagement stats via pagination.

        Reads statistics directly from the raw API response's aweme_list,
        avoiding per-post API calls.
        """
        works: List[Dict] = []
        max_cursor = 0
        limit = max_posts if max_posts else float("inf")

        async with DouyinCrawler(kwargs) as crawler:
            while len(works) < limit:
                params = UserPost(
                    sec_user_id=sec_user_id, max_cursor=max_cursor, count=20
                )
                resp = await crawler.fetch_user_post(params)
                post_filter = UserPostFilter(resp)

                if not post_filter.has_aweme:
                    break

                # Access raw response to get statistics
                raw = post_filter._to_raw()
                aweme_list = raw.get("aweme_list", [])

                for aweme in aweme_list:
                    if len(works) >= limit:
                        break

                    stats = aweme.get("statistics", {})
                    works.append(
                        {
                            "aweme_id": aweme.get("aweme_id", ""),
                            "desc": aweme.get("desc", ""),
                            "create_time": self._format_timestamp(
                                aweme.get("create_time", 0)
                            ),
                            "aweme_type": aweme.get("aweme_type", 0),
                            "play_count": stats.get("play_count", 0),
                            "digg_count": stats.get("digg_count", 0),
                            "comment_count": stats.get("comment_count", 0),
                            "share_count": stats.get("share_count", 0),
                            "collect_count": stats.get("collect_count", 0),
                        }
                    )

                if not post_filter.has_more:
                    break
                max_cursor = post_filter.max_cursor

        return works

    @staticmethod
    def _format_timestamp(ts) -> str:
        try:
            return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError, OSError):
            return str(ts)

    @staticmethod
    def _compute_summary(works: List[Dict], follower_count: int) -> Dict:
        if not works:
            return {"total_works_collected": 0}

        n = len(works)

        def avg(key):
            return sum(w.get(key, 0) for w in works) // n

        avg_play = avg("play_count")
        avg_digg = avg("digg_count")
        avg_comment = avg("comment_count")
        avg_share = avg("share_count")
        avg_collect = avg("collect_count")

        total_engagement = avg_digg + avg_comment + avg_share + avg_collect
        engagement_rate = (
            round(total_engagement / avg_play, 4) if avg_play > 0 else 0
        )

        return {
            "total_works_collected": n,
            "avg_play": avg_play,
            "avg_digg": avg_digg,
            "avg_comment": avg_comment,
            "avg_share": avg_share,
            "avg_collect": avg_collect,
            "engagement_rate": engagement_rate,
        }
