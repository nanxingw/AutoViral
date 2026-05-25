# UI Redesign · Plan 1 · React Scaffold + 3 Non-Editor Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `web/` 从 Svelte 5 切到 React 18 + Vite + TS，落地完整 design-system（tokens / typography / glass / 主题切换）、5 个路由（Works / Explore / Analytics / Studio / Editor，最后两个先 shell）、TanStack Query + Zustand 数据层、Radix 原语、ws 客户端（reconnect + replay buffer），并将 Works/Explore/Analytics 三个非编辑器页面打通到现有后端 API。

**Architecture:** SPA（Vite + React 18）。所有状态分两类：UI/会话状态走 Zustand，远程数据走 TanStack Query。WS 通过 `useChatSocket(workId)` hook 暴露给 chat。tokens 是 CSS variables，组件用 CSS Modules。Radix headless 仅取 a11y/行为，皮肤自己写。

**Tech Stack:** React 18.3 / Vite 5 / TypeScript 5 / react-router-dom 6 / @tanstack/react-query 5 / zustand 4 / @radix-ui/react-* / clsx / vitest / @testing-library/react / @testing-library/user-event / @playwright/test / msw

---

## File Structure

### 新增

```
web/
  index.html                                 # 重写：fonts + #root + av-theme bootstrap
  src/
    main.tsx                                  # 入口
    App.tsx                                   # 顶层 Layout shell
    vite-env.d.ts
    pages/
      Works.tsx                               # 完整实现
      Explore.tsx                             # 完整实现
      Analytics.tsx                           # 完整实现
      Studio.tsx                              # 占位 shell（grid 骨架，无编辑器）
      Editor.tsx                              # 占位 shell（grid 骨架，无 canvas）
    features/
      works/{components, types}.ts            # WorksHero / WorksGrid / NewWorkCard / InsightRibbon
      explore/{components, types}.ts          # PlatformTabs / TrendingPanel / TopicsPanel / AnglesCard
      analytics/{components, types}.ts        # KPIBar / ProfileBar / DemographicsRow / InsightsList
      chat/{useChatSocket, store, types}.ts   # WS hook + 消息类型（无 eval_divider）
    stores/
      theme.ts                                # zustand
      ui.ts                                   # zustand（modals / sidebars）
    queries/
      works.ts                                # useWorks / useWork / useCreateWork / useUpdateWork
      trends.ts                               # usePlatformTrends / useHotTopics
      analytics.ts                            # useCreatorAnalytics
      memory.ts                               # useProfile / useMemorySearch
    lib/
      api.ts                                  # fetch wrapper
      ws.ts                                   # WebSocket reconnect + replay buffer
      format.ts                               # number/date helpers
      time.ts                                 # timecode helpers
    ui/                                       # Radix-based primitives
      Button.tsx
      Tabs.tsx
      Tooltip.tsx
      Dialog.tsx
      Switch.tsx
      Slider.tsx
      DropdownMenu.tsx
      ThemeToggle.tsx
      TopNav.tsx
      Glass.tsx                               # 玻璃容器组件
    styles/
      tokens.css                              # 从设计稿 shared.css 端口
      globals.css                             # body/scrollbar/grain
      typography.css                          # font helpers (font-editorial / font-mono)
    test/
      setup.ts                                # vitest 全局
      msw.ts                                  # mock service worker handlers
e2e/                                          # Playwright
  works.spec.ts
  navigation.spec.ts
```

### 改动

```
package.json                                  # 增 React 系；删 svelte 系
vite.config.ts                                # 替 svelte() 为 @vitejs/plugin-react；保 proxy
web/tsconfig.json                             # 删 svelte types；加 react / jsx
.gitignore                                    # 增 e2e/test-results
```

### 删除

```
web/src/**/*                                  # 旧 Svelte 全删；新建空树
```

---

## Tasks

### Task 1: 创建分支 & 备份提示

**Files:** —（仅 git 操作）

- [ ] **Step 1: 确认在干净 working tree**

Run:
```bash
git status --short
```
Expected: 仅看到 spec/plan 文件等无关改动；如有未提交改动先 stash。

- [ ] **Step 2: 创建并切到工作分支**

Run:
```bash
git checkout -b refactor/ui-v3-react
```
Expected: `Switched to a new branch 'refactor/ui-v3-react'`

- [ ] **Step 3: 不要立即 commit**——后续每个 task 完成后才 commit。

---

### Task 2: 替换 package.json 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 写依赖变更**

Replace the `dependencies` and `devDependencies` blocks of `package.json` with the merged set below (保留所有非前端依赖):

```json
{
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@radix-ui/react-dialog": "^1.1.6",
    "@radix-ui/react-dropdown-menu": "^2.1.6",
    "@radix-ui/react-slider": "^1.2.3",
    "@radix-ui/react-switch": "^1.1.3",
    "@radix-ui/react-tabs": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.1.8",
    "@tanstack/react-query": "^5.62.0",
    "@types/dompurify": "^3.0.5",
    "clsx": "^2.1.1",
    "commander": "^12.0.0",
    "date-fns": "^4.1.0",
    "dompurify": "^3.3.3",
    "dotenv": "^16.4.0",
    "highlight.js": "^11.11.1",
    "hono": "^4.0.0",
    "immer": "^10.1.1",
    "js-yaml": "^4.1.0",
    "marked": "^17.0.4",
    "node-cron": "^3.0.0",
    "playwright": "^1.58.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "ws": "^8.0.0",
    "zod": "^3.23.8",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.2",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "@types/node-cron": "^3.0.0",
    "@types/react": "^18.3.13",
    "@types/react-dom": "^18.3.1",
    "@types/ws": "^8.5.0",
    "@vitejs/plugin-react": "^4.3.4",
    "happy-dom": "^15.11.7",
    "msw": "^2.6.8",
    "typescript": "^5.9.3",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

Notes:
- `svelte` 与 `@sveltejs/vite-plugin-svelte` **删除**
- `@tanstack/react-query` 与 react 并列 dependency（生产代码用）
- `happy-dom` 取代 jsdom，启动更快；后续 vitest 配置会用它

- [ ] **Step 2: 安装**

Run:
```bash
npm install
```
Expected: 退出码 0；`node_modules/` 包含 `react`、`@tanstack/react-query`、`@radix-ui/react-tabs` 等；不再包含 `svelte`。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: swap Svelte deps for React 18 + Vite plugin + TanStack stack"
```

---

### Task 3: 替换 vite.config.ts

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: 写新配置**

Replace `vite.config.ts` content with:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "web",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "web/src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3271",
      "/ws": {
        target: "ws://localhost:3271",
        ws: true,
      },
    },
  },
});
```

Notes:
- 别名从 `$lib` 改为 `@/`，与 React 生态约定一致
- proxy 端口与目标保持原样（后端 3271 不变）
- `outDir: "dist"` 相对 `root: "web"` → 实际输出到 `web/dist/`，与现状一致

- [ ] **Step 2: 校验配置可解析**

Run:
```bash
npx vite --version
```
Expected: 打印 vite 版本号，无报错。

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "refactor(build): swap Vite Svelte plugin for React"
```

---

### Task 4: 更新 web/tsconfig.json

**Files:**
- Modify: `web/tsconfig.json`

- [ ] **Step 1: 写新 tsconfig**

Replace `web/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "useDefineForClassFields": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client", "@testing-library/jest-dom"],
    "paths": {
      "@/*": ["./src/*"]
    },
    "baseUrl": "."
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.d.ts"]
}
```

- [ ] **Step 2: 校验**

Run:
```bash
npx tsc --noEmit -p web/tsconfig.json
```
Expected: 因为 src/ 还没建，可能报"No inputs were found"——预期。Step 1 配置语法正确即可，错误内容无关。

- [ ] **Step 3: Commit**

```bash
git add web/tsconfig.json
git commit -m "refactor(ts): switch web tsconfig to React 18 jsx"
```

---

### Task 5: 清空 Svelte 源码 + 建立空 React 树

**Files:**
- Delete: `web/src/**/*`
- Create: `web/src/main.tsx`, `web/src/App.tsx`, `web/src/vite-env.d.ts`

- [ ] **Step 1: 删除旧源码**

Run:
```bash
rm -rf web/src
mkdir -p web/src
```

- [ ] **Step 2: 创建 vite-env.d.ts**

`web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 3: 创建最小 main.tsx**

`web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: 创建最小 App.tsx**

`web/src/App.tsx`:
```tsx
export default function App() {
  return <div>AutoViral</div>;
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "refactor: drop Svelte source tree; bootstrap empty React entry"
```

---

### Task 6: 重写 web/index.html

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: 替换内容**

`web/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AutoViral</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap"
      rel="stylesheet"
    />
    <script>
      (function () {
        var t = localStorage.getItem("av-theme");
        if (!t) t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", t);
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Notes:
- 元素 id 从 `app` 改为 `root`（与设计稿一致 + React 习惯）
- 主题 key 从 `se-theme` 改为 `av-theme`
- 字体三件套（Instrument Serif / Inter / JetBrains Mono）做 preconnect 优化首屏

- [ ] **Step 2: 启动 dev server 验证**

Run:
```bash
npm run dev:frontend
```
Expected: Vite 启动成功；访问 http://localhost:5173 看到"AutoViral"文本。Ctrl-C 停。

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "refactor(html): rewrite index for React 18 + new font stack"
```

---

### Task 7: 端口设计 tokens

**Files:**
- Create: `web/src/styles/tokens.css`

- [ ] **Step 1: 写 tokens.css**

`web/src/styles/tokens.css`（直接对应 spec §7 与设计稿 `shared.css`）:

