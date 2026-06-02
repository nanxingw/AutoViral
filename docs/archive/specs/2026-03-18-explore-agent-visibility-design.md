# Explore Page: Agent Search Visibility

**Date:** 2026-03-18
**Status:** Approved
**Scope:** Explore page trend research — show agent search process to user

## Problem

When users click "refresh trends" on the Explore page, they see only a loading spinner with "刷新中..." text. The backend `researchTrends()` uses `runCliBrief()` which spawns Claude CLI in silent JSON mode. The entire search + analysis process (30-60s) is invisible, giving poor user feedback.

Additionally, the backend prompt produces `{videos, tags}` format while the frontend `parseTrends()` expects `{topics: [{title, heat, competition, description}]}`, causing a data format mismatch.

## Solution

Reuse the existing WsBridge + WebSocket infrastructure to stream agent progress events to the Explore page. Display a lightweight progress timeline (not full Studio chat) showing key milestones: search queries fired, results found, analysis in progress, completion.

## Architecture

### Backend Changes

#### 1. New streaming refresh endpoint

```
POST /api/trends/refresh-stream
  Request: { platform: "douyin" | "xiaohongshu" }
  Response: { sessionKey: "trends_douyin_1710750000" }
```

This endpoint:
- Generates a temporary session key: `trends_{platform}_{timestamp}`
- Creates a WsBridge session with that key
- Spawns Claude CLI with `--output-format stream-json --verbose`
- Returns the session key immediately so the frontend can connect via WebSocket

#### 2. Event filtering

The WsBridge NDJSON parser already handles all Claude CLI stream events. For trend research sessions (identified by `trends_` prefix in workId), add a filter layer that emits simplified events to browser clients:

| Raw CLI event | Condition | Emitted event | Payload |
|---|---|---|---|
| `tool_use` | toolName = "WebSearch" | `search_query` | `{ query: string }` |
| `tool_result` | after WebSearch | `search_result` | `{ summary: string }` |
| `assistant_text` | all tool_use/tool_result pairs done, next text arrives | `analyzing` | `{}` |
| session start | — | `research_started` | `{ platform: string }` |
| `cli_exited` | exit code 0 | `research_done` | `{ platform: string }` |
| `cli_exited` | exit code != 0 | `research_error` | `{ message: string }` |

**Notes on event extraction:**
- `search_result` count: `tool_result` carries raw content strings. Parse the content to extract a rough result count or first-line summary. If parsing fails, emit `{ summary: "搜索完成" }` as fallback.
- `analyzing` trigger: only emit after ALL consecutive tool_use/tool_result pairs complete. Intermediate assistant text between searches (e.g., "Let me search more") should NOT trigger this event. Track a `lastEventWasToolResult` flag to determine this.
- Use `--model haiku` for trend research to keep cost low (matching existing `runCliBrief` behavior).

#### 3. Fix prompt format

Update the `researchTrends()` prompt to request output matching the frontend schema:

```json
{
  "topics": [
    {
      "title": "话题标题",
      "heat": 4,
      "competition": "中",
      "description": "简短描述"
    }
  ]
}
```

Fields: `title` (string), `heat` (1-5 integer), `competition` ("低"/"中"/"高"), `description` (string). Minimum 8 topics.

#### 4. Deprecate old endpoint

The old `POST /api/trends/refresh` endpoint and `runCliBrief()` helper remain for use by `research-scheduler.ts` (background cron job). The Explore page switches entirely to the new streaming endpoint. No migration needed — both paths write the same YAML format to the same directory.

#### 5. Backward-compatible data parsing

The frontend `parseTrends()` already handles multiple schemas via fallback keys. Add `videos` to the fallback array so old cached data (with `{videos, tags}` format) still displays:

```typescript
// In parseTrends(), add handling for legacy {videos, tags} format
const arr = data.topics ?? data.directions ?? data.trends ?? data.items ?? data.videos;
```

This ensures old YAML files still render while new data uses the `topics` schema.

#### 6. Session cleanup

Trend research sessions are ephemeral. After `research_done` or `research_error`:
- Save parsed data to `~/.autoviral/trends/{platform}/{date}.yaml`
- Send a `session_closed` event to all browser sockets (signals frontend not to reconnect)
- Close all browser sockets for that session
- Remove session from WsBridge map after 5s delay (allow final events to flush)
- **Timeout:** If CLI process runs longer than 90s, auto-kill and emit `research_error`

#### 7. Cancel mechanism

Two paths, both must work:

1. **Explicit cancel:** `POST /api/trends/cancel/{sessionKey}` — kills CLI process, emits `research_error` with "用户取消" message, triggers cleanup.
2. **Disconnect kill:** For trend sessions only (prefix `trends_`), when the last browser socket disconnects, kill the CLI process after 3s grace period. Add this logic to `handleBrowserConnection`'s `close` handler. (Studio sessions must NOT auto-kill on disconnect — they support reconnect.)

