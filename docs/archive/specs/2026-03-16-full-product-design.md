# AutoViral Full Product Design Spec

> **Date**: 2026-03-16
> **Branch**: feat/full-product
> **Goal**: Transform AutoViral from a mock UI into a fully functional content creation platform with a closed loop: Create → Publish → Measure → Learn → Create Better

## Overview

AutoViral is a local-first AI content creation platform for social media creators. It uses Claude Code CLI (via persistent WebSocket sessions) as the AI engine, Playwright for browser automation (publishing + data collection), and EverMemOS for long-term memory.

### Closed Loop

```
Create (Claude CLI) → Publish (Playwright) → Measure (Playwright scraper) → Learn (EverMemOS) → Create Better (memory-injected prompt)
```

### Key Technical Decisions

- **Agent sessions**: Use `--sdk-url` WebSocket pattern from pneuma-skills for persistent multi-turn CLI sessions (not one-shot executor)
- **Publishing**: Playwright `launchPersistentContext()` for cookie-based login persistence, browser automation for Xiaohongshu and Douyin
- **Memory**: EverMemOS API via evermem-async client pattern, not local storage
- **Coexistence**: WsBridge for content creation sessions, existing executor for evolution cycles — both share the Hono server

---

## Module 1: WsBridge — Agent Session Manager

**New file**: `src/ws-bridge.ts`

### Purpose

Replace one-shot executor pattern with persistent Claude CLI sessions for content creation. Each Work gets a dedicated CLI session that supports multi-turn dialogue.

### How It Works

1. `createSession(workId, initialPrompt)` spawns Claude CLI with `--sdk-url ws://localhost:3271/ws/cli/{workId} --print --output-format stream-json --input-format stream-json -p ""`
2. CLI connects back as WebSocket client, sends `system.init` with `session_id`
3. Backend sends initial prompt (including EverMemOS memory context) as NDJSON user message
4. Agent streams response via WebSocket — forwarded to browser via `/ws/browser/{workId}`
5. User sends feedback in Chat Panel → backend forwards as next turn → Agent retains full context
6. On close/restart: persist `cliSessionId` → next open uses `--resume {cliSessionId}`

### API Surface

| Method | Purpose |
|--------|---------|
| `createSession(workId, initialPrompt)` | Spawn CLI, return session. Injects EverMemOS memory. |
| `resumeSession(workId)` | Respawn CLI with --resume using stored cliSessionId. |
| `sendMessage(workId, text)` | Send user message to active CLI session. |
| `killSession(workId)` | Gracefully terminate CLI, persist sessionId. |
| `getSession(workId)` | Return state: idle/busy, cliSessionId. |
| `onEvent(workId, handler)` | Subscribe to CLI events (stream, tool_use, result). |

### WebSocket Routes

- `/ws/cli/:workId` — CLI connects here (NDJSON protocol)
- `/ws/browser/:workId` — Frontend connects here (JSON protocol)
- `/ws` — Existing executor broadcast (unchanged)

### WebSocket Routing Implementation

The existing `ws.ts` uses `WebSocketServer({ path: "/ws" })` which only handles exact path matching. To support parameterized routes (`/ws/cli/:workId`, `/ws/browser/:workId`), the implementation must:

1. Create a single `WebSocketServer` with `noServer: true`
2. Handle the HTTP server's `upgrade` event manually
3. Parse the URL to route to the correct handler (cli, browser, or legacy executor)

### Environment

Must set `CLAUDECODE=undefined` in spawned process env to prevent CLI from thinking it's inside an agent context.

### Prerequisites & Risk Mitigation

**`--sdk-url` validation (CRITICAL)**: Before implementing WsBridge, create a proof-of-concept script (`scripts/test-sdk-url.ts`) that:
1. Starts a local WebSocket server
2. Spawns `claude --sdk-url ws://localhost:PORT/test --print --output-format stream-json --input-format stream-json -p ""`
3. Confirms CLI connects back, sends `system.init`, and accepts multi-turn messages
4. Documents the required Claude CLI version

