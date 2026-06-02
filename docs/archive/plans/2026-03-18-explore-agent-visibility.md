# Explore Agent Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real-time agent search progress on the Explore page instead of a silent spinner.

**Architecture:** Reuse WsBridge to stream Claude CLI events during trend research. Add event filtering for trend sessions (prefix `trends_`), a new `ResearchProgress.svelte` component for lightweight status display, and fix the data format mismatch between backend prompt and frontend parser.

**Tech Stack:** TypeScript, Svelte 5 (runes), WebSocket, Hono, Claude CLI stream-json

**Spec:** `docs/superpowers/specs/2026-03-18-explore-agent-visibility-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/ws-bridge.ts` | Modify | Add `createTrendSession()`, trend event filtering, disconnect-kill, session cleanup |
| `src/server/api.ts` | Modify | Add `POST /api/trends/refresh-stream`, cancel endpoint, fix prompt format, add `videos` fallback to validation |
| `web/src/lib/ws.ts` | Modify | Add `createTrendWs()` helper (no auto-reconnect) |
| `web/src/components/ResearchProgress.svelte` | Create | Progress timeline component |
| `web/src/pages/Explore.svelte` | Modify | Integrate streaming refresh flow + ResearchProgress |

---

### Task 1: WsBridge — Trend Session Support

**Files:**
- Modify: `src/ws-bridge.ts:56-526`

- [ ] **Step 1: Add `createTrendSession` method**

Add after `createSession()` (line 221). This is a simplified version that doesn't load work context, uses haiku model, and has a 90s timeout:

```typescript
/**
 * Create an ephemeral trend research session.
 * No work context, uses haiku model, auto-kills after 90s.
 */
async createTrendSession(sessionKey: string, prompt: string): Promise<WsSession> {
  const existing = this.sessions.get(sessionKey);
  if (existing?.cliProcess) {
    try { existing.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
  }

  const session: WsSession = {
    workId: sessionKey,
    idle: false,
    browserSockets: existing?.browserSockets ?? new Set(),
    messageHistory: [],
    model: "haiku",
  };
  this.sessions.set(sessionKey, session);

  this.spawnCli(session, prompt);

  // Auto-kill after 90s
  setTimeout(() => {
    if (session.cliProcess) {
      try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
      session.cliProcess = undefined;
      this.broadcastToBrowsers(sessionKey, {
        event: "research_error",
        data: { message: "搜索超时，请稍后重试" },
      });
      this.cleanupTrendSession(sessionKey);
    }
  }, 90000);

  // Emit research_started
  this.broadcastToBrowsers(sessionKey, {
    event: "research_started",
    data: { platform: sessionKey.split("_")[1] ?? "unknown" },
  });

  return session;
}
```

- [ ] **Step 2: Add trend event filtering in NDJSON parser**

In `spawnCli()`, inside the NDJSON parsing loop (after line 345), add trend-specific event emission. Insert this block right after `const msg: NdjsonMessage = JSON.parse(line);` (line 345) and before the existing `if (msg.type === "system"...)`:

```typescript
// Trend session event filtering
if (session.workId.startsWith("trends_")) {
  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content as Array<Record<string, unknown>>) {
      if (block.type === "tool_use" && block.name === "WebSearch") {
        const input = block.input as Record<string, unknown> | undefined;
        this.broadcastToBrowsers(session.workId, {
          event: "search_query",
          data: { query: (input?.query as string) ?? "" },
        });
      }
    }
  }
  if (msg.type === "user" && (msg as Record<string, unknown>).message) {
    const userMsg = (msg as Record<string, unknown>).message as Record<string, unknown>;
    const content = userMsg.content as Array<Record<string, unknown>> | undefined;
    if (content) {
      for (const block of content) {
        if (block.type === "tool_result") {
          const resultText = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
          const summary = resultText.slice(0, 80) || "搜索完成";
          this.broadcastToBrowsers(session.workId, {
            event: "search_result",
            data: { summary },
          });
        }
      }
    }
  }
}
```

- [ ] **Step 3: Add `analyzing` event emission**

In `spawnCli()`, add a `lastEventWasToolResult` flag at the top of the function (next to `let turnText = ""`):

```typescript
let lastEventWasToolResult = false;
```

Set it to `true` after processing tool_result blocks (inside the `msg.type === "user"` branch, after the for loop):

```typescript
if (session.workId.startsWith("trends_")) {
  lastEventWasToolResult = true;
}
```

