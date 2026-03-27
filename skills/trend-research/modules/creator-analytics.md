---
name: creator-analytics
description: "Collect social media creator analytics data (profile stats + per-post engagement metrics). Platforms: Douyin (抖音), with Xiaohongshu (小红书) planned."
---

# Creator Analytics

Collects creator profile and per-post engagement data from social media platforms. Currently supports **Douyin (抖音)**. Outputs structured JSON.

## Prerequisites

```bash
python3 -c "import f2, browser_cookie3; print('OK')"
```

If missing: `pip3 install f2 browser_cookie3`

## Workflow

### 1. Get the creator's profile URL (first time only)

The URL is **only needed on first use** — it gets saved to `~/.config/creator-analytics/accounts.json` automatically. On subsequent runs, just omit `--url`.

Ask the user for their profile URL. Accepted formats:

- **Full URL**: `https://www.douyin.com/user/MS4wLjABAAAA...`
- **Share link**: `https://v.douyin.com/i2wyU53P/`
- User can get this by opening Douyin APP → Profile → Share → Copy Link

### 2. Remind user to close Chrome

**IMPORTANT**: `browser_cookie3` needs exclusive access to Chrome's cookie database. The user must fully close Chrome before running the collector.

### 3. Run the collector

```bash
# First time — provide URL (auto-saved for future use):
python3 skills/trend-research/scripts/creator-analytics/collect.py \
  --platform douyin \
  --url "<PROFILE_URL>"

# After first time — just run without --url:
python3 skills/trend-research/scripts/creator-analytics/collect.py \
  --platform douyin

# Check saved accounts:
python3 skills/trend-research/scripts/creator-analytics/collect.py \
  --platform douyin --list-accounts
```

**Options:**

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--platform` | Yes | — | Target platform: `douyin` |
| `--url` | No | saved | Creator profile URL (saved after first use) |
| `--browser` | No | `chrome` | Browser for cookies: `chrome`, `firefox`, `edge` |
| `--max-posts` | No | all | Limit number of posts to fetch |
| `--list-accounts` | No | — | Show saved accounts and exit |

### 4. Parse output and present results

The script outputs JSON to **stdout**. Errors go to **stderr** with exit code 1.

**Present results as:**
1. **Account overview** — nickname, followers, total likes, video count
2. **Engagement summary** — avg plays, likes, comments, shares, collects per post; engagement rate
3. **Top posts** — sort by play_count or digg_count, show top 5
4. **Trends** — if data spans multiple months, note growth patterns

### Output Schema

```json
{
  "platform": "douyin",
  "collected_at": "2026-03-19T10:30:00+00:00",
  "account": {
    "sec_user_id": "MS4wLjAB...",
    "nickname": "创作者昵称",
    "signature": "个人简介",
    "follower_count": 125000,
    "following_count": 320,
    "total_favorited": 5600000,
    "aweme_count": 186
  },
  "works": [
    {
      "aweme_id": "7341...",
      "desc": "视频描述",
      "create_time": "2026-03-15 14:30:00",
      "play_count": 89200,
      "digg_count": 45200,
      "comment_count": 1230,
      "share_count": 890,
      "collect_count": 3400
    }
  ],
  "summary": {
    "total_works_collected": 186,
    "avg_play": 52000,
    "avg_digg": 24300,
    "avg_comment": 670,
    "avg_share": 430,
    "avg_collect": 1800,
    "engagement_rate": 0.0216
  }
}
```

### Error Handling

| Code | Cause | Fix |
|------|-------|-----|
| `DEPENDENCY_ERROR` | f2 or browser_cookie3 not installed | `pip3 install f2 browser_cookie3` |
| `BROWSER_NOT_FOUND` | Unsupported browser | Use `--browser chrome` |
| `COOKIE_NOT_FOUND` | Can't read cookie DB | Close browser completely, retry |
| `NOT_LOGGED_IN` | No session cookie | Log in to douyin.com in browser, close it, retry |
| `INVALID_URL` | URL not recognized | Use valid Douyin profile URL |
| `API_ERROR` | API request failed | Cookie expired — re-login and retry |

## Supported Platforms

| Platform | Status | Flag |
|----------|--------|------|
| Douyin (抖音) | Supported | `--platform douyin` |
| Xiaohongshu (小红书) | Planned | `--platform xiaohongshu` |

## Architecture

```
scripts/creator-analytics/
├── collect.py              # CLI entry point
└── platforms/
    ├── __init__.py          # BaseCollector abstract class
    └── douyin.py            # Douyin collector (f2 + browser_cookie3)
```

To add a new platform: create `platforms/<name>.py` implementing `BaseCollector`, and register it in `collect.py`.