**Fallback strategy**: If `--sdk-url` is unavailable, fall back to stdin/stdout pipe-based multi-turn using `--input-format stream-json` over pipes (send NDJSON user messages to stdin, read stream-json from stdout). This is less robust but functional.

### Resume Error Handling

`cliSessionId` is persisted in `work.yaml`. When `resumeSession(workId)` is called:
1. Read `cliSessionId` from work.yaml
2. Spawn CLI with `--resume {cliSessionId}`
3. If CLI exits within 5 seconds (resume failed): clear `cliSessionId`, create a new session
4. For new session: inject full chat history from `chat-log.jsonl` as system context so Agent has prior conversation awareness

---

## Module 2: Work Store — Content Persistence

**New file**: `src/work-store.ts`

### Purpose

Replace mock gallery with real YAML-based work storage. Each Work is a content piece that moves through a pipeline from draft to published.

### Data Model (work.yaml)

```yaml
id: work_a1b2c3
title: "打工人必备的3个AI神器"
type: short-video          # short-video | image-text | long-video | livestream
status: published          # draft | creating | ready | publishing | published | failed
platforms:
  - name: xiaohongshu
    publishedAt: "2026-03-15T10:30:00Z"
    postUrl: "https://..."
    metrics:
      views: 12400
      likes: 892
      comments: 156
      shares: 43
      lastUpdated: "2026-03-16T08:00:00Z"
    metricsHistory:
      - { timestamp: "...", views: 120, likes: 15, comments: 3 }
      - { timestamp: "...", views: 890, likes: 87, comments: 23 }
pipeline:
  step1_topic:
    status: completed
    result: "短视频选题：..."
    completedAt: "2026-03-14T09:00:00Z"
  step2_remix:
    status: completed
    result: "..."
  # ... step3 through step6
cliSessionId: "sess_xyz789"
coverImage: "/works/a1b2c3/cover.jpg"
createdAt: "2026-03-14T08:30:00Z"
updatedAt: "2026-03-16T08:00:00Z"
```

### File System

```
~/.skill-evolver/works/
├── works.yaml              # index of all works
├── work_a1b2c3/
│   ├── work.yaml           # full work data
│   ├── assets/             # generated images, videos, scripts
│   └── chat-log.jsonl      # conversation history backup
```

### Content Type Pipelines

| Type | Steps | Target Platforms |
|------|-------|-----------------|
| **short-video** | 爆款选题 → 趋势混搭 → 差异化分析 → 脚本分镜 → 视频制作指导 → 发布+复盘 | 抖音, 小红书 |
| **image-text** | 选题策划 → 文案撰写 → 图片规划 → 排版设计指导 → 封面优化 → 发布+复盘 | 小红书 |
| **long-video** | 主题研究 → 大纲编排 → 详细脚本 → 分镜头脚本 → 后期指导 → 发布+复盘 | YouTube, B站 |
| **livestream** | 直播主题 → 流程编排 → 话术脚本 → 互动设计 → 预热文案 → 预约+复盘 | 抖音, 小红书 |

### State Machine

```
draft → creating → ready → publishing → published
         ↓    ↑      ↓         ↓
       failed  └── ready    failed
                (user revises)
```

Note: `ready → creating` transition is triggered when a user sends a chat message or clicks "Redo" on a pipeline step after all steps were completed.

### Concurrency