```css
/* tokens.css — design tokens, aligned with autoviral design v3 */

:root {
  --accent: #a8c5d6;
  --accent-hi: #d6e4ee;
  --accent-lo: #5a7a8c;
  --accent-glow: rgba(168, 197, 214, 0.3);
  --accent-fg: #0a0b0f;

  --bg: #0a0b0f;
  --bg-grad:
    radial-gradient(1400px 900px at 85% -10%, rgba(120, 160, 200, 0.05), transparent 60%),
    radial-gradient(1000px 700px at -10% 110%, rgba(140, 110, 180, 0.04), transparent 55%),
    #0a0b0f;

  --surface-0: rgba(20, 22, 28, 0.55);
  --surface-1: rgba(26, 28, 34, 0.7);
  --surface-2: rgba(36, 38, 46, 0.78);
  --glass-border: rgba(255, 255, 255, 0.07);
  --glass-hi: rgba(255, 255, 255, 0.12);
  --divider: rgba(255, 255, 255, 0.05);

  --text: #ecedf0;
  --text-dim: #9a9ea6;
  --text-dimmer: #62656c;
  --text-muted: #42454b;

  --status-running: #7dd3fc;
  --status-done: #86efac;
  --status-pending: #6b6e76;
  --status-error: #f97066;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 22px;
}

[data-theme="light"] {
  --accent: #2a3a4a;
  --accent-hi: #0f1822;
  --accent-lo: #5a6a7c;
  --accent-glow: rgba(42, 58, 74, 0.08);
  --accent-fg: #fafaf7;

  --bg: #fafaf7;
  --bg-grad:
    radial-gradient(1200px 900px at 80% -5%, rgba(100, 130, 160, 0.05), transparent 60%),
    radial-gradient(1000px 800px at -10% 110%, rgba(180, 170, 200, 0.04), transparent 55%),
    #fafaf7;

  --surface-0: rgba(255, 255, 255, 0.6);
  --surface-1: rgba(255, 255, 255, 0.78);
  --surface-2: rgba(246, 246, 242, 0.88);
  --glass-border: rgba(15, 24, 34, 0.08);
  --glass-hi: rgba(15, 24, 34, 0.1);
  --divider: rgba(15, 24, 34, 0.06);

  --text: #0f1822;
  --text-dim: #545c66;
  --text-dimmer: #8c929a;
  --text-muted: #b8bcc2;

  --status-running: #0369a1;
  --status-done: #15803d;
  --status-pending: #9ca3af;
  --status-error: #dc2626;
}

/* Accent variants — opt-in via [data-accent] */
[data-accent="violet"] {
  --accent: #c084fc;
  --accent-hi: #e4c5ff;
  --accent-lo: #7c3aed;
  --accent-glow: rgba(192, 132, 252, 0.4);
  --accent-fg: #1a1022;
}
[data-accent="cyan"] {
  --accent: #7dd3fc;
  --accent-hi: #bae6fd;
  --accent-lo: #0284c7;
  --accent-glow: rgba(125, 211, 252, 0.4);
  --accent-fg: #022035;
}
[data-accent="coral"] {
  --accent: #ff7a5c;
  --accent-hi: #ffb199;
  --accent-lo: #c2410c;
  --accent-glow: rgba(255, 122, 92, 0.4);
  --accent-fg: #2a0e05;
}
[data-accent="lime"] {
  --accent: #bef264;
  --accent-hi: #d9f99d;
  --accent-lo: #65a30d;
  --accent-glow: rgba(190, 242, 100, 0.4);
  --accent-fg: #1a2005;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/styles/tokens.css
git commit -m "feat(styles): add design tokens (dark/light + 5 accent variants)"
```

---

### Task 8: globals.css

**Files:**
- Create: `web/src/styles/globals.css`

- [ ] **Step 1: 写 globals.css**

`web/src/styles/globals.css`:
```css
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", "PingFang SC", system-ui, sans-serif;
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
}

body {
  min-height: 100vh;
  background: var(--bg-grad);
  background-attachment: fixed;
  overflow-x: hidden;
}

/* Ambient grain overlay */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.035;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.9' seed='3'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  mix-blend-mode: overlay;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--glass-hi); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent-lo); }

a { color: inherit; text-decoration: none; }
button { font: inherit; }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/styles/globals.css
git commit -m "feat(styles): add globals (body grain overlay + scrollbar + reset)"
```

---

### Task 9: typography.css

**Files:**
- Create: `web/src/styles/typography.css`

- [ ] **Step 1: 写 typography.css**

`web/src/styles/typography.css`:
```css
.font-editorial {
  font-family: "Instrument Serif", Georgia, serif;
  font-weight: 400;
  letter-spacing: -0.01em;
}

.font-editorial-italic {
  font-family: "Instrument Serif", Georgia, serif;
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
}

.font-mono {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-feature-settings: "zero", "ss01";
}

.tight  { letter-spacing: -0.03em; }
.tighter { letter-spacing: -0.04em; }

.eyebrow {
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dimmer);
}

.h-display {
  font-family: "Instrument Serif", Georgia, serif;
  font-style: italic;
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.02;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/styles/typography.css
git commit -m "feat(styles): add typography helpers (editorial / mono / tracking)"
```

---

### Task 10: 把 styles 接进 main.tsx + 烟测渲染

**Files:**
- Modify: `web/src/main.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 改 main.tsx 以 import 全部样式**

`web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/typography.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: 改 App.tsx 输出可视证据**

`web/src/App.tsx`:
```tsx
export default function App() {
  return (
    <div style={{ padding: 32 }}>
      <span className="eyebrow">AUTOVIRAL · v3 · DESIGN</span>
      <h1 className="h-display" style={{ fontSize: 56 }}>
        Hello, <em style={{ fontStyle: "italic" }}>editorial</em> world.
      </h1>
    </div>
  );
}
```

- [ ] **Step 3: Dev server 看一眼**

Run:
```bash
npm run dev:frontend
```
访问 http://localhost:5173；视觉应该是：暗色 #0a0b0f 背景，斜体编辑感大字，左上角 mono 小字 eyebrow。Ctrl-C 退出。

- [ ] **Step 4: Commit**

```bash
git add web/src/main.tsx web/src/App.tsx
git commit -m "feat(app): wire styles + render typography sanity sample"
```

---

### Task 11: 安装 vitest 配置 + 写"App 可渲染"smoke test

**Files:**
- Create: `web/vitest.config.ts`
- Create: `web/src/test/setup.ts`
- Create: `web/src/App.test.tsx`

- [ ] **Step 1: vitest 配置**

`web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "src/test/setup.ts")],
    css: true,
  },
});
```

- [ ] **Step 2: 测试 setup**

`web/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: 写 smoke test**

`web/src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("<App />", () => {
  it("renders the editorial sample without crashing", () => {
    render(<App />);
    expect(screen.getByText(/editorial/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 运行测试，期望失败（缺 vitest 解析 web 目录配置）**

Run:
```bash
npx vitest --config web/vitest.config.ts run web/src/App.test.tsx
```
Expected: PASS（因为 App.tsx 已经渲染了"editorial"文字）。如果 happy-dom 报缺包，确认 Task 2 已装；如果路径报错调 alias。

- [ ] **Step 5: 把 npm scripts 接好**

修改根 `package.json` 的 `scripts` 块，添加：
```json
"test:web": "vitest --config web/vitest.config.ts run",
"test:web:watch": "vitest --config web/vitest.config.ts"
```
（保留原有 `"test": "vitest run"` 用于后端测试。）

- [ ] **Step 6: Commit**

```bash
git add web/vitest.config.ts web/src/test/setup.ts web/src/App.test.tsx package.json
git commit -m "test(web): add vitest config + RTL setup + App smoke test"
```

---

### Task 12: theme store + useTheme hook

**Files:**
- Create: `web/src/stores/theme.ts`
- Create: `web/src/stores/theme.test.ts`

- [ ] **Step 1: 写测试**

`web/src/stores/theme.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTheme } from "./theme";

describe("useTheme store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useTheme.setState({ theme: "dark" });
  });

  it("persists theme to localStorage and applies data-theme attribute", () => {
    useTheme.getState().setTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("av-theme")).toBe("light");
  });

  it("toggles between dark and light", () => {
    useTheme.setState({ theme: "dark" });
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("light");
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("dark");
  });
});
```

- [ ] **Step 2: 运行测试，预期 fail（store 不存在）**

Run:
```bash
npm run test:web -- web/src/stores/theme.test.ts
```
Expected: FAIL — `Cannot find module './theme'`.

- [ ] **Step 3: 实现 store**

`web/src/stores/theme.ts`:
```ts
import { create } from "zustand";

export type Theme = "dark" | "light";

interface ThemeStore {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const STORAGE_KEY = "av-theme";

function applyToDOM(t: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", t);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, t);
  }
}

const initial: Theme = (() => {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
})();

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: initial,
  setTheme: (t) => {
    applyToDOM(t);
    set({ theme: t });
  },
  toggle: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyToDOM(next);
    set({ theme: next });
  },
}));

// Apply once at import time so SSR/CSR sync stays correct
applyToDOM(initial);
```

- [ ] **Step 4: 运行测试，预期 PASS**

Run:
```bash
npm run test:web -- web/src/stores/theme.test.ts
```
Expected: PASS（2/2）。

- [ ] **Step 5: Commit**

```bash
git add web/src/stores/theme.ts web/src/stores/theme.test.ts
git commit -m "feat(stores): add theme store with localStorage persistence + DOM sync"
```

---

### Task 13: ThemeToggle 组件

**Files:**
- Create: `web/src/ui/ThemeToggle.tsx`
- Create: `web/src/ui/ThemeToggle.module.css`
- Create: `web/src/ui/ThemeToggle.test.tsx`

- [ ] **Step 1: 写测试**

`web/src/ui/ThemeToggle.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "@/stores/theme";

describe("<ThemeToggle />", () => {
  beforeEach(() => {
    useTheme.setState({ theme: "dark" });
  });

  it("renders sun icon when theme is dark and moon when light", () => {
    render(<ThemeToggle />);
    expect(screen.getByLabelText(/toggle theme/i)).toBeInTheDocument();
    expect(document.querySelector("[data-icon='sun']")).toBeInTheDocument();
  });

  it("toggles theme on click", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByLabelText(/toggle theme/i));
    expect(useTheme.getState().theme).toBe("light");
  });
});
```

- [ ] **Step 2: 运行测试 — 预期 fail**

Run:
```bash
npm run test:web -- web/src/ui/ThemeToggle.test.tsx
```
Expected: FAIL — `Cannot find module './ThemeToggle'`.

- [ ] **Step 3: 写 module css**

`web/src/ui/ThemeToggle.module.css`:
```css
.btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: var(--surface-0);
  color: var(--text-dim);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: color 0.15s, background 0.15s;
}
.btn:hover {
  color: var(--text);
  background: var(--surface-2);
}
```

- [ ] **Step 4: 写组件**

`web/src/ui/ThemeToggle.tsx`:
```tsx
import { useTheme } from "@/stores/theme";
import styles from "./ThemeToggle.module.css";

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);

  return (
    <button
      type="button"
      className={styles.btn}
      onClick={toggle}
      aria-label="toggle theme"
      title="Toggle theme"
    >
      {theme === "dark" ? (
        <svg data-icon="sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg data-icon="moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}
```

- [ ] **Step 5: 运行测试 — 预期 PASS**

Run:
```bash
npm run test:web -- web/src/ui/ThemeToggle.test.tsx
```
Expected: PASS（2/2）。

- [ ] **Step 6: Commit**

```bash
git add web/src/ui/ThemeToggle.tsx web/src/ui/ThemeToggle.module.css web/src/ui/ThemeToggle.test.tsx
git commit -m "feat(ui): add ThemeToggle component (sun/moon, a11y label)"
```

---

### Task 14: lib/api.ts fetch wrapper

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/api.test.ts`

- [ ] **Step 1: 写测试**

`web/src/lib/api.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, ApiError } from "./api";

describe("apiFetch", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns parsed JSON on 200", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, n: 1 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const data = await apiFetch<{ ok: boolean; n: number }>("/api/works");
    expect(data).toEqual({ ok: true, n: 1 });
  });

  it("throws ApiError on 4xx with status + body", async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: "bad" }), { status: 400, headers: { "content-type": "application/json" } }),
    );
    await expect(apiFetch("/api/works")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
    });
  });

  it("returns text when content-type is not json", async () => {
    (global.fetch as any).mockResolvedValue(new Response("plain", { status: 200 }));
    expect(await apiFetch<string>("/api/x")).toBe("plain");
  });
});
```

- [ ] **Step 2: 运行测试 — 预期 fail**

Run:
```bash
npm run test:web -- web/src/lib/api.test.ts
```
Expected: FAIL — `Cannot find module './api'`.

- [ ] **Step 3: 实现**

`web/src/lib/api.ts`:
```ts
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: ApiOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = opts;
  const init: RequestInit = {
    ...rest,
    headers: {
      "content-type": body ? "application/json" : "",
      ...(headers as Record<string, string> | undefined),
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(buildUrl(path, query), init);
  const ct = res.headers.get("content-type") ?? "";
  const payload: unknown = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`, res.status, payload);
  return payload as T;
}
```

- [ ] **Step 4: 测试 — 预期 PASS**

Run:
```bash
npm run test:web -- web/src/lib/api.test.ts
```
Expected: PASS（3/3）。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.test.ts
git commit -m "feat(lib): add apiFetch wrapper with ApiError + JSON/text auto-detect"
```

---

### Task 15: lib/ws.ts reconnecting WebSocket

**Files:**
- Create: `web/src/lib/ws.ts`
- Create: `web/src/lib/ws.test.ts`

- [ ] **Step 1: 写测试**

`web/src/lib/ws.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReconnectingWS } from "./ws";

class MockWS {
  static instances: MockWS[] = [];
  readyState = 0;
  listeners: Record<string, Function[]> = { open: [], message: [], close: [], error: [] };
  sent: string[] = [];

  constructor(public url: string) {
    MockWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.listeners.open.forEach((fn) => fn(new Event("open")));
    });
  }
  addEventListener(type: string, fn: Function) { this.listeners[type].push(fn); }
  send(data: string) { this.sent.push(data); }
  close() {
    this.readyState = 3;
    this.listeners.close.forEach((fn) => fn(new CloseEvent("close")));
  }
}

