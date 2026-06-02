# 贡献指南 · CONTRIBUTING

> 面向**人类与 agent**两类贡献者。先读 [`CLAUDE.md`](CLAUDE.md)（项目指令，最高优先级）与 [`CONTEXT.md`](CONTEXT.md)（领域词汇 + 不变量），再回到这里看怎么把环境跑起来、怎么改、怎么测、怎么发。文档地图在 [`docs/README.md`](docs/README.md)。

AutoViral 是一个常驻 Node daemon（`node dist/index.js start`，端口 3271）+ Vite/React Studio SPA + Remotion 渲染 + 系统 ffmpeg + python venv 的组合。下面的命令都假设你在仓库根目录、用 **npm**（不要用 bun / pnpm）。

---

## 前置环境

| 依赖 | 要求 | 用途 / 说明 |
|---|---|---|
| Node | **20.x** | 全仓统一 npm，CI 也跑在 Node 20 |
| npm | 随 Node | **唯一包管理器**——不要引入 bun / pnpm，lockfile 是 `package-lock.json` |
| ffmpeg + ffprobe | 系统级，建议 `brew install ffmpeg` | **渲染（render-pipeline）与波形（waveform / peaks）需要它**；daemon 以裸名 `spawn("ffmpeg")` / `execFile("ffprobe")` 走 PATH 解析。不在 PATH 是头号首次运行故障 |
| python3 + venv | 系统 python3 | TTS（edge-tts，venv 在 `~/.autoviral/tts-venv`）与 peaks 预烘焙需要；Whisper 转写用 `pip install stable-ts`（注意不是 `stable-whisper`，import 名是 `stable_whisper`） |

> **Apple Silicon Mac**：GPU 是 Metal / MPS，**不是 CUDA**。涉及本地 ML 的栈（转写、人脸检测等）选 Mac 友好的实现，不要假设 CUDA。

> 桌面壳形态（Electron）下 ffmpeg 会随包 bundle、不要求用户系统装 ffmpeg；但**本地开发** daemon 时仍需系统 ffmpeg 在 PATH。

---

## 安装

```bash
npm install          # 安装根包依赖（postinstall 会跑首次设置：拷 skills/、修 node-pty 权限等）
npm run install:cli  # 构建并 npm link 协议层 CLI（cli/autoviral），让 Studio 内 agent 能调 `autoviral`
```

`install:cli` 等价于 `cd cli/autoviral && npm install && npm run build && npm link`——它是 Studio 终端里 agent 调用的那个 `autoviral` 协议 CLI（与根包 daemon 是两个不同的分发制品，关系见 [PRD-0001](docs/prd/0001-v0.1.0-release-and-conventions.md)）。

---

## 构建与启动

```bash
npm run build           # = build:backend (tsc) + build:frontend (vite build)
npm run build:backend   # 只编译后端 TypeScript → dist/
npm run build:frontend  # 只编译前端 → web/dist/
node dist/index.js start              # 启动 daemon（端口 3271，daemonize，能挺过 harness SIGTERM）
node dist/index.js start --foreground # 前台启动（你掌控生命周期，调试时用）
```

### 陈旧 dist 陷阱（务必读）

`localhost:3271` 服务的是**预构建产物**，不是 Vite HMR——它会落后于你刚改的源码：

- 改了 `src/`（后端 / shared / server）：必须 `npm run build:backend` **并 RESTART daemon**。`dist` 的 server JS 在进程启动时就冻结了，不重启 daemon 改动不生效（这与前端 Vite 不同）。
- 改了 `web/src/`（前端）：`npm run build:frontend` 重出 `web/dist`，刷新页面即可。
- 排查「UI 上某个东西不见了」之前，先确认 bundle 是新鲜的——历史上险些据陈旧 bundle 误报「组件缺失」的 bug。

> 注意：根 `npm run build` 的 `tsc` gate 可能因历史 test-fixture 类型债而失败、连带挡住 vite。若只是要起前端，单跑 `npm run build:frontend`。

---

## 开发循环

1. 改源码（`src/` 后端 / `web/src/` 前端 / `cli/autoviral/` 协议 CLI）。
2. 按上面「陈旧 dist 陷阱」重建对应产物（后端要重启 daemon，前端刷新页面）。
3. 跑一次性测试（见下「测试纪律」）。
4. 端到端验证以**浏览器里看得到**为准，不是后端 artifact——见 [`.claude/rules/e2e-testing.md`](.claude/rules/e2e-testing.md)。
5. commit（见「提交约定」）。

---

## 测试纪律（HARD RULES）