Each work has its own `work.yaml` file — no shared write contention. The `works.yaml` index file is a lightweight list (id + title + status + type) that is atomically rewritten on create/delete. Multiple concurrent reads are safe; writes to different work directories are independent.

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/works` | GET | List all works |
| `/api/works` | POST | Create new work {title, type, platforms} |
| `/api/works/:id` | GET/PUT/DELETE | CRUD work |
| `/api/works/:id/assets` | GET | List assets |
| `/api/works/:id/assets/:f` | GET | Serve asset file |
| `/api/works/:id/chat` | POST | Send message to CLI session (convenience wrapper for WsBridge.sendMessage; frontend should prefer WebSocket for streaming) |
| `/api/works/:id/step/:n` | POST | Trigger pipeline step N |
| `/api/works/:id/publish` | POST | Trigger publish to selected platforms |

---

## Module 3: Publish Engine — Playwright Automation

**New files**: `src/publish-engine.ts`, `src/platforms/base.ts`, `src/platforms/xiaohongshu.ts`, `src/platforms/douyin.ts`

### Purpose

Automated publishing to Xiaohongshu and Douyin via Playwright browser control.

### Login Management

Strategy: `chromium.launchPersistentContext(userDataDir)` with per-platform user data dirs at `~/.skill-evolver/auth/{platform}/`.

- First login: open visible browser (`headless: false`), user scans QR code
- Subsequent publishes: headless, cookies auto-reused
- Login check before every publish: if expired, prompt user to re-login

### PlatformAdapter Interface

```typescript
interface PlatformAdapter {
  name: string
  loginUrl: string
  publishUrl: string
  checkLogin(page: Page): Promise<boolean>
  login(page: Page): Promise<void>
  publish(page: Page, content: PublishContent): Promise<PublishResult>
  scrapeMetrics(page: Page, postUrl: string): Promise<Metrics>
  scrapeTrending(page: Page): Promise<TrendData>
  scrapeCompetitor(page: Page, profileUrl: string): Promise<CompetitorData>
}
```

### Content Formatting

| Platform | Short Video | Image-Text | Limits |
|----------|------------|------------|--------|
| 小红书 | 视频 + 标题 + 正文 + 话题 + 封面 | 多图(≤18) + 标题 + 正文 + 话题 | 标题≤20字, 正文≤1000字, 话题≤10 |
| 抖音 | 视频 + 描述 + 话题 + 封面 + 定位 | 多图 + 描述 + 音乐(可选) | 描述≤4000字, 视频≤15min, 话题≤5 |

### Safety

- User must confirm before publishing (no auto-publish)
- Screenshot every publish for audit trail
- Rate limit: max 5 publishes per platform per day
- Dry-run mode: fill form but don't click submit
- Visible browser for first login (no credential storage)

### Playwright as Optional Dependency

Playwright adds ~300MB of browser binaries. To avoid bloating the npm install for users who don't need publishing:
- `playwright` is listed in `optionalDependencies` (not `dependencies`)
- On first publish attempt, check if Playwright is installed; if not, prompt user to run `npx playwright install chromium`
- All Playwright imports use dynamic `import()` with try/catch
- Modules 3 and 4 gracefully degrade: if Playwright is unavailable, publish and scrape features are disabled with clear UI messaging

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/platforms` | GET | List platforms + login status |
| `/api/platforms/:name/login` | POST | Open visible browser for QR login |
| `/api/platforms/:name/status` | GET | Check if logged in |

---

## Module 4: Data Collector — Metric Scraping Engine

**New file**: `src/data-collector.ts`

### Purpose

Replace all mock data with real metrics. Two collection modes using Playwright (reuses PlatformAdapter from Module 3).

### Mode A: Post Metrics — Track Your Content

- **Trigger**: Decay schedule per published work
  - 0-48h: every 4 hours (12 collections)
  - 2-7 days: daily (5 collections)
  - 7-30 days: weekly (~3 collections)
  - 30d+: stop
- **Data**: views, likes, comments, shares, follower delta
- **Storage**: work.yaml → platforms[].metrics + metricsHistory[]
- **Memory**: write to EverMemOS at 24h, 72h, 7d milestones

### Mode B: Trend Data — Discover What's Hot

- **Trigger**: Cron (every 6h, configurable)
- **Data**: Trending videos (title, views, creator), hot tags (count, trend direction), competitor updates
- **Storage**: `~/.skill-evolver/trends/{platform}/{date}.yaml`
- **Memory**: write to EverMemOS as episodic trend snapshots

### Frontend Integration (Mock → Real)

