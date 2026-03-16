# AutoViral Full Product Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform AutoViral from mock UI into a fully functional content creation platform with closed loop: Create → Publish → Measure → Learn → Create Better

**Architecture:** Persistent Claude CLI sessions via `--sdk-url` WebSocket (pneuma-skills pattern) for multi-turn content creation. Playwright for browser automation (publishing + scraping). EverMemOS for long-term memory. All data persisted in YAML at `~/.skill-evolver/`.

**Tech Stack:** Node.js + TypeScript + Hono + ws (backend), Svelte 5 + Vite (frontend), Playwright (optional), EverMemOS REST API (memory)

**Spec:** `docs/superpowers/specs/2026-03-16-full-product-design.md`

---

## Chunk 1: Work Store (Module 2)

Foundation for everything — YAML-based work persistence replacing mock gallery data.

### Task 1.1: Extend Config with new fields

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add new config fields to Config interface**

In `src/config.ts`, extend the `Config` interface:

```typescript
// Add after existing fields:
collector?: {
  trendInterval?: string
  metricsEnabled?: boolean
  trendEnabled?: boolean
  competitors?: Array<{platform: string, profileUrl: string, name: string}>
}
memory?: {
  apiKey?: string
  userId?: string
  weeklyReview?: boolean
  reviewDay?: string
  reviewTime?: string
}
```

- [ ] **Step 2: Add defaults in getDefaultConfig()**

```typescript
collector: {
  trendInterval: '6h',
  metricsEnabled: true,
  trendEnabled: true,
  competitors: [],
},
memory: {
  apiKey: '',
  userId: 'autoviral-user',
  weeklyReview: true,
  reviewDay: 'sunday',
  reviewTime: '09:00',
},
```

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: extend Config with collector and memory fields"
```

---

### Task 1.2: Create work-store.ts

**Files:**
- Create: `src/work-store.ts`

- [ ] **Step 1: Create Work interface and helpers**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const DATA_DIR = join(process.env.HOME || '~', '.skill-evolver');
const WORKS_DIR = join(DATA_DIR, 'works');
const INDEX_FILE = join(WORKS_DIR, 'works.yaml');

export interface PlatformMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  lastUpdated: string;
}

export interface MetricsSnapshot {
  timestamp: string;
  views: number;
  likes: number;
  comments: number;
  shares?: number;
}

export interface PlatformEntry {
  name: string;
  publishedAt?: string;
  postUrl?: string;
  metrics?: PlatformMetrics;
  metricsHistory?: MetricsSnapshot[];
}

export interface PipelineStep {
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  completedAt?: string;
  competitorUrls?: string[];
}

export type ContentType = 'short-video' | 'image-text' | 'long-video' | 'livestream';
export type WorkStatus = 'draft' | 'creating' | 'ready' | 'publishing' | 'published' | 'failed';

export interface Work {
  id: string;
  title: string;
  type: ContentType;
  status: WorkStatus;
  platforms: PlatformEntry[];
  pipeline: Record<string, PipelineStep>;
  cliSessionId?: string;
  coverImage?: string;
  topicHint?: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkIndex {
  works: Array<{ id: string; title: string; type: ContentType; status: WorkStatus; updatedAt: string }>;
}
```

- [ ] **Step 2: Add CRUD functions**

```typescript
function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function workDir(id: string): string {
  return join(WORKS_DIR, id);
}

function workFile(id: string): string {
  return join(workDir(id), 'work.yaml');
}

function readIndex(): WorkIndex {
  ensureDir(WORKS_DIR);
  if (!existsSync(INDEX_FILE)) return { works: [] };
  try {
    const content = readFileSync(INDEX_FILE, 'utf-8');
    return (yaml.load(content) as WorkIndex) || { works: [] };
  } catch { return { works: [] }; }
}

function writeIndex(index: WorkIndex) {
  ensureDir(WORKS_DIR);
  writeFileSync(INDEX_FILE, yaml.dump(index, { lineWidth: 120 }), 'utf-8');
}

function updateIndex(work: Work) {
  const index = readIndex();
  const entry = { id: work.id, title: work.title, type: work.type, status: work.status, updatedAt: work.updatedAt };
  const i = index.works.findIndex(w => w.id === work.id);
  if (i >= 0) index.works[i] = entry;
  else index.works.push(entry);
  writeIndex(index);
}

export function listWorks(): WorkIndex['works'] {
  return readIndex().works;
}

export function getWork(id: string): Work | null {
  const file = workFile(id);
  if (!existsSync(file)) return null;
  try {
    return yaml.load(readFileSync(file, 'utf-8')) as Work;
  } catch { return null; }
}

export function createWork(params: { title: string; type: ContentType; platforms: string[]; topicHint?: string }): Work {
  const id = 'work_' + Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();
  const pipelineSteps = getPipelineTemplate(params.type);
  const work: Work = {
    id,
    title: params.title,
    type: params.type,
    status: 'draft',
    platforms: params.platforms.map(name => ({ name })),
    pipeline: pipelineSteps,
    topicHint: params.topicHint,
    createdAt: now,
    updatedAt: now,
  };
  ensureDir(workDir(id));
  ensureDir(join(workDir(id), 'assets'));
  writeFileSync(workFile(id), yaml.dump(work, { lineWidth: 120 }), 'utf-8');
  updateIndex(work);
  return work;
}

export function updateWork(id: string, updates: Partial<Work>): Work | null {
  const work = getWork(id);
  if (!work) return null;
  Object.assign(work, updates, { updatedAt: new Date().toISOString() });
  writeFileSync(workFile(id), yaml.dump(work, { lineWidth: 120 }), 'utf-8');
  updateIndex(work);
  return work;
}

export function deleteWork(id: string): boolean {
  const dir = workDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  const index = readIndex();
  index.works = index.works.filter(w => w.id !== id);
  writeIndex(index);
  return true;
}

export function listAssets(id: string): string[] {
  const dir = join(workDir(id), 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

export function getAssetPath(id: string, filename: string): string | null {
  const file = join(workDir(id), 'assets', filename);
  return existsSync(file) ? file : null;
}
```

- [ ] **Step 3: Add pipeline templates per content type**

```typescript
function getPipelineTemplate(type: ContentType): Record<string, PipelineStep> {
  const pending = (): PipelineStep => ({ status: 'pending' });
  switch (type) {
    case 'short-video':
      return {
        step1_topic: pending(), step2_remix: pending(), step3_differentiation: pending(),
        step4_script: pending(), step5_production: pending(), step6_publish: pending(),
      };
    case 'image-text':
      return {
        step1_topic: pending(), step2_copywriting: pending(), step3_images: pending(),
        step4_layout: pending(), step5_cover: pending(), step6_publish: pending(),
      };
    case 'long-video':
      return {
        step1_research: pending(), step2_outline: pending(), step3_script: pending(),
        step4_storyboard: pending(), step5_postprod: pending(), step6_publish: pending(),
      };
    case 'livestream':
      return {
        step1_theme: pending(), step2_flow: pending(), step3_script: pending(),
        step4_interaction: pending(), step5_promo: pending(), step6_schedule: pending(),
      };
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/work-store.ts
git commit -m "feat: add work-store with YAML persistence and pipeline templates"
```

---

### Task 1.3: Add Work API routes

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: Import work-store and add routes**

At top of `api.ts`, add:
```typescript
import { listWorks, getWork, createWork, updateWork, deleteWork, listAssets, getAssetPath } from '../work-store.js';
```

Add routes after existing task routes:

```typescript
// ── Works ──
app.get('/api/works', (c) => {
  return c.json(listWorks());
});

app.post('/api/works', async (c) => {
  const body = await c.req.json();
  const { title, type, platforms, topicHint } = body;
  if (!title || !type || !platforms?.length) {
    return c.json({ error: 'title, type, and platforms required' }, 400);
  }
  const work = createWork({ title, type, platforms, topicHint });
  return c.json(work, 201);
});

app.get('/api/works/:id', (c) => {
  const work = getWork(c.req.param('id'));
  if (!work) return c.json({ error: 'not found' }, 404);
  return c.json(work);
});

app.put('/api/works/:id', async (c) => {
  const body = await c.req.json();
  const work = updateWork(c.req.param('id'), body);
  if (!work) return c.json({ error: 'not found' }, 404);
  return c.json(work);
});

app.delete('/api/works/:id', (c) => {
  const ok = deleteWork(c.req.param('id'));
  if (!ok) return c.json({ error: 'not found' }, 404);
  return c.json({ success: true });
});

app.get('/api/works/:id/assets', (c) => {
  return c.json(listAssets(c.req.param('id')));
});

app.get('/api/works/:id/assets/:filename', (c) => {
  const path = getAssetPath(c.req.param('id'), c.req.param('filename'));
  if (!path) return c.json({ error: 'not found' }, 404);
  const file = readFileSync(path);
  return new Response(file);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add Work CRUD API routes"
```