describe("ReconnectingWS", () => {
  beforeEach(() => {
    MockWS.instances = [];
    (globalThis as any).WebSocket = MockWS;
  });

  it("buffers messages while disconnected and replays on open", async () => {
    const ws = new ReconnectingWS("ws://x");
    ws.send("queued");
    await Promise.resolve(); // let microtasks resolve open
    expect(MockWS.instances[0].sent).toContain("queued");
    ws.dispose();
  });

  it("attempts reconnect after close", async () => {
    vi.useFakeTimers();
    const ws = new ReconnectingWS("ws://x", { backoffMs: 50 });
    await Promise.resolve();
    MockWS.instances[0].close();
    vi.advanceTimersByTime(60);
    expect(MockWS.instances.length).toBe(2);
    ws.dispose();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 运行测试 — 预期 fail**

Run:
```bash
npm run test:web -- web/src/lib/ws.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: 实现**

`web/src/lib/ws.ts`:
```ts
export interface ReconnectingWSOptions {
  backoffMs?: number;
  maxBackoffMs?: number;
}

type Listener<T> = (msg: T) => void;

export class ReconnectingWS<T = string> {
  private socket: WebSocket | null = null;
  private buffer: string[] = [];
  private listeners = new Set<Listener<T>>();
  private disposed = false;
  private backoff: number;
  private readonly maxBackoff: number;

  constructor(
    private readonly url: string,
    opts: ReconnectingWSOptions = {},
  ) {
    this.backoff = opts.backoffMs ?? 500;
    this.maxBackoff = opts.maxBackoffMs ?? 8000;
    this.connect();
  }

  private connect() {
    if (this.disposed) return;
    const sock = new WebSocket(this.url);
    this.socket = sock;
    sock.addEventListener("open", () => {
      while (this.buffer.length) sock.send(this.buffer.shift()!);
    });
    sock.addEventListener("message", (e: MessageEvent) => {
      this.listeners.forEach((fn) => fn(e.data as T));
    });
    sock.addEventListener("close", () => {
      this.socket = null;
      if (this.disposed) return;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
    });
    sock.addEventListener("error", () => sock.close());
  }

  send(data: string) {
    if (this.socket && this.socket.readyState === 1) this.socket.send(data);
    else this.buffer.push(data);
  }

  on(fn: Listener<T>) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    this.disposed = true;
    this.socket?.close();
    this.listeners.clear();
  }
}
```

- [ ] **Step 4: 测试 — 预期 PASS**

Run:
```bash
npm run test:web -- web/src/lib/ws.test.ts
```
Expected: PASS（2/2）。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/ws.ts web/src/lib/ws.test.ts
git commit -m "feat(lib): add ReconnectingWS with replay buffer + exponential backoff"
```

---

### Task 16: lib/format.ts + lib/time.ts

**Files:**
- Create: `web/src/lib/format.ts`
- Create: `web/src/lib/format.test.ts`
- Create: `web/src/lib/time.ts`
- Create: `web/src/lib/time.test.ts`

- [ ] **Step 1: 测试 format**

`web/src/lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { compactNumber, fmtDelta } from "./format";

describe("compactNumber", () => {
  it("formats thousands with k", () => expect(compactNumber(2847)).toBe("2.8K"));
  it("formats millions with M", () => expect(compactNumber(1_200_000)).toBe("1.2M"));
  it("keeps small numbers raw", () => expect(compactNumber(42)).toBe("42"));
});

describe("fmtDelta", () => {
  it("renders positive with up arrow", () => expect(fmtDelta(0.123)).toBe("↑ 12.3%"));
  it("renders negative with down arrow", () => expect(fmtDelta(-0.04)).toBe("↓ 4.0%"));
  it("renders zero with em dash", () => expect(fmtDelta(0)).toBe("— 0%"));
});
```

- [ ] **Step 2: 实现 format**

`web/src/lib/format.ts`:
```ts
export function compactNumber(n: number): string {
  if (Math.abs(n) < 1_000) return String(n);
  if (Math.abs(n) < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function fmtDelta(ratio: number): string {
  if (ratio === 0) return "— 0%";
  const arrow = ratio > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(ratio * 100).toFixed(1)}%`;
}
```

- [ ] **Step 3: 测试 time**

`web/src/lib/time.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { secToTimecode } from "./time";

describe("secToTimecode", () => {
  it("formats 0", () => expect(secToTimecode(0)).toBe("00:00.00"));
  it("formats minutes:seconds.frames", () => expect(secToTimecode(73.5)).toBe("01:13.50"));
});
```

- [ ] **Step 4: 实现 time**

`web/src/lib/time.ts`:
```ts
export function secToTimecode(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
```

- [ ] **Step 5: 测试**

Run:
```bash
npm run test:web -- web/src/lib/format.test.ts web/src/lib/time.test.ts
```
Expected: PASS（5/5 合）。

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/format.ts web/src/lib/format.test.ts web/src/lib/time.ts web/src/lib/time.test.ts
git commit -m "feat(lib): add format (compactNumber/fmtDelta) and time (secToTimecode)"
```

---

### Task 17: Glass + Button + Tabs primitives

**Files:**
- Create: `web/src/ui/Glass.tsx`
- Create: `web/src/ui/Glass.module.css`
- Create: `web/src/ui/Button.tsx`
- Create: `web/src/ui/Button.module.css`
- Create: `web/src/ui/Tabs.tsx`
- Create: `web/src/ui/Tabs.module.css`
- Create: `web/src/ui/Glass.test.tsx`

- [ ] **Step 1: Glass test**

`web/src/ui/Glass.test.tsx`:
```tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Glass } from "./Glass";

describe("<Glass />", () => {
  it("renders children inside a glass container", () => {
    const { container } = render(<Glass>hello</Glass>);
    expect(container.firstChild).toHaveTextContent("hello");
  });
  it("applies tone='lo' variant", () => {
    const { container } = render(<Glass tone="lo">x</Glass>);
    expect(container.firstChild).toHaveClass(/lo/);
  });
});
```

- [ ] **Step 2: Glass css**

`web/src/ui/Glass.module.css`:
```css
.glass {
  background: var(--surface-1);
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}
.lo {
  background: var(--surface-0);
  backdrop-filter: blur(16px) saturate(130%);
  -webkit-backdrop-filter: blur(16px) saturate(130%);
}
```

- [ ] **Step 3: Glass component**

`web/src/ui/Glass.tsx`:
```tsx
import { type HTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import styles from "./Glass.module.css";

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "lo";
  children: ReactNode;
}

export function Glass({ tone = "default", className, children, ...rest }: Props) {
  return (
    <div className={clsx(styles.glass, tone === "lo" && styles.lo, className)} {...rest}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Button**

`web/src/ui/Button.module.css`:
```css
.btn {
  padding: 7px 14px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--glass-border);
  background: var(--surface-0);
  color: var(--text);
  cursor: pointer;
  letter-spacing: -0.005em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  transition: background 0.15s;
}
.btn:hover { background: var(--surface-2); }
.primary {
  background: linear-gradient(180deg, var(--accent-hi), var(--accent));
  color: var(--accent-fg);
  border-color: var(--accent-hi);
  box-shadow: 0 4px 16px var(--accent-glow);
}
.ghost { background: transparent; }
```

`web/src/ui/Button.tsx`:
```tsx
import { type ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import styles from "./Button.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "default", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        styles.btn,
        variant === "primary" && styles.primary,
        variant === "ghost" && styles.ghost,
        className,
      )}
      {...rest}
    />
  );
});
```

- [ ] **Step 5: Tabs (Radix wrapper)**

`web/src/ui/Tabs.module.css`:
```css
.list {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-0);
  border: 1px solid var(--glass-border);
}
.trigger {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
  border: none;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color 0.15s, background 0.15s;
}
.trigger[data-state="active"] {
  background: var(--surface-2);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--glass-border);
}
.trigger:hover:not([data-state="active"]) { color: var(--text); }
```

`web/src/ui/Tabs.tsx`:
```tsx
import * as RadixTabs from "@radix-ui/react-tabs";
import styles from "./Tabs.module.css";

export const Tabs = RadixTabs.Root;
export const TabList = (p: RadixTabs.TabsListProps) => <RadixTabs.List className={styles.list} {...p} />;
export const Tab = (p: RadixTabs.TabsTriggerProps) => <RadixTabs.Trigger className={styles.trigger} {...p} />;
export const TabContent = RadixTabs.Content;
```

- [ ] **Step 6: 测试**

Run:
```bash
npm run test:web -- web/src/ui/Glass.test.tsx
```
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add web/src/ui/Glass.tsx web/src/ui/Glass.module.css web/src/ui/Glass.test.tsx \
        web/src/ui/Button.tsx web/src/ui/Button.module.css \
        web/src/ui/Tabs.tsx web/src/ui/Tabs.module.css
git commit -m "feat(ui): add Glass / Button / Tabs primitives"
```

---

### Task 18: TopNav 组件

**Files:**
- Create: `web/src/ui/TopNav.tsx`
- Create: `web/src/ui/TopNav.module.css`
- Create: `web/src/ui/TopNav.test.tsx`

- [ ] **Step 1: 测试**