内存炸过两次，下面的规矩**不可违反**：

- **默认一次性运行**，跑完即退出：
  ```bash
  npm run test:web      # 前端套件，跑完退出（不要默认 :watch）
  npm run test:server   # 服务端套件，跑完退出
  npm test              # 两个套件依次跑
  ```
- **watch 模式只用于主动调试单个文件**（`test:web:watch` / `test:server:watch`），调完立刻 Ctrl+C，**绝不让它常驻后台**。不要用 watch 来「验证我刚改的代码」——一次性 run 就够了。
- **worker 数量两个 pool 都封顶 = 2**：`web/vitest.config.ts` 的 `poolOptions.threads.maxThreads = 2`、`vitest.server.config.ts` 的 `poolOptions.forks.maxForks = 2`。改任一 vitest 配置都不要移除这两个上限（默认会开 7 worker × ~150MB ≈ 1GB 常驻）。
- **绝不绕过 npm 直接调 `vitest`**：`pretest:web` / `pretest:server` 钩子会先 `pkill -f` 掉上次同 config 的残留进程；绕过 npm 就绕过了这个清理，钩子失效。
- **绝不并发跑两个 vitest**：不要在两个终端同时跑，也不要在 watch 还活着时另起一次 run——同一 config 第二次启动会绕开 `maxThreads` 形成双倍 worker。
- **跑完自检**：
  ```bash
  pgrep -f vitest | wc -l   # 应 ≤ 3（1 主进程 + ≤2 worker）；≥5 立即 pkill -f vitest 然后排查
  ```

python 侧测试用 `npm run test:python`（`python3 -m pytest skills/autoviral`）。

---

## 分支策略

- `main` 是活跃 trunk（你通常对它发 PR）。
- feature / 重构在 `refactor/*` 等分支上做（如当前的 `refactor/agentic-terminal`）。
- **不要随便 push**：除非用户明确要求，否则只 commit 保证记录、不 push。如果当前在默认分支上，先开分支再动。

---

## 提交约定

- 提交信息用**祈使句**（"add X" / "fix Y"，不是 "added" / "fixes"）。
- 关闭 issue 用 `Closes #N`（commit 合入即关闭对应 GitHub Issue）。
- 每条 commit 信息结尾带 footer：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- PR body 结尾带：
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

---

## 如何发布 release

严格 semver `MAJOR.MINOR.PATCH`，整仓单一版本号，tag 形如 `vMAJOR.MINOR.PATCH`。流程保持轻量（手动 bump + 手写 CHANGELOG + tag 触发 CI），不引入 changesets / semantic-release。

1. **bump 版本**：在 `package.json` 改 `version`。bump 规则：
   - **MAJOR** — 破坏性变更（bridge 协议不兼容、CLI 契约移除/改名、composition schema 不向后兼容、桌面数据目录布局破坏）。
   - **MINOR** — 向后兼容的新能力（新 Studio feature、新 CLI 子命令、新 skill recipe、新桌面 target）。
   - **PATCH** — 向后兼容的修复（bug fix、文案 / i18n、性能、纯 docs）。
   - **pre-1.0 caveat**：0.x 阶段 API 视为未稳定，`0.MINOR` 提升可能携带行为变化，1.0 前不对外承诺 semver 破坏性保证。
2. **写 CHANGELOG 段落**：采用 [Keep a Changelog] 格式，标题语法严格为 `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`，分类 Added / Fixed / Changed / Improved。**这段就是发布说明的单一事实来源**——保持标题语法可被 awk 抽取喂给 `gh release create --notes-file`，让 CHANGELOG 与 GitHub Release 不漂移。
3. **打 tag 并 push**：`git tag vX.Y.Z` 后 push tag。tag 必须与 `package.json` 的 version 对齐。
4. **CI 接管**：`.github/workflows/release.yml` 由 `v*.*.*` tag push 触发——矩阵构建桌面安装包（mac + win）并 publish 协议 CLI（`@autoviral/cli`）。发布前 `.github/workflows/ci.yml` 已在 push/PR 上验证过 `npm run build` + `test:web` + `test:server` 全绿（尊重 maxThreads/maxForks=2 上限），保证 release 不带红上车。

> 0.1.0 接受 unsigned 安装包（无 mac notarization / win Authenticode），发布说明里附绕过 Gatekeeper / SmartScreen 的一行指引。详见 [PRD-0001](docs/prd/0001-v0.1.0-release-and-conventions.md) 的 Release & Versioning Policy。

[Keep a Changelog]: https://keepachangelog.com/