---

### Task 1.4: Add Work API client in frontend

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Add work API functions**

Append to `web/src/lib/api.ts`:

```typescript
// ── Works ──
export interface WorkSummary {
  id: string; title: string; type: string; status: string; updatedAt: string;
}

export interface Work {
  id: string; title: string; type: string; status: string;
  platforms: Array<{ name: string; publishedAt?: string; postUrl?: string; metrics?: any; metricsHistory?: any[] }>;
  pipeline: Record<string, { status: string; result?: string; completedAt?: string }>;
  cliSessionId?: string; coverImage?: string; topicHint?: string;
  createdAt: string; updatedAt: string;
}

export function fetchWorks(): Promise<WorkSummary[]> {
  return request<WorkSummary[]>('/api/works');
}

export function fetchWork(id: string): Promise<Work> {
  return request<Work>(`/api/works/${id}`);
}

export function createWorkApi(data: { title: string; type: string; platforms: string[]; topicHint?: string }): Promise<Work> {
  return request<Work>('/api/works', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

export function updateWorkApi(id: string, data: Partial<Work>): Promise<Work> {
  return request<Work>(`/api/works/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

export function deleteWorkApi(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/works/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat: add Work API client functions in frontend"
```

---

## Chunk 2: WsBridge — Agent Session Manager (Module 1)

Persistent multi-turn Claude CLI sessions via WebSocket.

### Task 2.1: Validate `--sdk-url` pattern (spike)

**Files:**
- Create: `scripts/test-sdk-url.ts`

- [ ] **Step 1: Create proof-of-concept script**

```typescript
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { createServer } from 'http';

const PORT = 19876;
const httpServer = createServer();
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  console.log('[upgrade]', req.url);
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log('[connected] CLI connected via', req.url);

  ws.on('message', (raw) => {
    const lines = raw.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        console.log('[cli→server]', msg.type, msg.subtype || '');

        // After init, send a test message
        if (msg.type === 'system' && msg.subtype === 'init') {
          console.log('[session_id]', msg.session_id);
          setTimeout(() => {
            const userMsg = JSON.stringify({
              type: 'user',
              message: { role: 'user', content: 'Say hello in exactly 3 words.' },
              parent_tool_use_id: null,
              session_id: msg.session_id,
            });
            console.log('[server→cli] sending user message');
            ws.send(userMsg + '\n');
          }, 500);
        }

        if (msg.type === 'result') {
          console.log('[SUCCESS] Multi-turn exchange complete!');
          process.exit(0);
        }
      } catch (e) {
        // partial line, ignore
      }
    }
  });

  ws.on('close', () => console.log('[disconnected]'));
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}`);

  const cli = spawn('claude', [
    '--sdk-url', `ws://localhost:${PORT}/ws/cli/test`,
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '-p', '',
  ], {
    env: { ...process.env, CLAUDECODE: undefined },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  cli.stdout.on('data', (d) => console.log('[stdout]', d.toString().slice(0, 100)));
  cli.stderr.on('data', (d) => console.log('[stderr]', d.toString().slice(0, 200)));
  cli.on('exit', (code) => {
    console.log('[cli exited]', code);
    if (code !== 0) {
      console.log('[FALLBACK] --sdk-url not supported, will use stdin/stdout pipe approach');
    }
    process.exit(code || 0);
  });

  // Timeout after 30s
  setTimeout(() => {
    console.log('[timeout] killing CLI');
    cli.kill();
    process.exit(1);
  }, 30000);
});
```

- [ ] **Step 2: Run the spike**

```bash
npx tsx scripts/test-sdk-url.ts
```

Expected: Either `[SUCCESS] Multi-turn exchange complete!` or `[FALLBACK]` message. Result determines which WsBridge implementation to use.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-sdk-url.ts
git commit -m "spike: validate --sdk-url CLI WebSocket pattern"
```

---

### Task 2.2: Create WsBridge core

**Files:**
- Create: `src/ws-bridge.ts`

- [ ] **Step 1: Create WsBridge module with session management**