`web/src/ui/TopNav.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { TopNav } from "./TopNav";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopNav />
      <Routes>
        <Route path="*" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<TopNav />", () => {
  it("highlights Works tab on /", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: /works/i })).toHaveAttribute("aria-current", "page");
  });
  it("highlights Explore on /explore", () => {
    renderAt("/explore");
    expect(screen.getByRole("link", { name: /explore/i })).toHaveAttribute("aria-current", "page");
  });
  it("highlights Analytics on /analytics", () => {
    renderAt("/analytics");
    expect(screen.getByRole("link", { name: /analytics/i })).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: 运行测试 — 预期 fail**

Run:
```bash
npm run test:web -- web/src/ui/TopNav.test.tsx
```
Expected: FAIL — module missing.

- [ ] **Step 3: css**

`web/src/ui/TopNav.module.css`:
```css
.outer {
  position: sticky;
  top: 12px;
  z-index: 50;
  margin: 12px auto 0;
  max-width: 1280px;
  padding: 0 24px;
}
.inner {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
}
.logo {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: linear-gradient(135deg, var(--accent-hi), var(--accent-lo));
  display: grid;
  place-items: center;
  color: var(--accent-fg);
  font-weight: 700;
  font-size: 13px;
}
.brandLines {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}
.brandTitle {
  font-family: "Instrument Serif", serif;
  font-size: 15px;
  font-style: italic;
}
.brandTag {
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  color: var(--text-dimmer);
  letter-spacing: 0.1em;
}
.tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-0);
  border: 1px solid var(--glass-border);
}
.tab {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.tab[aria-current="page"] {
  background: var(--surface-2);
  color: var(--text);
  box-shadow: 0 0 0 1px var(--glass-border);
}
.tab:hover { color: var(--text); }
.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
```

- [ ] **Step 4: 组件**

`web/src/ui/TopNav.tsx`:
```tsx
import { Link, useLocation } from "react-router-dom";
import { Glass } from "./Glass";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./TopNav.module.css";

const TABS = [
  { to: "/", label: "Works · 作品" },
  { to: "/explore", label: "Explore · 灵感" },
  { to: "/analytics", label: "Analytics · 数据" },
];

export function TopNav() {
  const { pathname } = useLocation();
  const active = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <header className={styles.outer}>
      <Glass className={styles.inner}>
        <Link to="/" className={styles.brand}>
          <div className={styles.logo}>A</div>
          <div className={styles.brandLines}>
            <span className={styles.brandTitle}>Autoviral</span>
            <span className={styles.brandTag}>v3 · DESIGN</span>
          </div>
        </Link>
        <nav className={styles.tabs}>
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className={styles.tab}
              aria-current={active(t.to) ? "page" : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className={styles.right}>
          <ThemeToggle />
        </div>
      </Glass>
    </header>
  );
}
```

- [ ] **Step 5: 测试 — PASS**

Run:
```bash
npm run test:web -- web/src/ui/TopNav.test.tsx
```
Expected: PASS（3/3）。

- [ ] **Step 6: Commit**

```bash
git add web/src/ui/TopNav.tsx web/src/ui/TopNav.module.css web/src/ui/TopNav.test.tsx
git commit -m "feat(ui): add TopNav with brand, 3 tabs, route-aware active state"
```

---

### Task 19: Routing + 5 page 占位 + App shell

**Files:**
- Modify: `web/src/main.tsx`
- Modify: `web/src/App.tsx`
- Create: `web/src/pages/{Works,Explore,Analytics,Studio,Editor}.tsx`

- [ ] **Step 1: 5 个 page stubs**

`web/src/pages/Works.tsx`:
```tsx
export default function Works() {
  return <main className="page">Works · WIP</main>;
}
```

`web/src/pages/Explore.tsx`:
```tsx
export default function Explore() {
  return <main className="page">Explore · WIP</main>;
}
```

`web/src/pages/Analytics.tsx`:
```tsx
export default function Analytics() {
  return <main className="page">Analytics · WIP</main>;
}
```

`web/src/pages/Studio.tsx`:
```tsx
import { useParams } from "react-router-dom";
export default function Studio() {
  const { workId } = useParams();
  return <main className="page">Studio shell · workId={workId} · 待 Plan 2 填实</main>;
}
```

`web/src/pages/Editor.tsx`:
```tsx
import { useParams } from "react-router-dom";
export default function Editor() {
  const { workId } = useParams();
  return <main className="page">Editor shell · workId={workId} · 待 Plan 3 填实</main>;
}
```

- [ ] **Step 2: 把 .page 类加到 globals.css**

把以下追加到 `web/src/styles/globals.css` 末尾：

```css
.page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 24px 80px;
}
```

- [ ] **Step 3: 改 App.tsx 为 layout shell**

`web/src/App.tsx`:
```tsx
import { Outlet } from "react-router-dom";
import { TopNav } from "@/ui/TopNav";