### Frontend Changes

#### 1. New component: `ResearchProgress.svelte`

A compact progress timeline that sits above the trend card grid.

**Props:**
```typescript
interface Props {
  active: boolean;       // whether research is in progress
  platform: string;      // "douyin" | "xiaohongshu"
  onCancel: () => void;  // kill the session
  onDone: () => void;    // reload trend data
}
```

**State:**
```typescript
interface ProgressLine {
  type: "search" | "result" | "analyzing" | "done" | "error";
  text: string;
  timestamp: number;
}

let lines: ProgressLine[] = $state([]);
let phase: "idle" | "searching" | "analyzing" | "done" | "error" = $state("idle");
```

**Layout (no card wrapping):**

```
● 正在调研{平台}趋势                              [取消]

  ✓ 搜索 "抖音 热门话题 2026"
  ✓ 搜索 "抖音 爆款内容 趋势"              找到 23 条
  → 搜索 "抖音 热搜榜"                     ···

  ━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░  3/4
```

**Visual rules:**
- No card container — embedded directly in page flow
- Separated from content below by a 1px `var(--border)` line
- Left: pulsing dot (CSS animation `pulse`, accent color), changes to ✓ on completion
- Status lines appear one by one (append on each event)
- Completed lines: ✓ prefix, `var(--text-dim)` color
- Active line: → prefix, `var(--text)` color
- Progress bar: thin (3px), `var(--accent)` fill on `var(--border)` track
- Progress bar is indeterminate (animated stripe/shimmer) during searching phase, switches to determinate only when `analyzing` event arrives (fills to 90%), then 100% on `done`. We cannot know total search count in advance.
- Error lines: ✕ prefix, `var(--error)` color

**Animations:**
- Expand: `grid-template-rows: 0fr → 1fr` with `overflow: hidden` on inner wrapper, 300ms ease-out
- Collapse (on done): same transition reversed, 300ms, after 500ms delay
- New line appearance: `opacity 0→1 + translateY(4px→0)`, 200ms
- Pulsing dot: `opacity: 1 → 0.4`, 1.2s ease-in-out infinite

#### 2. Explore.svelte changes

**New state:**
```typescript
let researchActive = $state(false);
let researchWs: { close: () => void } | null = null;
let sessionKey = $state("");
```

**Modified `handleRefresh()`:**
```
1. POST /api/trends/refresh-stream → get sessionKey
2. Set researchActive = true
3. Connect WebSocket to /ws/browser/{sessionKey}
4. Forward events to ResearchProgress component
5. On research_done: close WS, set researchActive = false, call loadTrends()
6. On research_error: show error state, allow retry
```

**Cancel behavior:**
- POST /api/trends/cancel/{sessionKey} (new endpoint)
- Or simply close the WebSocket; backend detects disconnect and kills CLI process

**Template structure:**
```svelte
<div class="explore">
  <div class="tab-bar">...</div>

  <ResearchProgress
    active={researchActive}
    platform={activePlatform}
    onCancel={handleCancel}
    onDone={loadTrends}
  />

  {#if loading}
    ...
  {:else if !hasData}
    ...
  {:else}
    ... card grid ...
  {/if}
</div>
```

#### 3. WebSocket connection helper

Add to `web/src/lib/ws.ts`:

```typescript
export function createTrendWs(
  sessionKey: string,
  onEvent: (event: string, data: any) => void
): { close: () => void }
```

Same pattern as `createWorkWs` but connecting to `/ws/browser/{sessionKey}`. Read-only (no `send` method needed). **No auto-reconnect** — when the connection closes or a `session_closed` event is received, do not attempt to reconnect (unlike `createWorkWs` which has exponential backoff reconnect for Studio sessions).

#### 4. Explore.svelte button state

During `researchActive`:
- "刷新趋势" button text changes to "取消" with a stop icon
- Platform pill tabs become disabled (cannot switch mid-research)
- The existing `loading` and `refreshing` states are not used — `researchActive` replaces them for the streaming flow

## Files to modify

| File | Change |
|---|---|
| `src/server/api.ts` | Add `POST /api/trends/refresh-stream`, add cancel endpoint, fix prompt format |
| `src/ws-bridge.ts` | Add trend session event filtering, add session cleanup for ephemeral sessions |
| `web/src/components/ResearchProgress.svelte` | New component |
| `web/src/pages/Explore.svelte` | Integrate ResearchProgress, new WS flow |
| `web/src/lib/ws.ts` | Add `createTrendWs` helper |

## Out of scope

- Trend data caching strategy changes
- Scheduled background research (existing `research-scheduler.ts`)
- Any changes to Studio page