```typescript
import { WebSocket, WebSocketServer } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface WsSession {
  workId: string;
  cliSessionId?: string;
  cliSocket?: WebSocket;
  browserSockets: Set<WebSocket>;
  cliProcess?: ChildProcess;
  idle: boolean;
  messageHistory: Array<{ role: string; content: string; timestamp: string }>;
  pendingMessages: string[];
}

export class WsBridge extends EventEmitter {
  private sessions = new Map<string, WsSession>();
  private wss: WebSocketServer;
  private port: number;

  constructor(port: number) {
    super();
    this.port = port;
    this.wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(req: any, socket: any, head: any) {
    const url = new URL(req.url, `http://localhost:${this.port}`);
    const parts = url.pathname.split('/').filter(Boolean);
    // /ws/cli/:workId or /ws/browser/:workId
    if (parts.length === 3 && parts[0] === 'ws') {
      const type = parts[1]; // 'cli' or 'browser'
      const workId = parts[2];
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        if (type === 'cli') this.handleCliConnection(workId, ws);
        else if (type === 'browser') this.handleBrowserConnection(workId, ws);
        else ws.close();
      });
      return true; // handled
    }
    return false; // not ours
  }

  private ensureSession(workId: string): WsSession {
    if (!this.sessions.has(workId)) {
      this.sessions.set(workId, {
        workId,
        browserSockets: new Set(),
        idle: true,
        messageHistory: [],
        pendingMessages: [],
      });
    }
    return this.sessions.get(workId)!;
  }

  private handleCliConnection(workId: string, ws: WebSocket) {
    const session = this.ensureSession(workId);
    session.cliSocket = ws;

    ws.on('message', (raw) => {
      const lines = raw.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          this.handleCliMessage(session, msg);
        } catch { /* partial line */ }
      }
    });

    ws.on('close', () => {
      session.cliSocket = undefined;
      this.broadcastToBrowser(session, { event: 'session_disconnected', data: { workId } });
    });

    // Flush pending messages
    for (const pending of session.pendingMessages) {
      ws.send(pending + '\n');
    }
    session.pendingMessages = [];
  }

  private handleCliMessage(session: WsSession, msg: any) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      session.cliSessionId = msg.session_id;
      session.idle = true;
      this.broadcastToBrowser(session, { event: 'session_ready', data: { workId: session.workId, sessionId: msg.session_id } });
      this.emit('session_ready', session.workId, msg.session_id);
      return;
    }

    if (msg.type === 'assistant') {
      const text = msg.message?.content
        ?.filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n') || '';
      this.broadcastToBrowser(session, { event: 'agent_message', data: { workId: session.workId, text, raw: msg } });
    }

    if (msg.type === 'result') {
      session.idle = true;
      const text = msg.result || '';
      session.messageHistory.push({ role: 'assistant', content: text, timestamp: new Date().toISOString() });
      this.broadcastToBrowser(session, { event: 'turn_complete', data: { workId: session.workId, result: text } });
      this.emit('turn_complete', session.workId, text);
    }

    // Forward all CLI events to browser for live streaming
    this.broadcastToBrowser(session, { event: 'cli_event', data: { workId: session.workId, msg } });
  }

  private handleBrowserConnection(workId: string, ws: WebSocket) {
    const session = this.ensureSession(workId);
    session.browserSockets.add(ws);

    // Send current state
    ws.send(JSON.stringify({
      event: 'session_state',
      data: {
        workId,
        connected: !!session.cliSocket,
        idle: session.idle,
        cliSessionId: session.cliSessionId,
        messageHistory: session.messageHistory,
      },
    }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === 'send' && msg.text) {
          this.sendMessage(workId, msg.text);
        }
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      session.browserSockets.delete(ws);
    });
  }

  private broadcastToBrowser(session: WsSession, payload: any) {
    const json = JSON.stringify({ ...payload, timestamp: Date.now() });
    for (const ws of session.browserSockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
  }

  async createSession(workId: string, initialPrompt: string, model?: string): Promise<WsSession> {
    const session = this.ensureSession(workId);

    const args = [
      '--sdk-url', `ws://localhost:${this.port}/ws/cli/${workId}`,
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--dangerously-skip-permissions',
    ];
    if (model) args.push('--model', model);
    args.push('-p', '');

    const cli = spawn('claude', args, {
      env: { ...process.env, CLAUDECODE: undefined as any },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.cliProcess = cli;
    session.idle = false;

    cli.stdout?.on('data', (d) => {
      // Debug logging only — real communication via WebSocket
    });

    cli.stderr?.on('data', (d) => {
      const err = d.toString();
      if (err.trim()) this.emit('cli_stderr', workId, err);
    });

    cli.on('exit', (code) => {
      this.emit('cli_exit', workId, code);
      session.cliProcess = undefined;
      // If exited quickly, --sdk-url might not be supported
      if (code !== 0) {
        this.broadcastToBrowser(session, { event: 'session_error', data: { workId, code } });
      }
    });

    // Queue initial prompt — will be sent when CLI connects
    if (initialPrompt) {
      const userMsg = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: initialPrompt },
        parent_tool_use_id: null,
      });
      session.pendingMessages.push(userMsg);
      session.messageHistory.push({ role: 'user', content: initialPrompt, timestamp: new Date().toISOString() });
    }

    return session;
  }

  async resumeSession(workId: string, cliSessionId: string): Promise<WsSession> {
    const session = this.ensureSession(workId);

    const args = [
      '--sdk-url', `ws://localhost:${this.port}/ws/cli/${workId}`,
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--resume', cliSessionId,
    ];

    const cli = spawn('claude', args, {
      env: { ...process.env, CLAUDECODE: undefined as any },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.cliProcess = cli;

    // Detect resume failure: if CLI exits within 5s, create new session
    const resumeTimeout = setTimeout(() => {
      // If we get here, resume succeeded (CLI still running)
    }, 5000);

    cli.on('exit', (code) => {
      clearTimeout(resumeTimeout);
      session.cliProcess = undefined;
      if (code !== 0) {
        this.emit('resume_failed', workId, cliSessionId);
      }
    });

    return session;
  }

  sendMessage(workId: string, text: string): boolean {
    const session = this.sessions.get(workId);
    if (!session) return false;

    session.messageHistory.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
    session.idle = false;

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: session.cliSessionId,
    });

    if (session.cliSocket?.readyState === WebSocket.OPEN) {
      session.cliSocket.send(userMsg + '\n');
    } else {
      session.pendingMessages.push(userMsg);
    }

    this.broadcastToBrowser(session, { event: 'user_message', data: { workId, text } });
    return true;
  }

  killSession(workId: string) {
    const session = this.sessions.get(workId);
    if (!session) return;
    if (session.cliProcess) {
      session.cliProcess.kill('SIGTERM');
      setTimeout(() => session.cliProcess?.kill('SIGKILL'), 5000);
    }
    for (const ws of session.browserSockets) ws.close();
    session.browserSockets.clear();
  }

  getSession(workId: string): WsSession | undefined {
    return this.sessions.get(workId);
  }

  getAllSessions(): Map<string, WsSession> {
    return this.sessions;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ws-bridge.ts
git commit -m "feat: add WsBridge for persistent Claude CLI WebSocket sessions"
```

---

### Task 2.3: Integrate WsBridge into server

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/server/ws.ts`

- [ ] **Step 1: Update server to handle WsBridge upgrade**

In `src/server/index.ts`, import WsBridge and wire up the upgrade handler. The key change: use `noServer: true` for both the legacy WSS and WsBridge, then route by URL in the HTTP `upgrade` event.

At top of `index.ts`:
```typescript
import { WsBridge } from '../ws-bridge.js';
```

Modify the `createServer` function to accept and return a WsBridge instance. In the HTTP server's `upgrade` event, check if WsBridge handles the path first; if not, pass to the legacy WSS.

- [ ] **Step 2: Add work chat/step API routes**

In `src/server/api.ts`, add routes that use WsBridge:

```typescript
// These routes need wsBridge passed in — add as parameter to the route registration function
// or attach to app context

app.post('/api/works/:id/chat', async (c) => {
  const { text } = await c.req.json();
  const workId = c.req.param('id');
  // wsBridge.sendMessage(workId, text) — wsBridge reference via closure or context
  return c.json({ sent: true });
});

app.post('/api/works/:id/step/:step', async (c) => {
  const workId = c.req.param('id');
  const step = c.req.param('step');
  // Trigger specific pipeline step via wsBridge prompt
  return c.json({ triggered: true });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts src/server/ws.ts src/server/api.ts
git commit -m "feat: integrate WsBridge into Hono server with upgrade routing"
```

---

## Chunk 3: Frontend — Studio + Chat (Module 6 partial)

Creation workspace replacing FeatureDetail, with real-time chat panel.

### Task 3.1: Add WebSocket per-work connection

**Files:**
- Modify: `web/src/lib/ws.ts`

- [ ] **Step 1: Add createWorkWs function**

Append to `web/src/lib/ws.ts`:

```typescript
export function createWorkWs(workId: string, onEvent: (event: string, data: any) => void): {
  send: (text: string) => void;
  close: () => void;
} {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${location.host}/ws/browser/${workId}`;
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;

  function connect() {
    ws = new WebSocket(url);
    ws.onopen = () => { reconnectDelay = 1000; };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        onEvent(msg.event, msg.data);
      } catch {}
    };
    ws.onclose = () => {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
    };
  }

  connect();

  return {
    send(text: string) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'send', text }));
      }
    },
    close() {
      reconnectDelay = Infinity; // prevent reconnect
      ws?.close();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/ws.ts
git commit -m "feat: add per-work WebSocket connection for Studio"
```

---

### Task 3.2: Add i18n strings for new UI

**Files:**
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 1: Add all new translation keys**

Add to both `en` and `zh` objects in `i18n.ts`:

```typescript
// English additions:
studio: 'Studio',
memory: 'Memory',
newWork: 'New Work',
selectType: 'Content Type',
selectPlatforms: 'Platforms',
topicHint: 'Topic (optional)',
shortVideo: 'Short Video',
imageText: 'Image & Text',
longVideo: 'Long Video',
livestream: 'Livestream',
xiaohongshu: 'Xiaohongshu',
douyin: 'Douyin',
create: 'Create',
cancel: 'Cancel',
chatPlaceholder: 'Type your feedback...',
send: 'Send',
regenerate: 'Regenerate',
nextStep: 'Next Step',
redoStep: 'Redo Step',
publish: 'Publish',
pipelineSteps: 'Pipeline Steps',
chatWithAgent: 'Chat with Agent',
sessionConnecting: 'Connecting to Agent...',
sessionReady: 'Agent ready',
stepPending: 'Pending',
stepRunning: 'Running...',
stepCompleted: 'Completed',
stepFailed: 'Failed',
workDraft: 'Draft',
workCreating: 'Creating',
workReady: 'Ready to Publish',
workPublishing: 'Publishing...',
workPublished: 'Published',
workFailed: 'Failed',
confirmDelete: 'Delete this work?',
noWorks: 'No works yet. Create your first one!',
styleProfile: 'Style Profile',
learnedRules: 'Learned Rules',
memorySearch: 'Search Memories',

// Chinese additions (corresponding):
// studio: '创作工坊',
// memory: '记忆',
// newWork: '新建作品',
// ... (all translations)
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/i18n.ts
git commit -m "feat: add i18n strings for Studio, Memory, and all new UI"
```

---

### Task 3.3: Create ChatPanel component

**Files:**
- Create: `web/src/components/ChatPanel.svelte`

- [ ] **Step 1: Create ChatPanel**

```svelte
<script>
  let { messages = [], onSend, disabled = false, placeholder = '' } = $props();
  let inputText = $state('');
  let messagesDiv;

  function handleSend() {
    if (!inputText.trim() || disabled) return;
    onSend(inputText.trim());
    inputText = '';
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  $effect(() => {
    if (messagesDiv && messages.length) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  });
</script>

<div class="chat-panel">
  <div class="chat-messages" bind:this={messagesDiv}>
    {#each messages as msg}
      <div class="chat-msg {msg.role}">
        <div class="chat-role">{msg.role === 'user' ? 'You' : 'Agent'}</div>
        <div class="chat-text">{msg.content}</div>
      </div>
    {/each}
  </div>
  <div class="chat-input-area">
    <textarea
      bind:value={inputText}
      onkeydown={handleKeydown}
      {placeholder}
      {disabled}
      rows="2"
    ></textarea>
    <button onclick={handleSend} disabled={disabled || !inputText.trim()}>Send</button>
  </div>
</div>

<style>
  .chat-panel { display: flex; flex-direction: column; height: 100%; }
  .chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .chat-msg { padding: 8px 12px; border-radius: 8px; font-size: 13px; max-width: 90%; }
  .chat-msg.user { background: var(--glass-surface, rgba(134,120,191,0.15)); align-self: flex-end; border-bottom-right-radius: 2px; }
  .chat-msg.assistant { background: var(--glass-surface-alt, rgba(52,211,153,0.1)); align-self: flex-start; border-bottom-left-radius: 2px; }
  .chat-role { font-size: 10px; opacity: 0.6; margin-bottom: 2px; }
  .chat-input-area { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--border, rgba(255,255,255,0.08)); }
  .chat-input-area textarea { flex: 1; background: var(--input-bg, rgba(255,255,255,0.06)); border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 8px; padding: 8px; color: inherit; resize: none; font-family: inherit; font-size: 13px; }
  .chat-input-area button { padding: 8px 16px; background: var(--accent, #8678bf); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
  .chat-input-area button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ChatPanel.svelte
git commit -m "feat: add ChatPanel component"
```

---

### Task 3.4: Create PipelineSteps component

**Files:**
- Create: `web/src/components/PipelineSteps.svelte`

- [ ] **Step 1: Create PipelineSteps sidebar**

```svelte
<script>
  let { pipeline = {}, contentType = '', platforms = [], currentStep = '', onStepClick } = $props();

  const stepLabels = {
    'short-video': ['爆款选题', '趋势混搭', '差异化分析', '脚本分镜', '视频制作指导', '发布+复盘'],
    'image-text': ['选题策划', '文案撰写', '图片规划', '排版设计指导', '封面优化', '发布+复盘'],
    'long-video': ['主题研究', '大纲编排', '详细脚本', '分镜头脚本', '后期指导', '发布+复盘'],
    'livestream': ['直播主题', '流程编排', '话术脚本', '互动设计', '预热文案', '预约+复盘'],
  };

  const labels = $derived(stepLabels[contentType] || stepLabels['short-video']);
  const stepKeys = $derived(Object.keys(pipeline));

  function statusIcon(status) {
    if (status === 'completed') return '✓';
    if (status === 'running') return '●';
    if (status === 'failed') return '✗';
    return '';
  }

  function statusClass(status) {
    return `step-${status}`;
  }
</script>

<div class="pipeline-steps">
  {#each stepKeys as key, i}
    {@const step = pipeline[key]}
    <button
      class="step-item {statusClass(step.status)} {currentStep === key ? 'active' : ''}"
      onclick={() => onStepClick(key)}
    >
      <span class="step-icon">{statusIcon(step.status)}</span>
      <span class="step-num">{i + 1}.</span>
      <span class="step-label">{labels[i] || key}</span>
      {#if step.status === 'running'}
        <span class="step-badge">running</span>
      {/if}
    </button>
  {/each}

  <div class="step-meta">
    <div class="meta-label">TYPE</div>
    <div class="meta-value">{contentType}</div>
    <div class="meta-label" style="margin-top:8px;">PLATFORMS</div>
    <div class="meta-value">{platforms.map(p => p.name).join(', ')}</div>
  </div>
</div>

<style>
  .pipeline-steps { padding: 16px; display: flex; flex-direction: column; gap: 6px; }
  .step-item { display: flex; align-items: center; gap: 6px; padding: 10px; border-radius: 8px; border: 1px solid var(--border, rgba(255,255,255,0.08)); background: transparent; color: inherit; cursor: pointer; text-align: left; font-size: 12px; width: 100%; }
  .step-item.active { border-color: var(--accent, #8678bf); background: rgba(134,120,191,0.1); }
  .step-completed { border-color: rgba(52,211,153,0.3); background: rgba(52,211,153,0.08); }
  .step-running { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.08); }
  .step-failed { border-color: rgba(251,113,133,0.3); background: rgba(251,113,133,0.08); }
  .step-pending { opacity: 0.5; }
  .step-icon { width: 16px; font-size: 14px; }
  .step-completed .step-icon { color: #34d399; }
  .step-running .step-icon { color: #f59e0b; }
  .step-failed .step-icon { color: #fb7185; }
  .step-num { color: var(--text-muted); }
  .step-label { flex: 1; }
  .step-badge { font-size: 9px; background: rgba(245,158,11,0.2); color: #f59e0b; padding: 2px 6px; border-radius: 4px; }
  .step-meta { margin-top: 16px; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.03); font-size: 11px; }
  .meta-label { color: var(--text-muted); font-size: 9px; text-transform: uppercase; }
  .meta-value { font-weight: bold; margin-top: 2px; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/PipelineSteps.svelte
git commit -m "feat: add PipelineSteps sidebar component"
```

---

### Task 3.5: Create NewWorkModal component

**Files:**
- Create: `web/src/components/NewWorkModal.svelte`

- [ ] **Step 1: Create modal for new work creation**

```svelte
<script>
  let { open = false, onClose, onCreate } = $props();
  let title = $state('');
  let type = $state('short-video');
  let selectedPlatforms = $state(['xiaohongshu']);
  let topicHint = $state('');

  const types = [
    { value: 'short-video', label: '🎬 短视频', desc: 'Short Video' },
    { value: 'image-text', label: '📷 图文', desc: 'Image & Text' },
    { value: 'long-video', label: '🎥 长视频', desc: 'Long Video' },
    { value: 'livestream', label: '📡 直播', desc: 'Livestream' },
  ];

  const platforms = [
    { value: 'xiaohongshu', label: '小红书' },
    { value: 'douyin', label: '抖音' },
  ];

  function togglePlatform(val) {
    if (selectedPlatforms.includes(val)) {
      if (selectedPlatforms.length > 1) selectedPlatforms = selectedPlatforms.filter(p => p !== val);
    } else {
      selectedPlatforms = [...selectedPlatforms, val];
    }
  }

  function handleCreate() {
    onCreate({ title: title || '新作品', type, platforms: selectedPlatforms, topicHint: topicHint || undefined });
    title = ''; topicHint = '';
    onClose();
  }
</script>

{#if open}
<div class="modal-overlay" onclick={onClose}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <h3>新建作品</h3>

    <label>标题</label>
    <input bind:value={title} placeholder="作品标题（可选）" />

    <label>内容类型</label>
    <div class="type-grid">
      {#each types as t}
        <button class="type-btn {type === t.value ? 'selected' : ''}" onclick={() => type = t.value}>
          {t.label}
        </button>
      {/each}
    </div>

    <label>发布平台</label>
    <div class="platform-row">
      {#each platforms as p}
        <button class="plat-btn {selectedPlatforms.includes(p.value) ? 'selected' : ''}" onclick={() => togglePlatform(p.value)}>
          {p.label}
        </button>
      {/each}
    </div>

    <label>选题提示（可选）</label>
    <textarea bind:value={topicHint} rows="2" placeholder="给 AI 一个方向，或留空让 AI 自由发挥"></textarea>

    <div class="modal-actions">
      <button class="btn-secondary" onclick={onClose}>取消</button>
      <button class="btn-primary" onclick={handleCreate}>开始创作</button>
    </div>
  </div>
</div>
{/if}

<style>
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal-content { background: var(--bg-surface, #1a1b2e); border-radius: 16px; padding: 24px; width: 420px; max-width: 90vw; }
  h3 { margin: 0 0 16px; }
  label { display: block; font-size: 12px; color: var(--text-muted); margin: 12px 0 6px; text-transform: uppercase; }
  input, textarea { width: 100%; background: var(--input-bg, rgba(255,255,255,0.06)); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; color: inherit; font-family: inherit; font-size: 13px; box-sizing: border-box; }
  .type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .type-btn { padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; font-size: 13px; }
  .type-btn.selected { border-color: var(--accent, #8678bf); background: rgba(134,120,191,0.15); }
  .platform-row { display: flex; gap: 8px; }
  .plat-btn { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; }
  .plat-btn.selected { border-color: #34d399; background: rgba(52,211,153,0.15); }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
  .btn-secondary { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; }
  .btn-primary { padding: 8px 20px; border-radius: 8px; border: none; background: var(--accent, #8678bf); color: white; cursor: pointer; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/NewWorkModal.svelte
git commit -m "feat: add NewWorkModal for content type and platform selection"
```

---

### Task 3.6: Create Studio page

**Files:**
- Create: `web/src/pages/Studio.svelte`

- [ ] **Step 1: Create three-panel Studio layout**

This is the main creation workspace. Left: PipelineSteps, Center: Agent output, Right: ChatPanel.

```svelte
<script>
  import PipelineSteps from '../components/PipelineSteps.svelte';
  import ChatPanel from '../components/ChatPanel.svelte';
  import { fetchWork, updateWorkApi } from '../lib/api';
  import { createWorkWs } from '../lib/ws';

  let { workId, onBack } = $props();

  let work = $state(null);
  let currentStep = $state('');
  let agentOutput = $state('');
  let agentStreaming = $state(false);
  let messages = $state([]);
  let sessionReady = $state(false);
  let wsConn = $state(null);

  $effect(() => {
    if (workId) loadWork();
    return () => { wsConn?.close(); };
  });

  async function loadWork() {
    work = await fetchWork(workId);
    if (work) {
      const steps = Object.keys(work.pipeline);
      // Find current step: first non-completed, or last
      currentStep = steps.find(k => work.pipeline[k].status !== 'completed') || steps[steps.length - 1];
      connectWs();
    }
  }

  function connectWs() {
    wsConn = createWorkWs(workId, (event, data) => {
      if (event === 'session_ready') sessionReady = true;
      if (event === 'session_state') {
        sessionReady = data.connected;
        if (data.messageHistory) messages = data.messageHistory;
      }
      if (event === 'agent_message') {
        agentOutput += data.text;
        agentStreaming = true;
      }
      if (event === 'turn_complete') {
        agentStreaming = false;
        messages = [...messages, { role: 'assistant', content: data.result }];
      }
      if (event === 'user_message') {
        messages = [...messages, { role: 'user', content: data.text }];
      }
    });
  }

  function handleSend(text) {
    wsConn?.send(text);
    agentOutput = '';
  }

  function handleStepClick(key) {
    currentStep = key;
    const step = work?.pipeline[key];
    if (step?.result) agentOutput = step.result;
    else agentOutput = '';
  }
</script>

<div class="studio">
  <div class="studio-header">
    <button class="back-btn" onclick={onBack}>← Back</button>
    <h2>{work?.title || 'Loading...'}</h2>
    <span class="status-badge {work?.status || ''}">{work?.status || ''}</span>
  </div>

  <div class="studio-body">
    <!-- Left: Pipeline -->
    <div class="studio-left">
      {#if work}
        <PipelineSteps
          pipeline={work.pipeline}
          contentType={work.type}
          platforms={work.platforms}
          {currentStep}
          onStepClick={handleStepClick}
        />
      {/if}
    </div>

    <!-- Center: Agent Output -->
    <div class="studio-center">
      <div class="step-header">
        <h3>{currentStep}</h3>
        {#if agentStreaming}
          <span class="streaming-indicator">● generating...</span>
        {/if}
      </div>
      <div class="agent-output">
        {#if agentOutput}
          <div class="output-content">{@html agentOutput.replace(/\n/g, '<br>')}</div>
        {:else}
          <div class="output-empty">Click a step or send a message to start.</div>
        {/if}
      </div>
    </div>

    <!-- Right: Chat -->
    <div class="studio-right">
      <div class="chat-header">Chat with Agent</div>
      <ChatPanel
        {messages}
        onSend={handleSend}
        disabled={!sessionReady}
        placeholder={sessionReady ? 'Type your feedback...' : 'Connecting...'}
      />
    </div>
  </div>
</div>

<style>
  .studio { display: flex; flex-direction: column; height: 100vh; }
  .studio-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .back-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; padding: 4px 8px; }
  .studio-header h2 { flex: 1; margin: 0; font-size: 16px; }
  .status-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.06); }
  .studio-body { display: grid; grid-template-columns: 260px 1fr 300px; flex: 1; overflow: hidden; }
  .studio-left { border-right: 1px solid var(--border); overflow-y: auto; }
  .studio-center { padding: 16px; overflow-y: auto; }
  .studio-right { border-left: 1px solid var(--border); display: flex; flex-direction: column; }
  .chat-header { padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: bold; font-size: 13px; }
  .step-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .step-header h3 { margin: 0; font-size: 15px; }
  .streaming-indicator { color: #f59e0b; font-size: 12px; }
  .agent-output { background: rgba(52,211,153,0.05); border-radius: 8px; padding: 16px; min-height: 200px; font-size: 13px; line-height: 1.8; }
  .output-empty { color: var(--text-muted); text-align: center; padding: 40px; }

  @media (max-width: 768px) {
    .studio-body { grid-template-columns: 1fr; }
    .studio-left, .studio-right { display: none; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/Studio.svelte
git commit -m "feat: add Studio page with three-panel creation workspace"
```

---

### Task 3.7: Update App.svelte navigation

**Files:**
- Modify: `web/src/App.svelte`

- [ ] **Step 1: Add Studio and Memory tabs, wire up routing**

Key changes to App.svelte:
1. Change tabs from `['works', 'explore', 'analytics']` to `['works', 'studio', 'explore', 'analytics', 'memory']`
2. Import Studio component
3. Replace mock works array with `fetchWorks()` API call
4. When clicking a work → navigate to Studio tab with workId
5. Replace "New Work" card click with NewWorkModal
6. Add NewWorkModal import and state
7. On create → POST /api/works → navigate to Studio

This is a large modification — the implementer should read the existing App.svelte (1082 lines) and make targeted edits to the tab array, the view switching logic, and the works gallery section. Key areas:
- Line 24-25: tab definitions → add 'studio' and 'memory'
- Line 55-61: mock works array → replace with API fetch
- Line 68-77: mock metric updates → remove
- The gallery section: wire "+" card to NewWorkModal, work cards to Studio navigation

- [ ] **Step 2: Commit**

```bash
git add web/src/App.svelte
git commit -m "feat: add Studio/Memory tabs, replace mock works with API"
```

---

## Chunk 4: Publish Engine (Module 3)

Playwright browser automation for publishing to Xiaohongshu and Douyin.

### Task 4.1: Add Playwright as optional dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add playwright to optionalDependencies**

```json
"optionalDependencies": {
  "playwright": "^1.49.0"
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add playwright as optional dependency"
```

---

### Task 4.2: Create PlatformAdapter base

**Files:**
- Create: `src/platforms/base.ts`

- [ ] **Step 1: Define adapter interface and helper**

```typescript
export interface PublishContent {
  title: string;
  body: string;
  tags: string[];
  mediaFiles: string[];  // absolute paths to images/videos
  coverImage?: string;
  scheduledAt?: string;
}

export interface PublishResult {
  success: boolean;
  postUrl?: string;
  screenshotPath?: string;
  error?: string;
}

export interface Metrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collectedAt: string;
}

export interface TrendVideo {
  title: string;
  url: string;
  views: number;
  likes: number;
  comments: number;
  creator: string;
  thumbnail?: string;
}

export interface TrendTag {
  name: string;
  postCount: number;
  trend: 'up' | 'down' | 'stable';
}

export interface TrendData {
  platform: string;
  collectedAt: string;
  videos: TrendVideo[];
  tags: TrendTag[];
}

export interface CompetitorData {
  platform: string;
  profileUrl: string;
  name: string;
  recentPosts: Array<{ title: string; url: string; views: number; likes: number; publishedAt: string }>;
  collectedAt: string;
}

export interface PlatformAdapter {
  name: string;
  loginUrl: string;
  publishUrl: string;
  checkLogin(page: any): Promise<boolean>;
  login(page: any): Promise<void>;
  publish(page: any, content: PublishContent): Promise<PublishResult>;
  scrapeMetrics(page: any, postUrl: string): Promise<Metrics>;
  scrapeTrending(page: any): Promise<TrendData>;
  scrapeCompetitor(page: any, profileUrl: string): Promise<CompetitorData>;
}

export async function loadPlaywright(): Promise<any | null> {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/platforms/base.ts
git commit -m "feat: add PlatformAdapter interface and types"
```

---

### Task 4.3: Create Xiaohongshu adapter

**Files:**
- Create: `src/platforms/xiaohongshu.ts`

- [ ] **Step 1: Implement Xiaohongshu adapter**

```typescript
import { PlatformAdapter, PublishContent, PublishResult, Metrics, TrendData, CompetitorData } from './base.js';
import { join } from 'path';

const AUTH_DIR = join(process.env.HOME || '~', '.skill-evolver', 'auth', 'xiaohongshu');

export class XiaohongshuAdapter implements PlatformAdapter {
  name = 'xiaohongshu';
  loginUrl = 'https://creator.xiaohongshu.com';
  publishUrl = 'https://creator.xiaohongshu.com/publish/publish';

  async checkLogin(page: any): Promise<boolean> {
    try {
      await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 10000 });
      // If redirected to login page, not logged in
      return !page.url().includes('/login');
    } catch { return false; }
  }

  async login(page: any): Promise<void> {
    await page.goto(this.loginUrl + '/login', { waitUntil: 'networkidle' });
    // User scans QR code manually — wait for redirect away from login
    await page.waitForURL((url: any) => !url.toString().includes('/login'), { timeout: 120000 });
  }

  async publish(page: any, content: PublishContent): Promise<PublishResult> {
    try {
      await page.goto(this.publishUrl, { waitUntil: 'networkidle' });

      // Upload media
      for (const file of content.mediaFiles) {
        const input = await page.locator('input[type="file"]').first();
        await input.setInputFiles(file);
        await page.waitForTimeout(2000);
      }

      // Fill title (if available)
      const titleInput = page.locator('[placeholder*="标题"]').first();
      if (await titleInput.isVisible()) {
        await titleInput.fill(content.title.slice(0, 20));
      }

      // Fill body
      const bodyInput = page.locator('[contenteditable="true"]').first();
      if (await bodyInput.isVisible()) {
        await bodyInput.fill(content.body.slice(0, 1000));
      }

      // Add tags
      for (const tag of content.tags.slice(0, 10)) {
        const tagInput = page.locator('[placeholder*="话题"]').first();
        if (await tagInput.isVisible()) {
          await tagInput.fill(tag);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
        }
      }

      // Screenshot before publish
      const screenshotPath = join(AUTH_DIR, `publish_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath });

      // Click publish button
      const publishBtn = page.locator('button:has-text("发布")').first();
      await publishBtn.click();
      await page.waitForTimeout(3000);

      // Try to get post URL from redirect or success page
      const postUrl = page.url();

      return { success: true, postUrl, screenshotPath };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  async scrapeMetrics(page: any, postUrl: string): Promise<Metrics> {
    await page.goto(postUrl, { waitUntil: 'networkidle', timeout: 15000 });
    // Selectors will vary — store in external config for maintainability
    const getText = async (sel: string) => {
      try { return await page.locator(sel).first().textContent() || '0'; } catch { return '0'; }
    };
    const parseNum = (s: string) => parseInt(s.replace(/[^0-9]/g, '')) || 0;

    return {
      views: 0, // Xiaohongshu doesn't always show views publicly
      likes: parseNum(await getText('[class*="like"] span')),
      comments: parseNum(await getText('[class*="comment"] span')),
      shares: parseNum(await getText('[class*="collect"] span')),
      collectedAt: new Date().toISOString(),
    };
  }

  async scrapeTrending(page: any): Promise<TrendData> {
    await page.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'networkidle', timeout: 15000 });
    const videos: any[] = [];
    const cards = await page.locator('[class*="note-item"]').all();
    for (const card of cards.slice(0, 20)) {
      try {
        const title = await card.locator('[class*="title"]').textContent() || '';
        const likes = await card.locator('[class*="like"]').textContent() || '0';
        videos.push({ title: title.trim(), url: '', views: 0, likes: parseInt(likes.replace(/\D/g, '')) || 0, comments: 0, creator: '', thumbnail: '' });
      } catch { continue; }
    }
    return { platform: 'xiaohongshu', collectedAt: new Date().toISOString(), videos, tags: [] };
  }

  async scrapeCompetitor(page: any, profileUrl: string): Promise<CompetitorData> {
    await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 15000 });
    return { platform: 'xiaohongshu', profileUrl, name: '', recentPosts: [], collectedAt: new Date().toISOString() };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/platforms/xiaohongshu.ts
git commit -m "feat: add Xiaohongshu platform adapter"
```

---

### Task 4.4: Create Douyin adapter

**Files:**
- Create: `src/platforms/douyin.ts`

- [ ] **Step 1: Implement Douyin adapter (same pattern as Xiaohongshu)**

Follow the same structure as `xiaohongshu.ts` but with Douyin-specific URLs and selectors:
- `loginUrl`: `https://creator.douyin.com`
- `publishUrl`: `https://creator.douyin.com/creator-micro/content/upload`
- Different selectors for title, description, tags
- Different content limits (description ≤4000, tags ≤5)

- [ ] **Step 2: Commit**

```bash
git add src/platforms/douyin.ts
git commit -m "feat: add Douyin platform adapter"
```

---

### Task 4.5: Create publish-engine orchestrator

**Files:**
- Create: `src/publish-engine.ts`

- [ ] **Step 1: Create PublishEngine class**

```typescript
import { loadPlaywright, PlatformAdapter, PublishContent, PublishResult } from './platforms/base.js';
import { XiaohongshuAdapter } from './platforms/xiaohongshu.js';
import { DouyinAdapter } from './platforms/douyin.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const AUTH_BASE = join(process.env.HOME || '~', '.skill-evolver', 'auth');

export class PublishEngine {
  private adapters: Map<string, PlatformAdapter> = new Map();
  private playwright: any = null;
  private contexts: Map<string, any> = new Map();
  private dailyPublishCount: Map<string, number> = new Map();
  private MAX_DAILY = 5;

  constructor() {
    this.adapters.set('xiaohongshu', new XiaohongshuAdapter());
    this.adapters.set('douyin', new DouyinAdapter());
  }

  async init(): Promise<boolean> {
    this.playwright = await loadPlaywright();
    return !!this.playwright;
  }

  isAvailable(): boolean {
    return !!this.playwright;
  }

  getAdapter(platform: string): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  private async getContext(platform: string, headless = true): Promise<any> {
    if (!this.playwright) throw new Error('Playwright not installed');
    const key = `${platform}_${headless}`;
    if (this.contexts.has(key)) return this.contexts.get(key);

    const userDataDir = join(AUTH_BASE, platform);
    if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

    const context = await this.playwright.chromium.launchPersistentContext(userDataDir, {
      headless,
      viewport: { width: 1280, height: 800 },
    });
    this.contexts.set(key, context);
    return context;
  }

  async checkLoginStatus(platform: string): Promise<boolean> {
    const adapter = this.adapters.get(platform);
    if (!adapter || !this.playwright) return false;
    try {
      const context = await this.getContext(platform);
      const page = await context.newPage();
      const result = await adapter.checkLogin(page);
      await page.close();
      return result;
    } catch { return false; }
  }

  async openLogin(platform: string): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (!adapter || !this.playwright) throw new Error(`Platform ${platform} unavailable`);
    const context = await this.getContext(platform, false); // visible!
    const page = await context.newPage();
    await adapter.login(page);
    // Don't close — let user verify login
  }

  async publish(platform: string, content: PublishContent): Promise<PublishResult> {
    // Rate limit check
    const today = new Date().toISOString().split('T')[0];
    const key = `${platform}_${today}`;
    const count = this.dailyPublishCount.get(key) || 0;
    if (count >= this.MAX_DAILY) {
      return { success: false, error: `Daily limit (${this.MAX_DAILY}) reached for ${platform}` };
    }

    const adapter = this.adapters.get(platform);
    if (!adapter || !this.playwright) return { success: false, error: 'Platform unavailable' };

    const context = await this.getContext(platform);
    const page = await context.newPage();

    // Check login
    if (!(await adapter.checkLogin(page))) {
      await page.close();
      return { success: false, error: 'Not logged in' };
    }

    const result = await adapter.publish(page, content);
    await page.close();

    if (result.success) {
      this.dailyPublishCount.set(key, count + 1);
    }
    return result;
  }

  async close() {
    for (const ctx of this.contexts.values()) {
      try { await ctx.close(); } catch {}
    }
    this.contexts.clear();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/publish-engine.ts
git commit -m "feat: add PublishEngine orchestrator with rate limiting and login management"
```

---

### Task 4.6: Add publish API routes

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: Add platform and publish routes**

```typescript
// Import PublishEngine — initialized in server/index.ts and passed to api
app.get('/api/platforms', async (c) => {
  const platforms = ['xiaohongshu', 'douyin'];
  const statuses = await Promise.all(platforms.map(async p => ({
    name: p,
    available: publishEngine.isAvailable(),
    loggedIn: await publishEngine.checkLoginStatus(p),
  })));
  return c.json(statuses);
});

app.post('/api/platforms/:name/login', async (c) => {
  const name = c.req.param('name');
  try {
    await publishEngine.openLogin(name);
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/platforms/:name/status', async (c) => {
  const loggedIn = await publishEngine.checkLoginStatus(c.req.param('name'));
  return c.json({ loggedIn });
});

app.post('/api/works/:id/publish', async (c) => {
  const { platforms } = await c.req.json();
  const work = getWork(c.req.param('id'));
  if (!work) return c.json({ error: 'not found' }, 404);
  // Publish logic: format content per platform, call publishEngine.publish()
  // Update work status, store results
  return c.json({ triggered: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add platform login and publish API routes"
```

---

## Chunk 5: Data Collector (Module 4)

Playwright-based metric scraping and trend collection.

### Task 5.1: Create data-collector.ts

**Files:**
- Create: `src/data-collector.ts`

- [ ] **Step 1: Create DataCollector class**

```typescript
import { PublishEngine } from './publish-engine.js';
import { listWorks, getWork, updateWork, Work } from './work-store.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const DATA_DIR = join(process.env.HOME || '~', '.skill-evolver');
const TRENDS_DIR = join(DATA_DIR, 'trends');

export class DataCollector {
  private publishEngine: PublishEngine;
  private circuitBreaker: Map<string, number> = new Map(); // platform → consecutive failures

  constructor(publishEngine: PublishEngine) {
    this.publishEngine = publishEngine;
  }

  // Determine if metrics should be collected based on publish age
  shouldCollectMetrics(publishedAt: string): { should: boolean; reason: string } {
    const age = Date.now() - new Date(publishedAt).getTime();
    const hours = age / (1000 * 60 * 60);
    const days = hours / 24;

    if (days > 30) return { should: false, reason: 'content lifecycle over' };
    if (days > 7) return { should: true, reason: 'weekly' };
    if (days > 2) return { should: true, reason: 'daily' };
    if (hours >= 4) return { should: true, reason: '4h-interval' };
    return { should: false, reason: 'too soon' };
  }

  async collectPostMetrics(): Promise<{ collected: number; errors: number }> {
    if (!this.publishEngine.isAvailable()) return { collected: 0, errors: 0 };
    let collected = 0, errors = 0;

    const works = listWorks().filter(w => w.status === 'published');
    for (const summary of works) {
      const work = getWork(summary.id);
      if (!work) continue;

      for (const platform of work.platforms) {
        if (!platform.postUrl || !platform.publishedAt) continue;

        const { should } = this.shouldCollectMetrics(platform.publishedAt);
        if (!should) continue;

        // Circuit breaker
        const failures = this.circuitBreaker.get(platform.name) || 0;
        if (failures >= 5) continue;

        try {
          const adapter = this.publishEngine.getAdapter(platform.name);
          if (!adapter) continue;

          // Use publish engine's browser context
          const metrics = await adapter.scrapeMetrics(null as any, platform.postUrl);
          platform.metrics = { ...metrics, lastUpdated: new Date().toISOString() };
          if (!platform.metricsHistory) platform.metricsHistory = [];
          platform.metricsHistory.push({
            timestamp: new Date().toISOString(),
            views: metrics.views, likes: metrics.likes,
            comments: metrics.comments, shares: metrics.shares,
          });
          updateWork(work.id, { platforms: work.platforms });
          this.circuitBreaker.set(platform.name, 0);
          collected++;
        } catch {
          this.circuitBreaker.set(platform.name, failures + 1);
          errors++;
        }
      }
    }
    return { collected, errors };
  }

  async collectTrends(platforms: string[] = ['xiaohongshu', 'douyin']): Promise<{ collected: number }> {
    if (!this.publishEngine.isAvailable()) return { collected: 0 };
    let collected = 0;

    for (const name of platforms) {
      const failures = this.circuitBreaker.get(name) || 0;
      if (failures >= 5) continue;

      try {
        const adapter = this.publishEngine.getAdapter(name);
        if (!adapter) continue;

        const data = await adapter.scrapeTrending(null as any);
        const dir = join(TRENDS_DIR, name);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const date = new Date().toISOString().split('T')[0];
        const file = join(dir, `${date}.yaml`);
        writeFileSync(file, yaml.dump(data, { lineWidth: 120 }), 'utf-8');
        this.circuitBreaker.set(name, 0);
        collected++;
      } catch {
        this.circuitBreaker.set(name, (this.circuitBreaker.get(name) || 0) + 1);
      }
    }
    return { collected };
  }

  getLatestTrends(platform: string): any | null {
    const dir = join(TRENDS_DIR, platform);
    if (!existsSync(dir)) return null;
    const files = require('fs').readdirSync(dir).filter((f: string) => f.endsWith('.yaml')).sort().reverse();
    if (!files.length) return null;
    try { return yaml.load(readFileSync(join(dir, files[0]), 'utf-8')); } catch { return null; }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/data-collector.ts
git commit -m "feat: add DataCollector with metric scraping and trend collection"
```

---

### Task 5.2: Add collector and trend API routes

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: Add routes**

```typescript
app.get('/api/trends/:platform', (c) => {
  const data = dataCollector.getLatestTrends(c.req.param('platform'));
  if (!data) return c.json({ videos: [], tags: [] });
  return c.json(data);
});

app.get('/api/analytics', (c) => {
  // Aggregate from all published works
  const works = listWorks().filter(w => w.status === 'published');
  let totalViews = 0, totalLikes = 0, totalComments = 0;
  for (const summary of works) {
    const work = getWork(summary.id);
    if (!work) continue;
    for (const p of work.platforms) {
      totalViews += p.metrics?.views || 0;
      totalLikes += p.metrics?.likes || 0;
      totalComments += p.metrics?.comments || 0;
    }
  }
  return c.json({ totalWorks: works.length, totalViews, totalLikes, totalComments });
});

app.post('/api/collector/trigger', async (c) => {
  const [metrics, trends] = await Promise.all([
    dataCollector.collectPostMetrics(),
    dataCollector.collectTrends(),
  ]);
  return c.json({ metrics, trends });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add trends, analytics, and collector trigger API routes"
```

---

## Chunk 6: EverMemOS Integration (Module 5)

Memory system using EverMemOS REST API.

### Task 6.1: Create memory client

**Files:**
- Create: `src/memory.ts`

- [ ] **Step 1: Create MemoryClient**

```typescript
import { loadConfig } from './config.js';

const API_BASE = 'https://api.evermind.ai/api/v0';

interface MemoryPayload {
  content: string;
  groupId: string;
  groupName: string;
  role?: string;
  senderName?: string;
}

interface SearchOptions {
  method?: 'keyword' | 'vector' | 'hybrid' | 'agentic';
  topK?: number;
  memoryTypes?: string[];
  groupIds?: string[];
}

interface SearchResult {
  memories: Array<{ memory_id: string; memory_type: string; content: string; summary?: string; score: number; timestamp: string }>;
  profiles: Array<{ item_type: string; category: string; trait_name: string; description: string; score: number }>;
}

export class MemoryClient {
  private apiKey: string;
  private userId: string;

  constructor() {
    const config = loadConfig();
    this.apiKey = config.memory?.apiKey || '';
    this.userId = config.memory?.userId || 'autoviral-user';
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private async fetch(path: string, options: any = {}): Promise<any> {
    if (!this.apiKey) return null;
    const url = `${API_BASE}${path}`;
    const res = await globalThis.fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(`EverMemOS ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    if (!this.apiKey) return { memories: [], profiles: [] };
    try {
      const result = await this.fetch('/memories/search', {
        method: 'GET',
        body: JSON.stringify({
          user_id: this.userId,
          query,
          retrieve_method: options.method || 'hybrid',
          top_k: options.topK || 10,
          memory_types: options.memoryTypes,
          group_ids: options.groupIds,
        }),
      });
      return result?.result || { memories: [], profiles: [] };
    } catch {
      return { memories: [], profiles: [] };
    }
  }

  async addMemory(payload: MemoryPayload): Promise<void> {
    if (!this.apiKey) return;
    try {
      await this.fetch('/memories', {
        method: 'POST',
        body: JSON.stringify({
          message_id: `autoviral_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          create_time: new Date().toISOString(),
          sender: payload.senderName || 'autoviral',
          sender_name: payload.senderName || 'AutoViral',
          content: payload.content,
          group_id: payload.groupId,
          group_name: payload.groupName,
          role: payload.role || 'assistant',
        }),
      });
    } catch {
      // Queue for retry — silently fail for now
    }
  }

  async buildContext(workTopic: string, platform: string): Promise<string> {
    if (!this.apiKey) return '';

    const [related, style, rules, competitor] = await Promise.all([
      this.search(`${workTopic} 创作 内容`, { topK: 5 }),
      this.search('style_profile', { memoryTypes: ['profile'], topK: 3 }),
      this.search(`platform_rules ${platform}`, { memoryTypes: ['profile'], topK: 5 }),
      this.search('competitor 竞品', { topK: 3 }),
    ]);

    const sections: string[] = ['## 你的创作记忆\n'];

    if (style.profiles.length) {
      sections.push('### 风格画像');
      sections.push(style.profiles.map(p => `- ${p.description}`).join('\n'));
    }

    if (rules.profiles.length) {
      sections.push(`\n### 平台规则 (${platform})`);
      sections.push(rules.profiles.map(p => `- ${p.description}`).join('\n'));
    }

    if (related.memories.length) {
      sections.push('\n### 相关历史创作');
      sections.push(related.memories.slice(0, 3).map(m => `- ${m.summary || m.content.slice(0, 200)}`).join('\n'));
    }

    if (competitor.memories.length) {
      sections.push('\n### 竞品动态');
      sections.push(competitor.memories.slice(0, 3).map(m => `- ${m.summary || m.content.slice(0, 200)}`).join('\n'));
    }

    return sections.join('\n');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/memory.ts
git commit -m "feat: add MemoryClient for EverMemOS search and context building"
```

---

### Task 6.2: Add memory API routes

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: Add memory endpoints**

```typescript
import { MemoryClient } from '../memory.js';
const memoryClient = new MemoryClient();

app.get('/api/memory/search', async (c) => {
  const q = c.req.query('q') || '';
  const method = c.req.query('method') as any || 'hybrid';
  const topK = parseInt(c.req.query('topK') || '10');
  const result = await memoryClient.search(q, { method, topK });
  return c.json(result);
});

app.get('/api/memory/profile', async (c) => {
  const style = await memoryClient.search('style_profile', { memoryTypes: ['profile'], topK: 5 });
  const rules = await memoryClient.search('platform_rules', { memoryTypes: ['profile'], topK: 10 });
  return c.json({ style: style.profiles, rules: rules.profiles });
});

app.get('/api/memory/context/:workId', async (c) => {
  const work = getWork(c.req.param('workId'));
  if (!work) return c.json({ error: 'not found' }, 404);
  const platform = work.platforms[0]?.name || 'xiaohongshu';
  const context = await memoryClient.buildContext(work.topicHint || work.title, platform);
  return c.json({ context });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: add memory search and profile API routes"
```

---

### Task 6.3: Integrate memory into WsBridge session creation

**Files:**
- Modify: `src/ws-bridge.ts`

- [ ] **Step 1: Import MemoryClient and use buildContext in createSession**

In `ws-bridge.ts`, before spawning CLI in `createSession()`:

```typescript
import { MemoryClient } from './memory.js';

// In createSession, before building initialPrompt:
const memoryClient = new MemoryClient();
const memoryContext = await memoryClient.buildContext(topicHint || title, platform);
const fullPrompt = memoryContext ? `${memoryContext}\n\n---\n\n${initialPrompt}` : initialPrompt;
// Use fullPrompt instead of initialPrompt for the pending message
```

- [ ] **Step 2: Commit**

```bash
git add src/ws-bridge.ts
git commit -m "feat: inject EverMemOS memory context into CLI session prompts"
```

---

## Chunk 7: Frontend — Memory, Analytics, Explore (Module 6 remaining)

Replace mock data with real API calls across all remaining pages.

### Task 7.1: Create Memory page

**Files:**
- Create: `web/src/pages/Memory.svelte`

- [ ] **Step 1: Create Memory dashboard**

```svelte
<script>
  import { onMount } from 'svelte';

  let styleProfile = $state([]);
  let platformRules = $state([]);
  let searchQuery = $state('');
  let searchResults = $state({ memories: [], profiles: [] });
  let searching = $state(false);

  onMount(async () => {
    try {
      const res = await fetch('/api/memory/profile');
      const data = await res.json();
      styleProfile = data.style || [];
      platformRules = data.rules || [];
    } catch {}
  });

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    searching = true;
    try {
      const res = await fetch(`/api/memory/search?q=${encodeURIComponent(searchQuery)}&method=hybrid&topK=10`);
      searchResults = await res.json();
    } catch {}
    searching = false;
  }
</script>

<div class="memory-page">
  <h2>Memory</h2>

  <div class="memory-grid">
    <div class="memory-card">
      <h3>Style Profile</h3>
      {#if styleProfile.length}
        {#each styleProfile as p}
          <div class="profile-item">{p.description}</div>
        {/each}
      {:else}
        <p class="empty">No style profile yet. Create more works to build your profile.</p>
      {/if}
    </div>

    <div class="memory-card">
      <h3>Learned Rules</h3>
      {#if platformRules.length}
        {#each platformRules as r}
          <div class="rule-item">
            <span class="rule-category">{r.category}</span>
            {r.description}
          </div>
        {/each}
      {:else}
        <p class="empty">No rules learned yet. Publish content and collect data to learn patterns.</p>
      {/if}
    </div>
  </div>

  <div class="memory-search">
    <h3>Search Memories</h3>
    <div class="search-bar">
      <input bind:value={searchQuery} placeholder="Search your creative memory..." onkeydown={(e) => e.key === 'Enter' && handleSearch()} />
      <button onclick={handleSearch} disabled={searching}>{searching ? '...' : 'Search'}</button>
    </div>
    {#if searchResults.memories.length}
      <div class="search-results">
        {#each searchResults.memories as m}
          <div class="result-item">
            <span class="result-type">{m.memory_type}</span>
            <span class="result-score">{(m.score * 100).toFixed(0)}%</span>
            <p>{m.summary || m.content.slice(0, 300)}</p>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .memory-page { padding: 20px; max-width: 1000px; margin: 0 auto; }
  .memory-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  .memory-card { background: var(--glass-surface, rgba(255,255,255,0.05)); border-radius: 12px; padding: 16px; }
  .memory-card h3 { margin: 0 0 12px; font-size: 14px; }
  .profile-item, .rule-item { padding: 8px; border-bottom: 1px solid var(--border); font-size: 13px; line-height: 1.6; }
  .rule-category { background: rgba(134,120,191,0.2); padding: 1px 6px; border-radius: 3px; font-size: 10px; margin-right: 6px; }
  .empty { color: var(--text-muted); font-size: 13px; }
  .memory-search { margin-top: 24px; }
  .search-bar { display: flex; gap: 8px; }
  .search-bar input { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--input-bg); color: inherit; font-size: 14px; }
  .search-bar button { padding: 10px 20px; border-radius: 8px; background: var(--accent, #8678bf); color: white; border: none; cursor: pointer; }
  .search-results { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
  .result-item { padding: 12px; background: var(--glass-surface); border-radius: 8px; font-size: 13px; }
  .result-type { background: rgba(52,211,153,0.2); padding: 1px 6px; border-radius: 3px; font-size: 10px; margin-right: 6px; }
  .result-score { color: var(--text-muted); font-size: 11px; float: right; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/Memory.svelte
git commit -m "feat: add Memory dashboard page"
```

---

### Task 7.2: Update Explore page with real data

**Files:**
- Modify: `web/src/pages/Explore.svelte`

- [ ] **Step 1: Replace hardcoded data with API calls**

Key changes:
1. Replace hardcoded `youtubeVideos`, `tiktokVideos`, `youtubeTags`, `tiktokTags` arrays with API fetches
2. On mount: `fetch('/api/trends/xiaohongshu')` and `fetch('/api/trends/douyin')`
3. Keep the same UI structure but populate from API response
4. Add a "Refresh" button that calls `POST /api/collector/trigger`
5. Show "No data yet" message when trends are empty (with a prompt to trigger first collection)

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/Explore.svelte
git commit -m "feat: replace mock Explore data with real trend API"
```

---

### Task 7.3: Update Analytics page with real data

**Files:**
- Modify: `web/src/pages/Analytics.svelte`

- [ ] **Step 1: Replace mock analytics with API calls**

Key changes:
1. Replace hardcoded profile, demographics, insights with `fetch('/api/analytics')` and `fetch('/api/memory/profile')`
2. Show real totals (works, views, likes, comments) from analytics API
3. Show style profile from memory API
4. Remove fake demographic data (will be added when real analytics API is available)
5. Show real "Latest Insights" from memory search for recent platform rules

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/Analytics.svelte
git commit -m "feat: replace mock Analytics with real data from API"
```

---

### Task 7.4: Build and verify

- [ ] **Step 1: Build backend**

```bash
npm run build
```

Expected: Clean compilation in `dist/`

- [ ] **Step 2: Build frontend**

```bash
cd web && npm run build && cd ..
```

Expected: Clean build in `web/dist/`

- [ ] **Step 3: Start and verify**

```bash
node dist/index.js start --foreground
```

Open http://localhost:3271 — verify:
- 5 tabs visible (Works, Studio, Explore, Analytics, Memory)
- Works gallery loads from API (initially empty, "+" creates new work)
- Clicking a work opens Studio
- Explore shows "No data" or real trends if collector ran
- Analytics shows real aggregated data
- Memory page loads profile and supports search

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete AutoViral full product implementation"
```