export default function App() {
  return (
    <>
      <TopNav />
      <Outlet />
    </>
  );
}
```

- [ ] **Step 4: 改 main.tsx 装 router + QueryClient**

`web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import Works from "./pages/Works";
import Explore from "./pages/Explore";
import Analytics from "./pages/Analytics";
import Studio from "./pages/Studio";
import Editor from "./pages/Editor";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/typography.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<Works />} />
            <Route path="explore" element={<Explore />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="studio/:workId" element={<Studio />} />
            <Route path="editor/:workId" element={<Editor />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: 删旧 App.test.tsx 中已无效的"editorial"断言；改为冒烟测试**

替换 `web/src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("<App /> shell", () => {
  it("renders TopNav", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<App />}>
            <Route index element={<div>idx</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Autoviral")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 测试**

Run:
```bash
npm run test:web
```
Expected: 全部通过（含 ThemeToggle、TopNav、Glass、format、time、ws、api、theme store、App）。

- [ ] **Step 7: Dev server 手动核验**

Run:
```bash
npm run dev:frontend
```
访问：
- http://localhost:5173/ → Works · WIP，Works tab 高亮
- /explore → Explore · WIP，Explore 高亮
- /analytics → Analytics · WIP
- /studio/abc → Studio shell · workId=abc
- /editor/xyz → Editor shell · workId=xyz

Ctrl-C 退出。

- [ ] **Step 8: Commit**

```bash
git add web/src/main.tsx web/src/App.tsx web/src/App.test.tsx \
        web/src/pages web/src/styles/globals.css
git commit -m "feat(routing): wire 5 routes (Works/Explore/Analytics/Studio/Editor) under App shell"
```

---

### Task 20: TanStack Query — works.ts

**Files:**
- Create: `web/src/queries/works.ts`
- Create: `web/src/test/msw.ts`
- Create: `web/src/queries/works.test.ts`

- [ ] **Step 1: msw handlers**

`web/src/test/msw.ts`:
```ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export const handlers = [
  http.get("/api/works", () =>
    HttpResponse.json([
      { id: "w1", title: "Hook Formula", type: "image-text", status: "published", thumbnail: null, updatedAt: "2026-04-22T10:00:00Z" },
      { id: "w2", title: "Why Nobody Watches", type: "short-video", status: "published", thumbnail: null, updatedAt: "2026-04-23T10:00:00Z" },
      { id: "w3", title: "Competitor Blind Spots", type: "short-video", status: "draft", thumbnail: null, updatedAt: "2026-04-24T10:00:00Z" },
    ]),
  ),
  http.post("/api/works", async ({ request }) => {
    const body = (await request.json()) as { title?: string; type?: string };
    return HttpResponse.json({ id: "w-new", title: body.title ?? "Untitled", type: body.type ?? "short-video", status: "draft", updatedAt: "2026-04-25T00:00:00Z" });
  }),
];

export const mswServer = setupServer(...handlers);
```

更新 `web/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { mswServer } from "./msw";

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
```

- [ ] **Step 2: 测试 — 写**

`web/src/queries/works.test.ts`:
```ts
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import { useWorks } from "./works";
import type { ReactNode } from "react";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useWorks", () => {
  it("fetches list of works from /api/works", async () => {
    const { result } = renderHook(() => useWorks(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(result.current.data?.[0].id).toBe("w1");
  });
});
```

- [ ] **Step 3: 测试 — 运行（fail）**

Run:
```bash
npm run test:web -- web/src/queries/works.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 4: 实现**

`web/src/queries/works.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface WorkSummary {
  id: string;
  title: string;
  type: "short-video" | "image-text";
  status: "draft" | "published" | "archived";
  thumbnail: string | null;
  updatedAt: string;
}

export interface CreateWorkInput {
  title: string;
  type: WorkSummary["type"];
}

export const worksKey = ["works"] as const;

export function useWorks() {
  return useQuery({
    queryKey: worksKey,
    queryFn: () => apiFetch<WorkSummary[]>("/api/works"),
  });
}

export function useCreateWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkInput) => apiFetch<WorkSummary>("/api/works", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: worksKey }),
  });
}

export function useUpdateWork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<WorkSummary> & { id: string }) =>
      apiFetch<WorkSummary>(`/api/works/${id}`, { method: "PUT", body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: worksKey }),
  });
}
```

- [ ] **Step 5: 测试 — PASS**

Run:
```bash
npm run test:web -- web/src/queries/works.test.ts
```
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add web/src/queries/works.ts web/src/queries/works.test.ts web/src/test/msw.ts web/src/test/setup.ts
git commit -m "feat(queries): add useWorks/useCreateWork/useUpdateWork + msw test fixtures"
```

---

### Task 21: trends + analytics + memory queries

**Files:**
- Create: `web/src/queries/trends.ts`
- Create: `web/src/queries/analytics.ts`
- Create: `web/src/queries/memory.ts`
- Modify: `web/src/test/msw.ts`（追加 handlers）

- [ ] **Step 1: msw 追加 trends + analytics + memory handlers**

在 `web/src/test/msw.ts` 的 `handlers` 数组追加：
```ts
http.get("/api/trends/:platform", ({ params }) =>
  HttpResponse.json({
    platform: params.platform,
    items: [
      { rank: 1, title: "POV: cat is chef", views: 45_000_000, likes: 4_200_000, comments: 89_000, change: 24, thumbAspect: "9:16" },
    ],
    refreshedAt: "2026-04-25T12:00:00Z",
  }),
),
http.get("/api/analytics/creator", () =>
  HttpResponse.json({
    account: { nickname: "@alex_creates", follower_count: 342_000, total_favorited: 2_847, aweme_count: 23 },
    summary: { todayLikes: 2847, todayComments: 436, engagementRate: 0.087, todayLikesDelta: 0.123, todayCommentsDelta: 0.041, engagementDelta: -0.004 },
    works: [],
    demographics: { age: { "13-17": 0.08, "18-24": 0.35, "25-34": 0.32, "35-44": 0.15, "45+": 0.10 }, gender: { male: 0.62, female: 0.38 }, regions: [{ name: "United States", pct: 0.28 }, { name: "China", pct: 0.18 }] },
    insights: [{ date: "Mar 14", body: "Competitor gap: tutorial content under-served", tag: "ANGLE" }],
  }),
),
http.get("/api/memory/profile", () => HttpResponse.json({ tags: ["High-aesthetic sports blogger", "Data-driven storytelling", "Fast-paced editing"] })),
```

- [ ] **Step 2: trends.ts**

`web/src/queries/trends.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type Platform = "youtube" | "tiktok" | "xiaohongshu" | "douyin";

export interface TrendItem {
  rank: number;
  title: string;
  views: number;
  likes: number;
  comments: number;
  change: number;
  thumbAspect: "9:16" | "16:9" | "1:1";
}

export interface TrendsResponse {
  platform: Platform;
  items: TrendItem[];
  refreshedAt: string;
}

export function usePlatformTrends(platform: Platform) {
  return useQuery({
    queryKey: ["trends", platform],
    queryFn: () => apiFetch<TrendsResponse>(`/api/trends/${platform}`),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 3: analytics.ts**

`web/src/queries/analytics.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface CreatorAnalytics {
  account: { nickname: string; follower_count: number; total_favorited: number; aweme_count: number };
  summary: { todayLikes: number; todayComments: number; engagementRate: number; todayLikesDelta: number; todayCommentsDelta: number; engagementDelta: number };
  works: { desc: string; play_count: number; digg_count: number; comment_count: number }[];
  demographics: {
    age: Record<string, number>;
    gender: { male: number; female: number };
    regions: { name: string; pct: number }[];
  };
  insights: { date: string; body: string; tag: string }[];
}

export function useCreatorAnalytics() {
  return useQuery({
    queryKey: ["analytics", "creator"],
    queryFn: () => apiFetch<CreatorAnalytics>("/api/analytics/creator"),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 4: memory.ts**

`web/src/queries/memory.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface MemoryProfile { tags: string[] }

export function useMemoryProfile() {
  return useQuery({
    queryKey: ["memory", "profile"],
    queryFn: () => apiFetch<MemoryProfile>("/api/memory/profile"),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 5: 跑全部测试**

Run:
```bash
npm run test:web
```
Expected: 全 PASS（既有 + 新加的 query 文件不破坏既有）。

- [ ] **Step 6: Commit**

```bash
git add web/src/queries/trends.ts web/src/queries/analytics.ts web/src/queries/memory.ts web/src/test/msw.ts
git commit -m "feat(queries): add trends/analytics/memory hooks"
```

---

### Task 22: chat store + useChatSocket hook

**Files:**
- Create: `web/src/features/chat/types.ts`
- Create: `web/src/features/chat/store.ts`
- Create: `web/src/features/chat/useChatSocket.ts`
- Create: `web/src/features/chat/store.test.ts`

- [ ] **Step 1: types**

`web/src/features/chat/types.ts`:
```ts
export type StreamBlockType =
  | "user"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "ask_question";

export interface StreamBlock {
  id: string;
  type: StreamBlockType;
  text: string;
  toolName?: string;
  collapsed?: boolean;
  questions?: string[];
  ts: number;
}
```

> 注：根据 spec §6 D3，`step_divider` 与 `eval_divider` 类型不复存在。

- [ ] **Step 2: store 测试**

`web/src/features/chat/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./store";

describe("chat store", () => {
  beforeEach(() => useChatStore.setState({ blocks: [], streaming: false }));

  it("appends user blocks", () => {
    useChatStore.getState().push({ type: "user", text: "hi" });
    expect(useChatStore.getState().blocks).toHaveLength(1);
    expect(useChatStore.getState().blocks[0].type).toBe("user");
  });

  it("toggles streaming flag", () => {
    useChatStore.getState().setStreaming(true);
    expect(useChatStore.getState().streaming).toBe(true);
  });
});
```

- [ ] **Step 3: store 实现**

`web/src/features/chat/store.ts`:
```ts
import { create } from "zustand";
import type { StreamBlock, StreamBlockType } from "./types";

interface ChatStore {
  blocks: StreamBlock[];
  streaming: boolean;
  push: (b: { type: StreamBlockType; text: string; toolName?: string; questions?: string[] }) => void;
  setStreaming: (s: boolean) => void;
  clear: () => void;
}

let counter = 0;
const nextId = () => `b_${Date.now()}_${counter++}`;

export const useChatStore = create<ChatStore>((set) => ({
  blocks: [],
  streaming: false,
  push: (b) =>
    set((s) => ({
      blocks: [...s.blocks, { id: nextId(), ts: Date.now(), ...b }],
    })),
  setStreaming: (streaming) => set({ streaming }),
  clear: () => set({ blocks: [] }),
}));
```

- [ ] **Step 4: WS hook**

`web/src/features/chat/useChatSocket.ts`:
```ts
import { useEffect, useRef } from "react";
import { ReconnectingWS } from "@/lib/ws";
import { useChatStore } from "./store";
import type { StreamBlock, StreamBlockType } from "./types";

interface IncomingMessage {
  type: StreamBlockType | "stream_start" | "stream_end";
  text?: string;
  toolName?: string;
  questions?: string[];
}

export function useChatSocket(workId: string | null) {
  const ref = useRef<ReconnectingWS | null>(null);
  const push = useChatStore((s) => s.push);
  const setStreaming = useChatStore((s) => s.setStreaming);

  useEffect(() => {
    if (!workId) return;
    const ws = new ReconnectingWS<string>(`/ws/works/${workId}`);
    ref.current = ws;
    const off = ws.on((raw) => {
      try {
        const msg = JSON.parse(raw) as IncomingMessage;
        if (msg.type === "stream_start") setStreaming(true);
        else if (msg.type === "stream_end") setStreaming(false);
        else push({ type: msg.type, text: msg.text ?? "", toolName: msg.toolName, questions: msg.questions });
      } catch {
        // ignore non-JSON frames
      }
    });
    return () => {
      off();
      ws.dispose();
    };
  }, [workId, push, setStreaming]);

  return {
    send(text: string) {
      ref.current?.send(JSON.stringify({ type: "user", text }));
      push({ type: "user", text });
    },
  };
}
```

- [ ] **Step 5: 测试 PASS**

Run:
```bash
npm run test:web -- web/src/features/chat
```
Expected: PASS（store 测试）。WS hook 暂不直接测，留给 e2e 覆盖。

- [ ] **Step 6: Commit**

```bash
git add web/src/features/chat
git commit -m "feat(chat): add chat store + useChatSocket (no eval_divider, no stage markers)"
```

---

### Task 23: Works 页面实现

**Files:**
- Create: `web/src/features/works/WorksHero.tsx` + module css
- Create: `web/src/features/works/NewWorkCard.tsx` + module css
- Create: `web/src/features/works/WorksGrid.tsx` + module css
- Create: `web/src/features/works/InsightRibbon.tsx` + module css
- Modify: `web/src/pages/Works.tsx`
- Test: `web/src/features/works/Works.test.tsx`

- [ ] **Step 1: WorksHero** — 文案模板按 spec §5

`web/src/features/works/WorksHero.module.css`:
```css
.wrap { padding: 56px 0 32px; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px currentColor; }
.h1 { font-size: 56px; line-height: 1.05; letter-spacing: -0.025em; margin: 0 0 12px; max-width: 900px; font-weight: 500; }
.h1 em { font-family: "Instrument Serif", serif; font-style: italic; }
.h1 .num { color: var(--accent); font-feature-settings: "tnum" 1; }
.sub { font-size: 14px; color: var(--text-dim); display: flex; gap: 14px; flex-wrap: wrap; }
```

`web/src/features/works/WorksHero.tsx`:
```tsx
import styles from "./WorksHero.module.css";

interface Props {
  draftCount: number;
  ideaCount: number;
  unfinishedSceneCount: number;
}

export function WorksHero({ draftCount, ideaCount, unfinishedSceneCount }: Props) {
  return (
    <section className={styles.wrap}>
      <div className={styles.eyebrow}>
        <span className={styles.dot} />
        <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
      </div>
      <h1 className={styles.h1}>
        <span className={styles.num}>{draftCount}</span> drafts,{" "}
        <em>{ideaCount} ideas</em> in queue,
        <br />
        and <em>{unfinishedSceneCount}</em> unfinished payoff{" "}
        {unfinishedSceneCount === 1 ? "scene" : "scenes"} waiting for you.
      </h1>
      <div className={styles.sub}>
        <span>No autopilot, no schedule. You decide what to chase next.</span>
      </div>
    </section>
  );
}
```

注：Hero 文案保留 spec §5 的语义；不出现 cron / "every 1h" / "auto-research" 字样。

- [ ] **Step 2: NewWorkCard**

`web/src/features/works/NewWorkCard.module.css`:
```css
.card {
  aspect-ratio: 16/11;
  border-radius: 14px;
  border: 1px dashed var(--glass-hi);
  background: var(--surface-0);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  padding: 1px;
  overflow: hidden;
}
.opt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  transition: background 0.15s, color 0.15s;
  color: var(--text-dim);
  cursor: pointer;
  text-decoration: none;
}
.opt:hover { background: var(--surface-2); color: var(--text); }
.ico {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--glass-border);
  display: grid;
  place-items: center;
  color: var(--accent);
}
.lbl { font-size: 12px; font-weight: 500; color: var(--text); }
.sub { font-family: "JetBrains Mono", monospace; font-size: 9px; letter-spacing: 0.08em; color: var(--text-dimmer); }
```

`web/src/features/works/NewWorkCard.tsx`:
```tsx
import { useNavigate } from "react-router-dom";
import { useCreateWork } from "@/queries/works";
import styles from "./NewWorkCard.module.css";

export function NewWorkCard() {
  const navigate = useNavigate();
  const create = useCreateWork();

  async function pick(type: "short-video" | "image-text") {
    const w = await create.mutateAsync({ title: "Untitled", type });
    navigate(type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`);
  }

  return (
    <div className={styles.card}>
      <button type="button" className={styles.opt} onClick={() => pick("short-video")}>
        <div className={styles.ico}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        </div>
        <div className={styles.lbl}>短视频</div>
        <div className={styles.sub}>SHORT VIDEO · 9:16</div>
      </button>
      <button type="button" className={styles.opt} onClick={() => pick("image-text")}>
        <div className={styles.ico}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <div className={styles.lbl}>图文</div>
        <div className={styles.sub}>CAROUSEL · 4:5</div>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: WorksGrid + InsightRibbon**

`web/src/features/works/WorksGrid.module.css`:
```css
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 56px; }
.card {
  position: relative;
  aspect-ratio: 16/11;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  text-decoration: none;
  display: block;
}
.card:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(0,0,0,0.25), 0 0 0 1px var(--accent); }
.thumb {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, #1a2540 0%, #2a3a5a 50%, #d4a04a 100%);
}
.meta {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 14px 16px;
  background: linear-gradient(180deg, transparent, rgba(10,11,15,0.9));
  color: white;
}
.meta h3 { margin: 0 0 4px; font-size: 14px; font-weight: 500; letter-spacing: -0.01em; }
.subline { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 0.06em; color: rgba(255,255,255,0.6); display: flex; gap: 8px; }
.badge {
  position: absolute; top: 12px; left: 12px;
  padding: 3px 8px;
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  border-radius: 5px;
  background: rgba(10,11,15,0.55);
  color: rgba(255,255,255,0.85);
  border: 1px solid rgba(255,255,255,0.12);
  backdrop-filter: blur(8px);
}
.badgeDraft { color: var(--accent); border-color: var(--accent); }
.typeTag {
  position: absolute; top: 12px; right: 12px;
  padding: 3px 7px;
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  border-radius: 5px;
  background: rgba(10,11,15,0.55);
  color: rgba(255,255,255,0.85);
  border: 1px solid rgba(255,255,255,0.12);
  backdrop-filter: blur(8px);
}
```

`web/src/features/works/WorksGrid.tsx`:
```tsx
import { Link } from "react-router-dom";
import type { WorkSummary } from "@/queries/works";
import { format } from "date-fns";
import clsx from "clsx";
import styles from "./WorksGrid.module.css";

interface Props {
  works: WorkSummary[];
  filter: "all" | "draft" | "published" | "archived";
}

export function WorksGrid({ works, filter }: Props) {
  const visible = filter === "all" ? works : works.filter((w) => w.status === filter);
  return (
    <div className={styles.grid}>
      {visible.map((w) => (
        <Link
          key={w.id}
          to={w.type === "short-video" ? `/studio/${w.id}` : `/editor/${w.id}`}
          className={styles.card}
        >
          <div className={styles.thumb} />
          <div className={clsx(styles.badge, w.status === "draft" && styles.badgeDraft)}>
            {w.type === "short-video" ? "VIDEO" : "IMAGE"} · {w.status === "draft" ? "DRAFT" : "READY"}
          </div>
          <div className={styles.typeTag}>{w.status.toUpperCase()}</div>
          <div className={styles.meta}>
            <h3>{w.title}</h3>
            <div className={styles.subline}>
              <span>{format(new Date(w.updatedAt), "MMM d")}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
```

`web/src/features/works/InsightRibbon.module.css`:
```css
.wrap { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.card {
  padding: 18px 20px;
  border-radius: 14px;
  background: var(--surface-1);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 130px;
}
.tag { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 0.1em; color: var(--accent); }
.head { margin: 0; font-size: 16px; font-weight: 500; line-height: 1.3; }
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-dimmer);
}
```

`web/src/features/works/InsightRibbon.tsx`:
```tsx
import styles from "./InsightRibbon.module.css";

export interface Insight {
  tag: string;
  body: string;
  date: string;
  cta?: string;
}

export function InsightRibbon({ insights }: { insights: Insight[] }) {
  return (
    <section className={styles.wrap}>
      {insights.map((i, idx) => (
        <div key={idx} className={styles.card}>
          <span className={styles.tag}>→ {i.tag}</span>
          <h3 className={styles.head}>{i.body}</h3>
          <div className={styles.foot}>
            <span>{i.date}</span>
            {i.cta && <span style={{ color: "var(--accent)" }}>{i.cta}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Works page**

`web/src/pages/Works.tsx`:
```tsx
import { useMemo, useState } from "react";
import { useWorks } from "@/queries/works";
import { WorksHero } from "@/features/works/WorksHero";
import { NewWorkCard } from "@/features/works/NewWorkCard";
import { WorksGrid } from "@/features/works/WorksGrid";
import { InsightRibbon, type Insight } from "@/features/works/InsightRibbon";

const PLACEHOLDER_INSIGHTS: Insight[] = [
  { tag: "COMPETITOR GAP", body: "Tutorial content under-served in your niche — 3 of 5 top creators have abandoned it.", date: "—", cta: "+ Generate Work →" },
  { tag: "AUDIENCE SIGNAL", body: "Your audience peak shifted to 8 PM weekdays — 2.3× engagement vs morning posts.", date: "—", cta: "Adjust Schedule →" },
  { tag: "STYLE RECOMMENDATION", body: "Warm color grading correlates with +18% retention across last 47 posts.", date: "—", cta: "Apply Preset →" },
];

export default function Works() {
  const works = useWorks();
  const [filter, setFilter] = useState<"all" | "draft" | "published" | "archived">("all");
  const list = works.data ?? [];

  const counts = useMemo(() => ({
    drafts: list.filter((w) => w.status === "draft").length,
    ideas: 0,
    unfinished: list.filter((w) => w.status === "draft" && w.type === "short-video").length,
  }), [list]);

  return (
    <main className="page">
      <WorksHero draftCount={counts.drafts} ideaCount={counts.ideas} unfinishedSceneCount={counts.unfinished} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          My <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>Works</em>
          <span style={{ marginLeft: 12, fontFamily: "JetBrains Mono", fontSize: 11, color: "var(--text-dimmer)" }}>
            {list.length} TOTAL
          </span>
        </h2>
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "draft", "published", "archived"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              data-active={filter === f}
              style={{
                padding: "5px 12px", fontSize: 11, borderRadius: 7,
                border: "1px solid var(--glass-border)",
                background: filter === f ? "var(--surface-2)" : "transparent",
                color: filter === f ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 56 }}>
        <NewWorkCard />
      </div>

      <WorksGrid works={list} filter={filter} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, margin: 0, fontWeight: 500, letterSpacing: "-0.02em" }}>
          Latest <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>Inspiration</em>
        </h2>
      </div>
      <InsightRibbon insights={PLACEHOLDER_INSIGHTS} />
    </main>
  );
}
```

- [ ] **Step 5: 集成测试**

`web/src/features/works/Works.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import Works from "@/pages/Works";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Works page", () => {
  it("renders hero and grid with mock works", async () => {
    render(wrap(<Works />));
    await waitFor(() => expect(screen.getByText(/Hook Formula/i)).toBeInTheDocument());
    expect(screen.getByText(/PICK UP WHERE YOU LEFT OFF/i)).toBeInTheDocument();
    expect(screen.getByText(/Latest/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 跑测试**

Run:
```bash
npm run test:web -- web/src/features/works
```
Expected: PASS（1/1）。

- [ ] **Step 7: Dev 视觉核验**

Run:
```bash
npm run dev:frontend
```
打开 / → 看到 hero + new-work + 3 张作品卡 + 3 张 insight 卡。Ctrl-C 退出。

- [ ] **Step 8: Commit**

```bash
git add web/src/features/works web/src/pages/Works.tsx
git commit -m "feat(works): hero (no autopilot copy) + grid + new-work double-card + insight ribbon"
```

---

### Task 24: Explore 页面实现

**Files:**
- Create: `web/src/features/explore/PlatformTabs.tsx` + module css
- Create: `web/src/features/explore/AnglesCard.tsx` + module css
- Create: `web/src/features/explore/TrendingPanel.tsx` + module css
- Modify: `web/src/pages/Explore.tsx`

- [ ] **Step 1: PlatformTabs**

`web/src/features/explore/PlatformTabs.module.css`:
```css
.tabs { display: flex; gap: 8px; margin-bottom: 24px; }
.tab {
  padding: 8px 16px;
  border-radius: 9px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--glass-border);
  background: var(--surface-0);
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.tab[data-active="true"] {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--glass-hi);
  box-shadow: 0 0 0 1px var(--glass-hi);
}
.live {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-running);
  box-shadow: 0 0 6px currentColor;
}
```

`web/src/features/explore/PlatformTabs.tsx`:
```tsx
import type { Platform } from "@/queries/trends";
import styles from "./PlatformTabs.module.css";

const LIST: { key: Platform; label: string; live: boolean }[] = [
  { key: "youtube", label: "YouTube", live: true },
  { key: "tiktok", label: "TikTok", live: true },
  { key: "xiaohongshu", label: "小红书", live: false },
  { key: "douyin", label: "抖音", live: false },
];

export function PlatformTabs({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className={styles.tabs}>
      {LIST.map((p) => (
        <button
          key={p.key}
          className={styles.tab}
          data-active={value === p.key}
          onClick={() => onChange(p.key)}
        >
          {p.live && <span className={styles.live} />}
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: AnglesCard**

`web/src/features/explore/AnglesCard.module.css`:
```css
.card {
  padding: 26px 28px;
  margin-bottom: 28px;
  background: linear-gradient(135deg, var(--surface-1), var(--surface-0));
  position: relative;
  overflow: hidden;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}
.card::before {
  content: "";
  position: absolute;
  top: -50%;
  right: -10%;
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, var(--accent-glow), transparent 70%);
  pointer-events: none;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 18px;
  position: relative;
}
.h2 { margin: 0; font-size: 22px; font-weight: 500; letter-spacing: -0.02em; }
.h2 em { font-family: "Instrument Serif", serif; font-style: italic; color: var(--accent); }
.list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  position: relative;
}
.angle {
  padding: 16px;
  border-radius: 11px;
  background: var(--surface-1);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 150px;
}
.angle:hover { border-color: var(--accent); transform: translateY(-1px); }
.num { font-family: "Instrument Serif", serif; font-style: italic; font-size: 24px; color: var(--accent); line-height: 1; }
.body { font-size: 13px; color: var(--text); line-height: 1.45; flex: 1; }
.foot { display: flex; justify-content: space-between; align-items: center; }
.score { font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--text-dimmer); letter-spacing: 0.06em; }
.go { font-size: 11px; color: var(--accent); }
```

`web/src/features/explore/AnglesCard.tsx`:
```tsx
import styles from "./AnglesCard.module.css";

export interface Angle { num: string; body: string; score: string }

export function AnglesCard({ angles, onRegenerate }: { angles: Angle[]; onRegenerate: () => void }) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.h2}>
          Three <em>angles</em> AutoViral thinks you should chase
        </h2>
        <button
          onClick={onRegenerate}
          style={{ fontFamily: "JetBrains Mono", fontSize: 10, letterSpacing: "0.06em", background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer" }}
        >
          ↻ REGENERATE
        </button>
      </div>
      <div className={styles.list}>
        {angles.map((a, i) => (
          <div key={i} className={styles.angle}>
            <div className={styles.num}>{a.num}</div>
            <div className={styles.body}>{a.body}</div>
            <div className={styles.foot}>
              <span className={styles.score}>{a.score}</span>
              <span className={styles.go}>Generate →</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: TrendingPanel**

`web/src/features/explore/TrendingPanel.module.css`:
```css
.panel { padding: 22px; border: 1px solid var(--glass-border); background: var(--surface-1); border-radius: var(--radius-lg); }
.head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.title { margin: 0; font-size: 16px; font-weight: 500; letter-spacing: -0.01em; }
.title em { font-family: "Instrument Serif", serif; font-style: italic; }
.meta { font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--text-dimmer); letter-spacing: 0.06em; }
.row {
  display: grid;
  grid-template-columns: 28px 64px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 10px 6px;
  border-radius: 8px;
}
.row:hover { background: var(--surface-0); }
.rank { font-family: "Instrument Serif", serif; font-style: italic; font-size: 22px; color: var(--text-dimmer); line-height: 1; text-align: center; }
.thumb {
  width: 64px;
  aspect-ratio: 9/16;
  border-radius: 5px;
  background: var(--surface-2);
  display: grid;
  place-items: center;
  color: var(--text-dimmer);
  font-size: 9px;
  font-family: "JetBrains Mono", monospace;
  letter-spacing: 0.06em;
}
.title3 { margin: 0 0 4px; font-size: 13px; font-weight: 500; line-height: 1.3; }
.stats { display: flex; gap: 12px; font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--text-dimmer); }
.up { background: rgba(134,239,172,0.12); color: var(--status-done); }
.flat { background: var(--surface-2); color: var(--text-dimmer); }
.down { background: rgba(249,112,102,0.12); color: var(--status-error); }
.arrow { padding: 4px 8px; border-radius: 5px; font-family: "JetBrains Mono", monospace; font-size: 10px; }
```

`web/src/features/explore/TrendingPanel.tsx`:
```tsx
import type { TrendItem, Platform } from "@/queries/trends";
import { compactNumber } from "@/lib/format";
import styles from "./TrendingPanel.module.css";
import clsx from "clsx";

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "▶ YouTube",
  tiktok: "♪ TikTok",
  xiaohongshu: "小红书",
  douyin: "抖音",
};

export function TrendingPanel({ platform, items }: { platform: Platform; items: TrendItem[] }) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={styles.title}>
          {PLATFORM_LABEL[platform]} <em>Trending</em>
        </h2>
        <span className={styles.meta}>TOP {items.length} · 24H</span>
      </div>
      {items.map((it) => (
        <div key={it.rank} className={styles.row}>
          <div className={styles.rank}>{String(it.rank).padStart(2, "0")}</div>
          <div className={styles.thumb}>{it.thumbAspect}</div>
          <div>
            <h3 className={styles.title3}>{it.title}</h3>
            <div className={styles.stats}>
              <span>▶ {compactNumber(it.views)}</span>
              <span>♥ {compactNumber(it.likes)}</span>
              <span>💬 {compactNumber(it.comments)}</span>
            </div>
          </div>
          <div
            className={clsx(
              styles.arrow,
              it.change > 0 ? styles.up : it.change < 0 ? styles.down : styles.flat,
            )}
          >
            {it.change > 0 ? `↑ ${it.change}` : it.change < 0 ? `↓ ${Math.abs(it.change)}` : "— 0"}
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Explore page**

`web/src/pages/Explore.tsx`:
```tsx
import { useState } from "react";
import { PlatformTabs } from "@/features/explore/PlatformTabs";
import { AnglesCard, type Angle } from "@/features/explore/AnglesCard";
import { TrendingPanel } from "@/features/explore/TrendingPanel";
import { usePlatformTrends, type Platform } from "@/queries/trends";

const STATIC_ANGLES: Angle[] = [
  { num: "01", body: "Why nobody is teaching X anymore — competitor gap detected, 3 of 5 top creators abandoned tutorial content.", score: "FIT 94 · 5.2K est. reach" },
  { num: "02", body: "An 18s carousel: \"The first 1.5 seconds of every viral short, ranked\". Hot retention pattern in your niche.", score: "FIT 87 · 3.8K est. reach" },
  { num: "03", body: "Hijack the #fyp · cooking · keyboards mash-up — niche cross-pollination spiking.", score: "FIT 79 · risky" },
];

export default function Explore() {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const trends = usePlatformTrends(platform);

  return (
    <main className="page">
      <section style={{ padding: "48px 0 32px" }}>
        <span className="eyebrow">PULSE OF THE ALGORITHM</span>
        <h1 className="h-display" style={{ fontSize: 52, lineHeight: 1.05, margin: "12px 0 14px", maxWidth: 880, fontWeight: 500 }}>
          What's <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>moving</em> right now,
          <br />
          across the platforms <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>you care about</em>.
        </h1>
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
          Aggregated from <strong style={{ color: "var(--text)" }}>YouTube</strong>, <strong style={{ color: "var(--text)" }}>TikTok</strong>, 小红书, 抖音.
        </div>
      </section>

      <AnglesCard angles={STATIC_ANGLES} onRegenerate={() => { /* hook to chat in Plan 4 */ }} />

      <PlatformTabs value={platform} onChange={setPlatform} />

      {trends.isLoading ? (
        <div style={{ color: "var(--text-dim)" }}>Loading…</div>
      ) : trends.data ? (
        <TrendingPanel platform={platform} items={trends.data.items} />
      ) : (
        <div style={{ color: "var(--text-dim)" }}>No trends data.</div>
      )}
    </main>
  );
}
```

- [ ] **Step 5: 测试 Explore 渲染**

`web/src/features/explore/Explore.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import Explore from "@/pages/Explore";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe("Explore page", () => {
  it("renders hero, angles, platform tabs, trending panel", async () => {
    render(wrap(<Explore />));
    expect(screen.getByText(/PULSE OF THE ALGORITHM/i)).toBeInTheDocument();
    expect(screen.getByText(/Three/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/POV: cat is chef/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: 测试**

Run:
```bash
npm run test:web -- web/src/features/explore
```
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add web/src/features/explore web/src/pages/Explore.tsx
git commit -m "feat(explore): platform tabs + angles card + trending panel (data via TanStack)"
```

---

### Task 25: Analytics 页面实现

**Files:**
- Create: `web/src/features/analytics/KPIBar.tsx` + module css
- Create: `web/src/features/analytics/ProfileBar.tsx` + module css
- Create: `web/src/features/analytics/DemographicsRow.tsx` + module css
- Create: `web/src/features/analytics/InsightsList.tsx` + module css
- Modify: `web/src/pages/Analytics.tsx`

- [ ] **Step 1: KPIBar**

`web/src/features/analytics/KPIBar.module.css`:
```css
.bar { display: flex; gap: 28px; }
.kpi { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.num { font-family: "Instrument Serif", serif; font-style: italic; font-size: 38px; line-height: 1; color: var(--text); }
.lbl { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 0.1em; color: var(--text-dimmer); text-transform: uppercase; }
.delta { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--status-done); }
.deltaDown { color: var(--status-error); }
```

`web/src/features/analytics/KPIBar.tsx`:
```tsx
import { compactNumber, fmtDelta } from "@/lib/format";
import styles from "./KPIBar.module.css";
import clsx from "clsx";

interface Props {
  todayLikes: number; likesDelta: number;
  todayComments: number; commentsDelta: number;
  engagement: number; engagementDelta: number;
}

export function KPIBar({ todayLikes, likesDelta, todayComments, commentsDelta, engagement, engagementDelta }: Props) {
  return (
    <div className={styles.bar}>
      <KPI num={compactNumber(todayLikes)} lbl="Today Likes" delta={likesDelta} />
      <KPI num={compactNumber(todayComments)} lbl="Today Comments" delta={commentsDelta} />
      <KPI num={`${(engagement * 100).toFixed(1)}%`} lbl="Engagement" delta={engagementDelta} />
    </div>
  );
}

function KPI({ num, lbl, delta }: { num: string; lbl: string; delta: number }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.num}>{num}</div>
      <div className={styles.lbl}>{lbl}</div>
      <div className={clsx(styles.delta, delta < 0 && styles.deltaDown)}>{fmtDelta(delta)}</div>
    </div>
  );
}
```

- [ ] **Step 2: ProfileBar**

`web/src/features/analytics/ProfileBar.module.css`:
```css
.profile {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 22px;
  align-items: center;
  padding: 22px;
  margin-bottom: 18px;
  border: 1px solid var(--glass-border);
  background: var(--surface-1);
  border-radius: var(--radius-lg);
}
.avatar {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: linear-gradient(135deg, hsl(40,40%,70%), hsl(20,40%,55%));
  border: 1px solid var(--glass-border);
}
.h2 { margin: 0 0 4px; font-size: 20px; font-weight: 500; letter-spacing: -0.015em; }
.handleMeta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  background: linear-gradient(180deg, var(--accent-hi), var(--accent));
  color: var(--accent-fg);
  border: 1px solid var(--accent-hi);
}
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.stag {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-dim);
  border: 1px solid var(--glass-border);
  background: var(--surface-0);
}
.stag.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
```

`web/src/features/analytics/ProfileBar.tsx`:
```tsx
import { compactNumber } from "@/lib/format";
import styles from "./ProfileBar.module.css";
import clsx from "clsx";

interface Props { nickname: string; followers: number; tags: string[] }

export function ProfileBar({ nickname, followers, tags }: Props) {
  return (
    <section className={styles.profile}>
      <div className={styles.avatar} />
      <div>
        <h2 className={styles.h2}>{nickname}</h2>
        <div className={styles.handleMeta}>
          <span className={styles.pill}>▶ {compactNumber(followers)}</span>
        </div>
      </div>
      <div className={styles.tags}>
        {tags.slice(0, 5).map((t, i) => (
          <span key={t} className={clsx(styles.stag, i === 0 && styles.primary)}>{t}</span>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: DemographicsRow**

`web/src/features/analytics/DemographicsRow.module.css`:
```css
.row { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 14px; margin-bottom: 18px; }
.panel { padding: 20px; border: 1px solid var(--glass-border); background: var(--surface-1); border-radius: var(--radius-lg); }
.h3 {
  margin: 0 0 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-dim);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.h3 em { font-family: "Instrument Serif", serif; font-style: italic; color: var(--text); font-size: 15px; }
.bars { display: flex; flex-direction: column; gap: 8px; }
.barRow { display: grid; grid-template-columns: 36px 1fr 36px; gap: 10px; align-items: center; font-family: "JetBrains Mono", monospace; font-size: 11px; }
.lbl { color: var(--text-dim); }
.track { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.fill { height: 100%; background: linear-gradient(90deg, var(--accent-lo), var(--accent)); border-radius: 3px; }
.pct { color: var(--text); text-align: right; }
.legend { display: flex; flex-direction: column; gap: 8px; }
.legendRow { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; }
```

`web/src/features/analytics/DemographicsRow.tsx`:
```tsx
import styles from "./DemographicsRow.module.css";

interface Props {
  age: Record<string, number>;
  gender: { male: number; female: number };
  regions: { name: string; pct: number }[];
}

export function DemographicsRow({ age, gender, regions }: Props) {
  return (
    <section className={styles.row}>
      <div className={styles.panel}>
        <h3 className={styles.h3}>Age <em>distribution</em></h3>
        <div className={styles.bars}>
          {Object.entries(age).map(([range, ratio]) => (
            <div key={range} className={styles.barRow}>
              <div className={styles.lbl}>{range}</div>
              <div className={styles.track}><div className={styles.fill} style={{ width: `${ratio * 100}%` }} /></div>
              <div className={styles.pct}>{Math.round(ratio * 100)}%</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h3}>Gender <em>split</em></h3>
        <div className={styles.legend}>
          <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--accent)" }} />Male · {Math.round(gender.male * 100)}%</div>
          <div className={styles.legendRow}><div className={styles.swatch} style={{ background: "var(--surface-2)", border: "1px solid var(--glass-hi)" }} />Female · {Math.round(gender.female * 100)}%</div>
        </div>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.h3}>Top <em>regions</em></h3>
        {regions.map((r) => (
          <div key={r.name} className={styles.barRow}>
            <div className={styles.lbl}>{r.name}</div>
            <div className={styles.track}><div className={styles.fill} style={{ width: `${r.pct * 100}%` }} /></div>
            <div className={styles.pct}>{Math.round(r.pct * 100)}%</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: InsightsList**

`web/src/features/analytics/InsightsList.module.css`:
```css
.card { padding: 24px 26px; border: 1px solid var(--glass-border); background: var(--surface-1); border-radius: var(--radius-lg); }
.h2 { margin: 0 0 6px; font-size: 18px; font-weight: 500; }
.h2 em { font-family: "Instrument Serif", serif; font-style: italic; }
.sub { font-size: 12px; color: var(--text-dim); margin-bottom: 18px; }
.row {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  gap: 14px;
  padding: 14px 0;
  border-top: 1px solid var(--divider);
  align-items: start;
}
.row:first-of-type { border-top: none; }
.date { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--text-dimmer); padding-top: 2px; }
.body p { margin: 0; font-size: 14px; line-height: 1.5; }
.tag {
  padding: 3px 8px;
  border-radius: 5px;
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
  background: var(--surface-2);
  color: var(--text-dim);
  border: 1px solid var(--glass-border);
  white-space: nowrap;
}
```

`web/src/features/analytics/InsightsList.tsx`:
```tsx
import styles from "./InsightsList.module.css";

interface Item { date: string; body: string; tag: string }

export function InsightsList({ items }: { items: Item[] }) {
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>Latest research <em>insights</em></h2>
      <div className={styles.sub}>Curated by Sonnet · ranked by relevance to your channel</div>
      {items.map((i, idx) => (
        <div key={idx} className={styles.row}>
          <div className={styles.date}>{i.date}</div>
          <div className={styles.body}><p>{i.body}</p></div>
          <span className={styles.tag}>→ {i.tag}</span>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Analytics page**

`web/src/pages/Analytics.tsx`:
```tsx
import { useCreatorAnalytics } from "@/queries/analytics";
import { useMemoryProfile } from "@/queries/memory";
import { KPIBar } from "@/features/analytics/KPIBar";
import { ProfileBar } from "@/features/analytics/ProfileBar";
import { DemographicsRow } from "@/features/analytics/DemographicsRow";
import { InsightsList } from "@/features/analytics/InsightsList";

export default function Analytics() {
  const a = useCreatorAnalytics();
  const m = useMemoryProfile();

  if (a.isLoading || m.isLoading) return <main className="page">Loading…</main>;
  if (!a.data) return <main className="page">No analytics data.</main>;

  const { account, summary, demographics, insights } = a.data;

  return (
    <main className="page">
      <section style={{ padding: "40px 0 28px", display: "grid", gridTemplateColumns: "1fr auto", gap: 32, alignItems: "end" }}>
        <div>
          <span className="eyebrow">CHANNEL HEALTH · last 7 days</span>
          <h1 style={{ fontSize: 44, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.05, margin: "12px 0 6px" }}>
            Your audience is <em style={{ fontFamily: "Instrument Serif", fontStyle: "italic" }}>warming up</em>.
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
            {account.nickname} · {(account.follower_count / 1000).toFixed(0)}K followers · {account.aweme_count} published works
          </div>
        </div>
        <KPIBar
          todayLikes={summary.todayLikes}
          likesDelta={summary.todayLikesDelta}
          todayComments={summary.todayComments}
          commentsDelta={summary.todayCommentsDelta}
          engagement={summary.engagementRate}
          engagementDelta={summary.engagementDelta}
        />
      </section>

      <ProfileBar nickname={account.nickname} followers={account.follower_count} tags={m.data?.tags ?? []} />
      <DemographicsRow age={demographics.age} gender={demographics.gender} regions={demographics.regions} />
      <InsightsList items={insights} />
    </main>
  );
}
```

- [ ] **Step 6: 测试**

`web/src/features/analytics/Analytics.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect } from "vitest";
import Analytics from "@/pages/Analytics";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe("Analytics page", () => {
  it("renders hero KPIs and profile when data loaded", async () => {
    render(wrap(<Analytics />));
    await waitFor(() => expect(screen.getByText(/@alex_creates/i)).toBeInTheDocument());
    expect(screen.getByText(/2,847|2.8K/)).toBeInTheDocument();
  });
});
```

Run:
```bash
npm run test:web -- web/src/features/analytics
```
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add web/src/features/analytics web/src/pages/Analytics.tsx
git commit -m "feat(analytics): hero KPI + profile bar + demographics + insights list (real /api data)"
```

---

### Task 26: Studio + Editor 占位 shell（Plan 2/3 之前的 placeholder）

**Files:**
- Modify: `web/src/pages/Studio.tsx`
- Modify: `web/src/pages/Editor.tsx`

- [ ] **Step 1: Studio shell（删 rail 行）**

`web/src/pages/Studio.tsx`:
```tsx
import { useParams } from "react-router-dom";

export default function Studio() {
  const { workId } = useParams();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 300px",
        gridTemplateRows: "56px 1fr 320px",
        gridTemplateAreas: `"top top top" "chat preview aside" "chat timeline aside"`,
        gap: 12,
        padding: 12,
        height: "100vh",
        maxHeight: "100vh",
      }}
      data-work-id={workId}
    >
      <div style={{ gridArea: "top", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>top bar</div>
      <div style={{ gridArea: "chat", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>chat (Plan 2)</div>
      <div style={{ gridArea: "preview", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
        <Player workId={workId ?? "?"} />
      </div>
      <div style={{ gridArea: "aside", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>tweaks (Plan 2)</div>
      <div style={{ gridArea: "timeline", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>timeline (Plan 2)</div>
    </div>
  );
}

function Player({ workId }: { workId: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="font-editorial-italic" style={{ fontSize: 28 }}>Studio</div>
      <div className="font-mono" style={{ marginTop: 8, color: "var(--text-dimmer)" }}>workId: {workId}</div>
      <div className="font-mono" style={{ marginTop: 4, color: "var(--text-dimmer)" }}>Remotion Player · Plan 2</div>
    </div>
  );
}
```

- [ ] **Step 2: Editor shell**

`web/src/pages/Editor.tsx`:
```tsx
import { useParams } from "react-router-dom";

export default function Editor() {
  const { workId } = useParams();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr 340px",
        gridTemplateRows: "56px 1fr 124px",
        gridTemplateAreas: `"top top top" "left canvas right" "left tray right"`,
        gap: 12,
        padding: 12,
        height: "100vh",
      }}
      data-work-id={workId}
    >
      <div style={{ gridArea: "top", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>top bar</div>
      <div style={{ gridArea: "left", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>slides nav (Plan 3)</div>
      <div style={{ gridArea: "canvas", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)", display: "grid", placeItems: "center", color: "var(--text-dim)" }}>
        <div style={{ textAlign: "center" }}>
          <div className="font-editorial-italic" style={{ fontSize: 28 }}>Editor</div>
          <div className="font-mono" style={{ marginTop: 8, color: "var(--text-dimmer)" }}>workId: {workId}</div>
          <div className="font-mono" style={{ marginTop: 4, color: "var(--text-dimmer)" }}>Konva canvas · Plan 3</div>
        </div>
      </div>
      <div style={{ gridArea: "right", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>inspector (Plan 3)</div>
      <div style={{ gridArea: "tray", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-lg)", background: "var(--surface-1)" }}>filmstrip (Plan 3)</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Studio.tsx web/src/pages/Editor.tsx
git commit -m "feat(pages): scaffold Studio (no rail) + Editor shells; Plan 2/3 fills bodies"
```

---

### Task 27: Playwright e2e — 导航 + Works smoke

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/navigation.spec.ts`
- Create: `e2e/works.spec.ts`
- Modify: `package.json` scripts

- [ ] **Step 1: Playwright 配置**

根 `playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: process.env.AV_E2E_BASE ?? "http://localhost:5173",
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev:frontend",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: navigation spec**

`e2e/navigation.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test.describe("top-level navigation", () => {
  test("loads / and reaches Explore + Analytics", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Autoviral")).toBeVisible();

    await page.getByRole("link", { name: /Explore · 灵感/ }).click();
    await expect(page).toHaveURL(/\/explore/);
    await expect(page.getByText(/PULSE OF THE ALGORITHM/i)).toBeVisible();

    await page.getByRole("link", { name: /Analytics · 数据/ }).click();
    await expect(page).toHaveURL(/\/analytics/);
  });
});
```

- [ ] **Step 3: works spec**

`e2e/works.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test.describe("Works page", () => {
  test("does NOT mention auto-research / cron / EVERY 1H", async ({ page }) => {
    await page.goto("/");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/auto-?research/i);
    expect(body).not.toMatch(/every 1h/i);
    expect(body).not.toMatch(/researched \d+ pieces/i);
    expect(body).not.toMatch(/pipeline|stage|阶段/i);
  });

  test("hero says PICK UP WHERE YOU LEFT OFF", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/PICK UP WHERE YOU LEFT OFF/i)).toBeVisible();
  });
});
```

- [ ] **Step 4: 装 Playwright browsers**

Run:
```bash
npx playwright install chromium
```

- [ ] **Step 5: 增 npm scripts**

修改根 `package.json` scripts，追加：
```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 6: 跑 e2e**

注：后端不需要——Works/Explore/Analytics 在没有后端时由于 `useWorks` 等会失败、但页面骨架仍在；本测试只验证 chrome 上无致命错误 + 文案。如必须启后端，本地另一终端 `npm run dev`。

Run:
```bash
npm run e2e
```
Expected: 全 PASS。如 Works 测试因 fetch 失败提示 hero 渲染问题，则在 Works.tsx 加上"works.isError 时 fallback 0/0/0 hero"分支。

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e package.json
git commit -m "test(e2e): add navigation + works smoke (asserts no stage/auto-research copy)"
```

---

### Task 28: 全量构建 + 最终核验

**Files:** —（仅命令）

- [ ] **Step 1: 安装一致性**

Run:
```bash
npm install
```

- [ ] **Step 2: 类型检查**

Run:
```bash
npx tsc --noEmit -p web/tsconfig.json
```
Expected: 无 error。

- [ ] **Step 3: 全 unit/集成测试**

Run:
```bash
npm run test:web
```
Expected: 全 PASS。

- [ ] **Step 4: 前端生产构建**

Run:
```bash
npm run build:frontend
```
Expected: 输出 `web/dist/` 包含 index.html + assets。

- [ ] **Step 5: e2e 完整跑**

Run:
```bash
npm run e2e
```
Expected: 全 PASS。

- [ ] **Step 6: 启 dev + 后端，手动核验**

打开两个终端：
- T1: `npm run dev`（后端）
- T2: `npm run dev:frontend`（前端）

访问：
- /：Works hero 数字来自 /api/works 真实数据
- /explore：YouTube tab 默认激活，trending panel 渲染数据
- /analytics：KPI/profile/demographics/insights 渲染数据
- /studio/<任意 id>：shell 占位
- /editor/<任意 id>：shell 占位

主题切换、暗/亮 + accent 切换通过 ThemeToggle 工作。

- [ ] **Step 7: 最终 commit + tag**

```bash
git tag plan1-scaffold-complete
git log --oneline | head -30
```

确认 commit 历史里看不到任何"阶段/pipeline"措辞。

---

## Self-Review checklist (skim before marking plan complete)

- [ ] **Spec coverage**：spec §3 (repo layout, web/ 部分) ✓ Tasks 5-19；§4 (build/run) ✓ Tasks 3, 6, 28；§5 (5 routes) ✓ Tasks 19, 23-26；§6 (D3 锚点 ① ② ③ 前端部分) ✓ Tasks 22, 26 (rail 不存在), 22 (StreamBlockType 无 eval_divider)；§8 (stack lock) ✓ Task 2；§13 (testing) ✓ Tasks 11-25, 27；后端 D3 (④⑤⑥⑦) ↪ **属于 Plan 4**；图文 Editor 实体 ↪ **Plan 3**；视频 Studio 实体 ↪ **Plan 2**；CLAUDE.md brand 覆盖 ↪ **Plan 5**
- [ ] **Placeholder scan**：无 "TBD/TODO/implement later"；e2e Task 27 Step 6 有"如必须启后端"说明，是条件分支不是 placeholder
- [ ] **Type consistency**：`StreamBlockType`、`WorkSummary.type`、`Platform` 等所有跨任务引用名一致；`useTheme` setTheme 签名一致；`apiFetch` 泛型用法一致
- [ ] **All "stage" forbiddens absent**：grep 计划自身确认无 step/stage/phase/pipeline UI 字段；e2e Task 27 主动断言这些字眼不会出现在 Works 页

---

**Plan 1 完整。等待 subagent-driven-development 调度执行。**