| Page | Before | After |
|------|--------|-------|
| Explore | Hardcoded 10+10 videos | `GET /api/trends/:platform` |
| Analytics | Fake demographics | `GET /api/analytics` (aggregated from real work metrics) |
| Works | 5 mock works | `GET /api/works` with real metrics |

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/trends/:platform` | GET | Latest trend snapshot |
| `/api/trends/:platform/history` | GET | Trend snapshots over time |
| `/api/analytics` | GET | Aggregated metrics: total views/likes, top works |
| `/api/analytics/work/:id` | GET | Per-work growth curves |
| `/api/collector/trigger` | POST | Manually trigger collection |
| `/api/collector/status` | GET | Next scheduled run, last stats |
| `/api/competitors` | GET/POST | CRUD tracked competitor profiles |

### Scraping Resilience

- **Retry**: exponential backoff, max 3 attempts per scrape
- **CAPTCHA detection**: if detected (page contains CAPTCHA elements), abort scrape and notify user via WebSocket event
- **Selector versioning**: CSS selectors stored in `~/.skill-evolver/selectors/{platform}.yaml` so they can be updated without code changes when platform UI changes
- **Circuit breaker**: after 5 consecutive failures for a platform, disable that platform's scraping and alert user. Manual re-enable via API.

### Config

```yaml
collector:
  trendInterval: "6h"
  metricsEnabled: true
  trendEnabled: true
  competitors: []   # [{platform, profileUrl, name}]
```

---

## Module 5: EverMemOS Integration — Memory System

**New file**: `src/memory.ts`

### Purpose

Long-term learning via EverMemOS API. Reuses client pattern from `evermem-async/src/evermemos.js`.

### EverMemOS API Contract

- **Base URL**: `https://api.evermind.ai/api/v0`
- **Auth**: `Authorization: Bearer {apiKey}` header
- **Add memory**: `POST /memories` — body: `{message_id, create_time, sender, sender_name, content, group_id, group_name, role}`
- **Search**: `GET /memories/search` — body: `{user_id, query, retrieve_method, top_k, memory_types?, group_ids?}`
- **Response**: `{result: {memories: [...], profiles: [...], metadata: {episodic_count, profile_count, latency_ms}}}`
- **Graceful degradation**: If EverMemOS is unreachable (timeout 5s), content creation proceeds without memory injection. A warning badge shows in Studio UI. Memory writes are queued and retried on next successful connection.

### Memory Categories

| Category | Type | When Written | Example |
|----------|------|-------------|---------|
| Creation Memory | episodic | Pipeline step completed | "选题角度是'3个AI神器'，用户要求更接地气，改为..." |
| Performance Memory | episodic | Metrics at 24h/72h/7d | "播放4.5万，点赞3200，完播率42%，高于均值2.3倍" |
| Platform Rules | profile | Weekly review | "小红书封面带人脸点击率高30%；标题用'数字+痛点'" |
| Style Profile | profile | Every 5 works | "节奏快、信息密度高、实用导向；常用卡点剪辑" |
| Competitor Insights | episodic | Competitor scraped | "竞品@科技范儿本周AI测评类播放最高(12万)" |

### Memory Context Injection

When creating a new Work's CLI session, `buildContext()` runs 4 searches and assembles a markdown block:

```markdown
## 你的创作记忆

### 风格画像
{style_profile from EverMemOS}

### 平台规则 ({platform})
{platform_rules from EverMemOS}

### 相关历史创作
{top 3 related past works + their metrics}

### 竞品动态
{latest competitor insights}
```

This is injected into the CLI session's initial prompt.

### Weekly Review Agent

- Schedule: weekly (Sunday, configurable)
- Uses existing executor (evo-skill pattern)
- Searches all creation + performance memories from past 7 days
- Generates updated profile memories: style refresh, platform rules, suggested topics
- Report shown on Analytics page

### API Surface

```typescript
interface MemoryClient {
  search(query: string, options?: SearchOptions): Promise<SearchResult>
  addMemory(memory: MemoryPayload): Promise<void>
  buildContext(workTopic: string, platform: string): Promise<string>
}
```

### REST API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/memory/search` | GET | Search memories (query, method, top_k) |
| `/api/memory/profile` | GET | Latest style profile + platform rules |
| `/api/memory/context/:workId` | GET | Memory context for debugging |
| `/api/memory/review/trigger` | POST | Manually trigger weekly review |
| `/api/memory/review/latest` | GET | Latest review report |

