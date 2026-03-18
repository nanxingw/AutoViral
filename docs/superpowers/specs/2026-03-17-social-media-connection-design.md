# Social Media Connection — Design Spec

> Date: 2026-03-17
> Location: Analytics page, top section

## Problem

Users cannot connect their social media accounts (Douyin, Xiaohongshu) from the AutoViral dashboard. The publish engine and platform adapters exist in code but have never been exposed in the UI. Without connected accounts, publishing and metrics collection cannot work.

## Design

### Frontend: Platform Connection Cards

**Location:** Analytics page (`web/src/pages/Analytics.svelte`), new section at the top above existing stats.

**Layout:** Horizontal card grid, one card per platform.

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  🎵 抖音                │  │  📕 小红书              │
│  ● 已连接               │  │  ○ 未连接               │
│  [断开连接]             │  │  [连接账号]             │
└─────────────────────────┘  └─────────────────────────┘
```

**States:**
- `checking` — orange pulse, "检测中..."
- `connected` — green dot, "已连接", show disconnect button
- `disconnected` — gray dot, "未连接", show connect button
- `connecting` — purple pulse, "扫码中...", browser window is open

**Interaction flow:**
1. Page loads → `GET /api/platforms` → each card shows status
2. Click "连接" → `POST /api/platforms/:name/login` → Playwright opens non-headless browser
3. User scans QR code → login completes → API returns → card turns green
4. Click "断开" → `POST /api/platforms/:name/logout` → clear cookies → card turns gray

### Backend: Platform Status API

**Existing routes (need verification/fixes):**
- `GET /api/platforms` — list platforms with login status
- `POST /api/platforms/:name/login` — open Playwright browser for QR login
- `POST /api/platforms/:name/logout` — clear auth cookies
- `GET /api/platforms/:name/status` — check single platform

**Key implementation in `publish-engine.ts`:**
- `checkLoginStatus(platform)` — headless Playwright, navigate to creator platform, check if redirected to login page
- `openLogin(platform)` — non-headless Playwright, navigate to login page, wait up to 120s for user to scan QR
- Cookie persistence: `launchPersistentContext(userDataDir)` with `userDataDir = ~/.skill-evolver/auth/{platform}/`

**Platform Details (from Playwright testing 2026-03-17):**

| Platform | URL | Login Detection | QR Code Element |
|----------|-----|-----------------|-----------------|
| Douyin | `creator.douyin.com/` | Page has "创作者登录" button → not logged in | `canvas` in `div.item-pOuH0O` (180x180) |
| XHS Creator | `creator.xiaohongshu.com/` | Redirects to `/login` → not logged in | `img.css-wemwzq` icon toggles to QR |
| XHS Main | `xiaohongshu.com/explore` | `button.login-btn` visible → not logged in | `img.qrcode-img` in `div.code-area` |

**Browser approach:** Playwright `launchPersistentContext` with userDataDir at `~/.skill-evolver/auth/{platform}/`.
- First connect: `headless: false`, navigate to login page, user scans QR or enters SMS code
- Subsequent checks: `headless: true`, navigate to creator page, check if login selector is absent
- Cookie persists across restarts in the userDataDir

**Login status detection logic:**
- Douyin: navigate to `creator.douyin.com`, wait 3s, check if `div.btn-IDx0e8` (创作者登录) exists → not logged in; otherwise → logged in
- XHS: navigate to `creator.xiaohongshu.com`, wait 3s, check if URL contains `/login` → not logged in; otherwise → logged in

## Files to Modify

| File | Change |
|------|--------|
| `web/src/pages/Analytics.svelte` | Add platform connection cards section at top |
| `web/src/lib/api.ts` | Add `fetchPlatforms()`, `connectPlatform()`, `disconnectPlatform()` |
| `src/publish-engine.ts` | Implement real `checkLoginStatus()` and `openLogin()` with tested selectors |
| `src/server/api.ts` | Fix platform API routes to call publish engine correctly |

## Verification

1. Start server, go to Analytics page → cards show "检测中..." then resolve to connected/disconnected
2. Click "连接" on disconnected platform → Playwright browser opens login page with QR/SMS
3. Complete login → card turns green
4. Refresh page → card still shows green (persistent context cookie)
5. Click "断开" → card turns gray → refresh confirms disconnected
