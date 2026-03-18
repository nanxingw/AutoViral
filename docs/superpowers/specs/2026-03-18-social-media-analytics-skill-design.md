# Social Media Analytics Skill — Design Spec

**Date**: 2026-03-18
**Status**: Approved
**Scope**: Claude Code skill for automated social media analytics collection

## Overview

A Claude Code skill that uses Playwright to connect to the user's system Chrome browser via CDP (Chrome DevTools Protocol), navigates to Douyin and Xiaohongshu creator dashboards, and collects the user's own content analytics data.

## Requirements

- **Platforms**: Douyin (抖音) creator center, Xiaohongshu (小红书) creator center
- **Authentication**: Reuse system Chrome browser's existing login state via Playwright `connectOverCDP`
- **Data scope**: Creator dashboard data only (own account analytics)
- **Interface**: Claude Code skill — AI invokes Node.js scripts from terminal
- **Transparency**: User sees agent's browser operations in real-time (their own Chrome)

## Architecture

### Browser Connection Strategy

1. Detect if Chrome is listening on remote debugging port (9222)
2. If not, launch Chrome with `--remote-debugging-port=9222` using the user's default profile directory (preserves all existing logins)
3. Connect via `playwright.chromium.connectOverCDP("http://localhost:9222")`
4. Open new tabs for data collection (user can watch in real-time)
5. Close tabs when done (leave browser open)

### Login Handling

- Check login state by navigating to creator center and verifying no redirect to login page
- If not logged in: open login page in browser, print terminal message "请在浏览器中扫码登录", poll for login completion (120s timeout)
- Cookies persist in user's Chrome profile — no separate cookie storage needed

## Data Collection Targets

### Douyin Creator Center (`https://creator.douyin.com`)

| Data Point | Source Page |
|-----------|------------|
| Works list (title, publish date, cover) | 内容管理 page |
| Per-work: views, likes, comments, shares, favorites | 内容管理 or 数据概览 |
| Account overview: follower count, total views | 首页/数据概览 |
| Trends (7d/30d) | 数据概览 |

### Xiaohongshu Creator Center (`https://creator.xiaohongshu.com`)

| Data Point | Source Page |
|-----------|------------|
| Notes list (title, publish date, cover) | 内容管理 page |
| Per-note: reads, likes, favorites, comments, shares | 内容管理 or 数据中心 |
| Account overview: follower count, total engagement | 首页/数据中心 |
| Trends (7d/30d) | 数据中心 |

### Output Format

```json
{
  "platform": "douyin",
  "collectedAt": "2026-03-18T10:00:00Z",
  "account": {
    "followers": 12345,
    "totalViews": 678900
  },
  "works": [
    {
      "title": "视频标题",
      "publishedAt": "2026-03-15",
      "views": 5000,
      "likes": 200,
      "comments": 50,
      "shares": 30,
      "favorites": 100,
      "url": "https://..."
    }
  ]
}
```

## File Structure

```
~/.claude/skills/social-media-analytics/
├── SKILL.md                    # Skill documentation and usage instructions
└── scripts/
    ├── connect-browser.mjs     # Chrome CDP connection management
    ├── collect-douyin.mjs      # Douyin data collection
    ├── collect-xiaohongshu.mjs # Xiaohongshu data collection
    └── collect-all.mjs         # Unified entry: collect from all platforms
```

### Script Responsibilities

- **connect-browser.mjs**: Detect Chrome debugging port → launch if needed → Playwright CDP connect → return browser object. Exports `connectBrowser()` and `closeBrowser()` functions.
- **collect-douyin.mjs**: Connect browser → check Douyin login → navigate creator center → scrape works list + metrics → output JSON to stdout
- **collect-xiaohongshu.mjs**: Same flow for Xiaohongshu
- **collect-all.mjs**: Run both platform collectors sequentially, output combined JSON

### Invocation

```bash
# Collect all platforms
node ~/.claude/skills/social-media-analytics/scripts/collect-all.mjs

# Single platform
node ~/.claude/skills/social-media-analytics/scripts/collect-douyin.mjs
node ~/.claude/skills/social-media-analytics/scripts/collect-xiaohongshu.mjs
```

## Error Handling

| Scenario | Handling |
|----------|---------|
| Chrome not installed | Error message with install guidance |
| Port 9222 occupied by non-Chrome | Detect via HTTP check, report conflict |
| Not logged in | Open login page, terminal prompt "请在浏览器中扫码登录", poll 120s |
| Page selectors fail | Fallback selectors → screenshot + error report |
| Network timeout | Retry once → skip platform on second failure |
| Creator center UI changes | Screenshot on failure for debugging |

## Technical Notes

- **Playwright dependency**: Already in project as optional dep (v1.49.0)
- **Chrome profile detection**: Use platform-specific default paths:
  - macOS: `~/Library/Application Support/Google/Chrome/Default`
  - Linux: `~/.config/google-chrome/Default`
- **Anti-detection**: Using real Chrome with real profile = strongest anti-detection; no stealth plugins needed
- **macOS Chrome launch**: `open -a "Google Chrome" --args --remote-debugging-port=9222`

## Testing Plan

1. Test Chrome CDP connection on macOS
2. Test login detection for both platforms
3. Test data collection with a real logged-in account
4. Test error cases (no Chrome, not logged in, selectors fail)