### Config

```yaml
memory:
  apiKey: "sk_..."
  userId: "autoviral-user"
  weeklyReview: true
  reviewDay: "sunday"
  reviewTime: "09:00"
```

---

## Module 6: Frontend — Creation Studio

### Navigation

Tabs change from 3 to 5: **Works** | **Studio** (new) | **Explore** | **Analytics** | **Memory** (new)

**Mobile**: Studio is not a top-level tab on mobile — it's entered via a work item. Memory is a sub-section of Analytics on screens < 768px. This keeps the mobile bottom nav to 3-4 items.

### Studio Layout (three-panel)

| Left Panel (280px) | Center Panel (flex) | Right Panel (320px) |
|---------------------|--------------------|--------------------|
| Pipeline Steps | Agent Output (streaming) | Chat with Agent |
| Step status indicators | Current step result | Message history |
| Content type badge | Previous step results (collapsed) | Quick actions: Regenerate / Next Step / Redo |
| Platform targets | | Text input + Send |

### New Work Creation Flow

1. Click "+" on Works page → **NewWorkModal**
2. Choose content type: 短视频 / 图文 / 长视频 / 直播
3. Select target platforms: 小红书 / 抖音 (multi-select)
4. Optional: topic hint or leave blank for AI
5. → Enter Studio, CLI session spawns with memory context

### New Svelte Components

| Component | Purpose |
|-----------|---------|
| `Studio.svelte` | Three-panel creation workspace (replaces FeatureDetail) |
| `Memory.svelte` | Memory dashboard: style profile, learned rules, search |
| `NewWorkModal.svelte` | Content type + platform picker |
| `ChatPanel.svelte` | Reusable chat component with WebSocket |
| `PipelineSteps.svelte` | Left sidebar step list with status |
| `PublishModal.svelte` | Platform selection + confirmation before publish |
| `LoginModal.svelte` | Platform QR login prompt |

### Modified Files

| File | Changes |
|------|---------|
| `App.svelte` | 5 tabs, route to Studio on work click |
| `Explore.svelte` | Real data from `/api/trends/:platform` |
| `Analytics.svelte` | Real data from `/api/analytics`, growth curves |
| `lib/api.ts` | Add work/publish/memory/trend/collector API functions |
| `lib/ws.ts` | Add per-work WebSocket connection for Studio |
| `lib/i18n.ts` | All new UI strings in en + zh |

### Removed

- `FeatureDetail.svelte` — replaced by Studio

---

## Dependencies

| Package | Purpose | Module |
|---------|---------|--------|
| `playwright` | Browser automation for publishing + scraping (optional, lazy-install) | 3, 4 |
| (none new for WsBridge) | Uses native `ws` WebSocket from Node.js | 1 |
| (none new for EverMemOS) | Uses native `https`/`fetch` | 5 |

---

## Config Schema (all new fields)

All additions to the existing `Config` interface in `src/config.ts`:

```typescript
// New fields (with defaults)
collector: {
  trendInterval: string       // "6h"
  metricsEnabled: boolean     // true
  trendEnabled: boolean       // true
  competitors: Array<{platform: string, profileUrl: string, name: string}>  // []
}
memory: {
  apiKey: string              // "" (required for memory features)
  userId: string              // "autoviral-user"
  weeklyReview: boolean       // true
  reviewDay: string           // "sunday"
  reviewTime: string          // "09:00"
}
```

---

## Implementation Order

1. **Work Store** (Module 2) — foundation for everything else
2. **WsBridge** (Module 1) — core engine, enables content creation
3. **Frontend: Studio + Chat** (Module 6 partial) — interaction layer
4. **Publish Engine** (Module 3) — close the publish loop
5. **Data Collector** (Module 4) — close the measurement loop
6. **EverMemOS Integration** (Module 5) — close the learning loop
7. **Frontend: Memory + Analytics + Explore** (Module 6 remaining) — display real data

Each module can be built and tested independently before integrating with the next.