Set it to `false` after processing tool_use blocks (inside the `msg.type === "assistant"` branch, after detecting tool_use):

```typescript
// Reset when we see a new tool_use (agent is still doing searches)
if (block.type === "tool_use") {
  lastEventWasToolResult = false;
}
```

Emit `analyzing` when assistant text arrives after tool results:

```typescript
// In the assistant text handling (block.type === "text"), before the existing broadcastToBrowsers:
if (session.workId.startsWith("trends_") && lastEventWasToolResult) {
  this.broadcastToBrowsers(session.workId, {
    event: "analyzing",
    data: {},
  });
  lastEventWasToolResult = false;
}
```

- [ ] **Step 4: Add disconnect-kill for trend sessions**

Modify `handleBrowserConnection` (line 475). Replace the `ws.on("close", ...)` handler:

```typescript
ws.on("close", () => {
  session.browserSockets.delete(ws);
  // For trend sessions: kill CLI when last browser disconnects
  if (session.workId.startsWith("trends_") && session.browserSockets.size === 0) {
    setTimeout(() => {
      // Re-check after grace period
      if (session.browserSockets.size === 0 && session.cliProcess) {
        try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
        session.cliProcess = undefined;
        this.cleanupTrendSession(session.workId);
      }
    }, 3000);
  }
});
```

- [ ] **Step 5: Add `cleanupTrendSession` method and `session_closed` event**

Add after `getAllSessions()`:

```typescript
private cleanupTrendSession(sessionKey: string): void {
  this.broadcastToBrowsers(sessionKey, {
    event: "session_closed",
    data: { sessionKey },
  });
  // Close all browser sockets
  const session = this.sessions.get(sessionKey);
  if (session) {
    for (const ws of session.browserSockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }
  // Remove from map after delay
  setTimeout(() => {
    this.sessions.delete(sessionKey);
  }, 5000);
}
```

Also modify the `proc.on("exit", ...)` handler in `spawnCli()` to trigger cleanup for trend sessions:

```typescript
proc.on("exit", (code, signal) => {
  session.cliProcess = undefined;
  session.idle = true;
  if (session.workId.startsWith("trends_")) {
    this.broadcastToBrowsers(session.workId, {
      event: code === 0 ? "research_done" : "research_error",
      data: code === 0
        ? { platform: session.workId.split("_")[1] ?? "unknown" }
        : { message: `CLI exited with code ${code}` },
    });
    this.cleanupTrendSession(session.workId);
  } else {
    this.broadcastToBrowsers(session.workId, {
      event: "cli_exited",
      data: { workId: session.workId, code, signal },
    });
  }
});
```

- [ ] **Step 6: Export `createTrendSession` and `cleanupTrendSession` availability check**

No change needed — `createTrendSession` is a public method on the class. But also expose a `killTrendSession` method for the cancel endpoint:

```typescript
killTrendSession(sessionKey: string): boolean {
  if (!sessionKey.startsWith("trends_")) return false;
  const session = this.sessions.get(sessionKey);
  if (!session) return false;
  if (session.cliProcess) {
    try { session.cliProcess.kill("SIGTERM"); } catch { /* dead */ }
    session.cliProcess = undefined;
  }
  this.broadcastToBrowsers(sessionKey, {
    event: "research_error",
    data: { message: "用户取消" },
  });
  this.cleanupTrendSession(sessionKey);
  return true;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/ws-bridge.ts
git commit -m "feat: add trend session support to WsBridge with event filtering and auto-cleanup"
```

---

### Task 2: API — Streaming Refresh & Cancel Endpoints

**Files:**
- Modify: `src/server/api.ts:295-381`

- [ ] **Step 1: Fix prompt format in `researchTrends()`**

Replace the prompt string (lines 302-318) with:

```typescript
const prompt = [
  `你是一个社交媒体趋势研究员。请搜索 ${platformLabel} 平台当前最热门的内容趋势和话题。`,
  ``,
  `使用 WebSearch 搜索以下内容：`,
  `- "${platformLabel} 热门话题 2026"`,
  `- "${platformLabel} 爆款内容 趋势"`,
  `- "${platformLabel} 热搜榜"`,
  ``,
  `然后根据搜索结果，整理成以下 JSON 格式。`,
  `即使搜索结果不完整，也要根据已有信息尽力填充，估算数据也可以。`,
  `你必须输出有效的 JSON，这是硬性要求，不允许输出其他格式。`,
  ``,
  `输出格式（只输出这个 JSON，不要其他任何文字）：`,
  `{"topics":[{"title":"话题标题","heat":4,"competition":"中","description":"简短描述和建议方向"}]}`,
  ``,
  `topics 至少8个。heat 为 1-5 的整数。competition 为 "低"/"中"/"高"。`,
].join("\n");
```

Also update the validation check (line 332) from `if (!data.videos || !data.tags)` to:

```typescript
if (!data.topics || !Array.isArray(data.topics)) {
  errors.push(platform);
  continue;
}
```

- [ ] **Step 2: Add `POST /api/trends/refresh-stream` endpoint**

Add after the existing `POST /api/trends/refresh` endpoint (line 381):

```typescript
// POST /api/trends/refresh-stream — streaming trend research via WsBridge
apiRoutes.post("/api/trends/refresh-stream", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  try {
    const body = await c.req.json<{ platform?: string }>().catch(() => ({}));
    const platform = (body as any).platform ?? "douyin";
    const platformLabel = platform === "xiaohongshu" ? "小红书" : platform === "douyin" ? "抖音" : platform;

    const sessionKey = `trends_${platform}_${Date.now()}`;

    const prompt = [
      `你是一个社交媒体趋势研究员。请搜索 ${platformLabel} 平台当前最热门的内容趋势和话题。`,
      ``,
      `使用 WebSearch 搜索以下内容：`,
      `- "${platformLabel} 热门话题 2026"`,
      `- "${platformLabel} 爆款内容 趋势"`,
      `- "${platformLabel} 热搜榜"`,
      ``,
      `然后根据搜索结果，整理成以下 JSON 格式。`,
      `即使搜索结果不完整，也要根据已有信息尽力填充，估算数据也可以。`,
      `你必须输出有效的 JSON，这是硬性要求，不允许输出其他格式。`,
      ``,
      `输出格式（只输出这个 JSON，不要其他任何文字）：`,
      `{"topics":[{"title":"话题标题","heat":4,"competition":"中","description":"简短描述和建议方向"}]}`,
      ``,
      `topics 至少8个。heat 为 1-5 的整数。competition 为 "低"/"中"/"高"。`,
    ].join("\n");

    await wsBridge.createTrendSession(sessionKey, prompt);

    return c.json({ sessionKey, platform });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to start research" }, 500);
  }
});
```

- [ ] **Step 3: Add `POST /api/trends/cancel/:sessionKey` endpoint**

Add right after the refresh-stream endpoint:

```typescript
// POST /api/trends/cancel/:sessionKey — cancel trend research
apiRoutes.post("/api/trends/cancel/:sessionKey", async (c) => {
  if (!wsBridge) return c.json({ error: "WsBridge not initialized" }, 503);

  const sessionKey = c.req.param("sessionKey");
  const killed = wsBridge.killTrendSession(sessionKey);
  return c.json({ cancelled: killed });
});
```

- [ ] **Step 4: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add streaming trend refresh and cancel endpoints, fix prompt format"
```

---

### Task 3: WebSocket Helper — `createTrendWs`

**Files:**
- Modify: `web/src/lib/ws.ts`

- [ ] **Step 1: Add `createTrendWs` function**

Append to `web/src/lib/ws.ts`:

```typescript
export function createTrendWs(
  sessionKey: string,
  onEvent: (event: string, data: any) => void
): { close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(
      `${proto}//${location.host}/ws/browser/${encodeURIComponent(sessionKey)}`
    );

    ws.onmessage = (msg) => {
      try {
        const { event, data } = JSON.parse(msg.data);
        onEvent(event, data);
        // Auto-close on terminal events (no reconnect)
        if (event === "session_closed" || event === "research_done" || event === "research_error") {
          closed = true;
          ws?.close();
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      // No auto-reconnect for trend sessions
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/ws.ts
git commit -m "feat: add createTrendWs helper with no auto-reconnect"
```

---

### Task 4: ResearchProgress Component

**Files:**
- Create: `web/src/components/ResearchProgress.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  interface ProgressLine {
    type: "search" | "result" | "analyzing" | "done" | "error";
    text: string;
  }

  let {
    active,
    lines,
    phase,
    onCancel,
  }: {
    active: boolean;
    lines: ProgressLine[];
    phase: "idle" | "searching" | "analyzing" | "done" | "error";
    onCancel: () => void;
  } = $props();

  function lineIcon(type: string): string {
    if (type === "done" || type === "result") return "\u2713";
    if (type === "error") return "\u2715";
    return "\u2192";
  }

  function lineClass(type: string): string {
    if (type === "done" || type === "result") return "line-done";
    if (type === "error") return "line-error";
    return "line-active";
  }

  let platformLabel = $derived(
    phase === "idle" ? "" : "趋势"
  );
</script>

<div class="research-progress" class:expanded={active} class:collapsed={!active && phase !== "idle"}>
  <div class="progress-inner">
    {#if active || phase === "error"}
      <div class="progress-header">
        <div class="header-left">
          {#if phase === "error"}
            <span class="dot dot-error">&times;</span>
            <span class="header-text">调研失败</span>
          {:else if phase === "done"}
            <span class="dot dot-done">&check;</span>
            <span class="header-text">调研完成</span>
          {:else}
            <span class="dot dot-pulse"></span>
            <span class="header-text">正在调研{platformLabel}...</span>
          {/if}
        </div>
        {#if phase === "error"}
          <button class="cancel-btn" onclick={onCancel}>重试</button>
        {:else if active}
          <button class="cancel-btn" onclick={onCancel}>取消</button>
        {/if}
      </div>

      <div class="lines">
        {#each lines as line, i (i)}
          <div class="line {lineClass(line.type)}" style="animation-delay: {i * 0.05}s">
            <span class="line-icon">{lineIcon(line.type)}</span>
            <span class="line-text">{line.text}</span>
          </div>
        {/each}
      </div>

      <div class="progress-bar-track">
        <div
          class="progress-bar-fill"
          class:indeterminate={phase === "searching"}
          class:almost={phase === "analyzing"}
          class:full={phase === "done"}
        ></div>
      </div>
    {/if}
  </div>
</div>

<style>
  .research-progress {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .research-progress.expanded {
    grid-template-rows: 1fr;
  }

  .progress-inner {
    overflow: hidden;
    min-height: 0;
  }

  .progress-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-text {
    font-size: 0.85rem;
    font-weight: 650;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  /* Dots */
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .dot-pulse {
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .dot-done {
    background: #34d399;
    font-size: 0;
  }

  .dot-error {
    background: var(--error, #fb7185);
    font-size: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Cancel / retry button */
  .cancel-btn {
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-dim);
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cancel-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Lines */
  .lines {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0 0 0.75rem;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.8rem;
    font-weight: 500;
    animation: lineIn 200ms ease both;
  }

  .line-done {
    color: var(--text-dim);
  }

  .line-active {
    color: var(--text);
  }

  .line-error {
    color: var(--error, #fb7185);
  }

  .line-icon {
    font-size: 0.7rem;
    width: 1em;
    text-align: center;
    flex-shrink: 0;
  }

  .line-text {
    line-height: 1.4;
  }

  @keyframes lineIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Progress bar */
  .progress-bar-track {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 1rem;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    width: 0%;
    transition: width 400ms ease;
  }

  .progress-bar-fill.indeterminate {
    width: 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--accent) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
  }

  .progress-bar-fill.almost {
    width: 90%;
  }

  .progress-bar-fill.full {
    width: 100%;
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ResearchProgress.svelte
git commit -m "feat: add ResearchProgress component with timeline and progress bar"
```

---

### Task 5: Explore Page Integration

**Files:**
- Modify: `web/src/pages/Explore.svelte`

- [ ] **Step 1: Add `videos` fallback to `parseTrends()`**

In `parseTrends()` (line 24), add `data.videos` to the fallback chain:

```typescript
const arr = data.topics ?? data.directions ?? data.trends ?? data.items ?? data.videos;
```

- [ ] **Step 2: Add imports and new state**

Add at the top of the `<script>` block:

```typescript
import { createTrendWs } from "../lib/ws";
import ResearchProgress from "../components/ResearchProgress.svelte";
```

Add new state variables after the existing ones (after line 19):

```typescript
let researchActive = $state(false);
let researchWs: { close: () => void } | null = null;
let sessionKey = $state("");

interface ProgressLine {
  type: "search" | "result" | "analyzing" | "done" | "error";
  text: string;
}
let progressLines: ProgressLine[] = $state([]);
let researchPhase: "idle" | "searching" | "analyzing" | "done" | "error" = $state("idle");
```

- [ ] **Step 3: Replace `handleRefresh()` with streaming version**

Replace the existing `handleRefresh()` (lines 83-97):

```typescript
async function handleRefresh() {
  if (researchActive) return;

  // Reset state
  progressLines = [];
  researchPhase = "searching";
  researchActive = true;

  try {
    const res = await fetch("/api/trends/refresh-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: activePlatform }),
    });

    if (!res.ok) {
      researchPhase = "error";
      progressLines = [{ type: "error", text: "无法启动趋势调研" }];
      researchActive = false;
      return;
    }

    const { sessionKey: key } = await res.json();
    sessionKey = key;

    researchWs = createTrendWs(key, (event, data) => {
      switch (event) {
        case "search_query":
          progressLines = [...progressLines, {
            type: "search",
            text: `搜索 "${data.query}"`,
          }];
          break;
        case "search_result": {
          // Mark last search line as done
          const updated = [...progressLines];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].type === "search") {
              updated[i] = { type: "result", text: updated[i].text + "  " + (data.summary || "完成") };
              break;
            }
          }
          progressLines = updated;
          break;
        }
        case "analyzing":
          researchPhase = "analyzing";
          progressLines = [...progressLines, {
            type: "analyzing",
            text: "正在分析整理...",
          }];
          break;
        case "research_done":
          researchPhase = "done";
          progressLines = [...progressLines, {
            type: "done",
            text: "调研完成",
          }];
          // Collapse and reload after delay
          setTimeout(() => {
            researchActive = false;
            researchPhase = "idle";
            progressLines = [];
            loadTrends();
          }, 800);
          break;
        case "research_error":
          researchPhase = "error";
          progressLines = [...progressLines, {
            type: "error",
            text: data.message || "调研失败",
          }];
          researchActive = false;
          break;
        case "session_closed":
          researchWs = null;
          break;
      }
    });
  } catch {
    researchPhase = "error";
    progressLines = [{ type: "error", text: "网络错误，请重试" }];
    researchActive = false;
  }
}
```

- [ ] **Step 4: Add cancel handler**

Add after `handleRefresh()`:

```typescript
async function handleCancel() {
  if (researchPhase === "error") {
    // Retry
    handleRefresh();
    return;
  }
  if (sessionKey) {
    await fetch(`/api/trends/cancel/${encodeURIComponent(sessionKey)}`, {
      method: "POST",
    }).catch(() => {});
  }
  researchWs?.close();
  researchWs = null;
  researchActive = false;
  researchPhase = "idle";
  progressLines = [];
}
```

- [ ] **Step 5: Update template**

Insert `ResearchProgress` between the tab-bar and the content section. In the template (after the closing `</div>` of `.tab-bar`, around line 149):

```svelte
<ResearchProgress
  active={researchActive}
  lines={progressLines}
  phase={researchPhase}
  onCancel={handleCancel}
/>
```

- [ ] **Step 6: Update button and tab states during research**

Modify the refresh button (line 145-148) to show "取消" during research and disable tab switching:

Replace:
```svelte
<button class="refresh-btn" onclick={handleRefresh} disabled={refreshing || loading}>
```
With:
```svelte
<button class="refresh-btn" onclick={researchActive ? handleCancel : handleRefresh} disabled={loading}>
```

Replace the button text:
```svelte
{refreshing ? "刷新中..." : "刷新趋势"}
```
With:
```svelte
{researchActive ? "取消" : "刷新趋势"}
```

Disable platform pills during research — modify both pill-tab buttons to add:
```svelte
disabled={researchActive}
```

Add disabled style for pill tabs in `<style>`:

```css
.pill-tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
```

- [ ] **Step 7: Clean up unused `refreshing` state**

Remove `let refreshing = $state(false);` (line 16) since it's no longer used. The old `handleRefresh` is fully replaced.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Explore.svelte
git commit -m "feat: integrate streaming research progress into Explore page"
```

---

### Task 6: Manual Verification

- [ ] **Step 1: Build the project**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
npm run build
```

Verify no TypeScript errors.

- [ ] **Step 2: Build the web frontend**

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral/web
npm run build
```

Verify no Svelte/TS errors.

- [ ] **Step 3: Smoke test (if server can be started)**

Start the server and navigate to the Explore page. Click "刷新趋势" and verify:
1. Progress timeline appears with expanding animation
2. Search queries appear one by one as the agent works
3. Progress bar shows indeterminate shimmer during searching
4. After analysis, progress fills to 90%, then 100% on completion
5. Timeline collapses and trend cards appear
6. "取消" button works — stops the research
7. Platform tabs are disabled during research
8. Error state shows with retry option

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete explore page agent visibility with streaming progress"
```
