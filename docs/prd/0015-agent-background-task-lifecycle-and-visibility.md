# PRD-0015 · Studio chat 后台任务生命周期与可见性：让 Workflow 编排在工位里活下来、看得见

**Status: Proposed → Implemented → Shipped (2026-07-15, v0.2.1) **
> 交付实况：S1-S7 全交付（帧归一化 → registry → 信封 → web 任务卡片 → ceiling 配置 → KillGate → journal 打捞），四轮 codex review 全闭环；E2E 收口纬度见 Testing Decisions。

> Source: GitHub issues [#96](https://github.com/nanxingw/AutoViral/issues/96)（[docs/issues/030](../issues/030-studio-chat-kills-background-workflow.md)）/ [#97](https://github.com/nanxingw/AutoViral/issues/97)（[docs/issues/031](../issues/031-studio-no-subagent-visibility.md)），用户 2026-07-15 报告并要求根因入 PRD。
> 根因调查：2026-07-15 Workflow `wf_766f984e-a6c`（3 路 codex 调研 + 3 路对抗验证，全部 partial-confirmed 后经主线亲验修正）。运行时日志证据主线逐条复核（`~/.autoviral/logs/2026-07-15.jsonl`）。
> Issue 切片：随 `to-issues` 落 `0015-agent-background-task-lifecycle-and-visibility-issue-slices.md`（docs-only tracker，绝不开 GitHub Issue）。
> 纪律不变：测试先行（[.claude/rules/test-first.md](../../.claude/rules/test-first.md)）；E2E 走 Workflow 多纬 subagent（[.claude/rules/e2e-testing.md](../../.claude/rules/e2e-testing.md)）。

---

## Problem Statement

用户在 Studio chat 里让 Claude agent 用 Workflow 工具编排多 subagent 深度任务（实例：`w_20260714_2317_f24` 的 run `wf_296ee812-c04`，6 research + 12 verify + 1 synthesize，烧真金白银跑十几分钟）。结果：**turn 结束后约 10 分钟任务全灭，两次复现同签名；UI 全程无任何任务状态，被杀了用户也无感知**。`.claude/rules/e2e-testing.md` Hard rule 0（E2E 必须经 Workflow 多纬编排）在 Studio chat 环境里事实不可执行——这是产品命题级缺口：chat 是非技术用户唯一的 agent 入口，它必须能承载 agent 的完整工作方式。

### 根因 #96（030）——已证实，证据链闭环

**架构前提**：Chat panel 每轮 spawn 一个一次性 `claude -p --output-format stream-json` 子进程（stdin 关闭），下一轮以 `--resume <uuid>` 起新进程重建对话（ADR-005/ADR-013 的既定设计，代码注释自证："spawns a FRESH `claude --resume <id> -p` process PER TURN"）。进程天生活不过一轮，而 harness-tracked 的后台任务（Workflow run、background Bash、subagent）的宿主正是这个进程。

**直接死因（本次事故的真凶）**：不是 AutoViral 主动 kill。claude CLI print-mode 自带"后台任务等待上限"——turn 的 `result` 帧会被 hold 住等后台任务，等满 **600 秒**（`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`，Claude Code 2.1.210 二进制内默认 600000ms）后 CLI **在子进程内部强制终止全部后台任务**，随即吐出 `result` 帧并正常退出。运行时日志两次事故完全同签名，时序精确到毫秒：

```
06:32:50.195 cli_stderr  "Background tasks still running after 600s; terminating.
                          Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely."
06:32:50.202 turn_complete （agent 播报"调研 Workflow 已启动"——它自己也不知道任务已死）
06:32:50.712 cli_exit    code:0 signal:null   ← 正常退出，非 SIGTERM/SIGKILL
（06:50:24 第二次：resume 续跑后逐字同签名再死一遍）
```

600s = 10 分钟，与 issue 记录的时间线（23:22 启动 → 23:32 journal 停写）严丝合缝。注意：该环境变量与 600s 默认值在 AutoViral 源码中**零出现**——这是纯上游（claude CLI）行为，经运行时日志 + 已装二进制字符串抽取双重独立验证。

**为什么 resume 也救不了**：`--resume` 只重放对话史进一个全新进程，不复活旧 PID 或其后台任务；`resumeFromRunId` 在新进程里重启 workflow 后，同一架构下再次撞上同一个 600s 上限（日志第二签名）。且事故 journal 显示已完成的 agent 在 resume 后以**新 agent ID 重跑**而非缓存命中——重复花费真实发生。

**共犯（本次未开枪、但同样无 drain 的 AutoViral 侧 kill 点，共 11 处）**：新消息到达时 SIGTERM 残活进程、createSession 替换旧进程、backend/model 切换、passthrough 命令替换、`killSession`（SIGTERM + 5s SIGKILL 升级；调用方含 /stop、work 删除、abort、test-runner 超时）、浏览器断连 60s grace 回收、DELETE session 路由、idle-TTL 归档清扫、daemon 自身退出 handler 不 drain 子进程。**没有任何一处在杀之前检查后台任务**。一旦拉高 ceiling 让进程活得更久，这些立即接棒成为新凶手——所以止血（改 ceiling）和治本（drain 纪律）必须一起做。

### 根因 #97（031）——已证实，"零可见性"表述修正

调查修正了 issue 的表述：**不是链路断了，是最后一公里被静默丢弃**；字面"零可见性"不成立（Workflow/Agent 的 tool_use 会渲染成通用 tool chip），真缺口是**生命周期状态**。逐层：

1. **ChatBackend seam 不归一化**：claude stream-json 里的任务生命周期 system 帧（`task_started` / `task_progress` / `task_notification` / `background_tasks_changed` 等，帧名待 fixture 锁定）只有 `system/init` 被识别，其余 fall through 到 onOther → 以 `cli_event` 原样转发；且 seam 丢弃 tool_use 的 block id 与 tool_result 的 `tool_use_id`，launch/result/lifecycle 无法关联。
2. **server 无任务 registry**：进程退出只广播 `cli_exited`，无法识别"还有哪些任务在跑"、更无法替它们合成 stopped/killed 终态事件——正是"被杀无提示"的结构成因。
3. **契约与信封缺位**：`event-stream.md` 目录里没有任何 workflow/subagent/任务类信封；现有 `ui-progress` 信封是单线性 start/step/done、无任务身份、无并发语义、无终态字段，前端消费为 ~2 秒即弃 toast——设计上就不是给任务状态用的；bridge 流无 replay，重连后状态即失。
4. **web 层最终丢弃点**：useChatSocket 注释明写 "Silently ignore … cli_event …"；`session_killed` / `cli_exited` 只折叠成一个 `streaming` 布尔；chat store 只有 append-only blocks，无 task map、无同 id upsert 语义——事件到了也没有状态模型能装。

后果：多 agent 任务用户全程盲飞，无法感知/暂停/取消；030 类死亡对用户完全静默，直到 agent 下轮自己坦白。

## Solution

一句话：**让宿主进程活到后台任务收尾（止血 ceiling + 治本 drain 纪律），把任务生命周期从 CLI 帧一路焊到 Studio 任务卡片（seam 归一化 → server registry → ui-workflow 信封 → web 面板），死了要打捞、要广播**。

用户视角的最终状态：agent 在 chat 里启动 Workflow → Studio 出现任务卡片（名称/阶段/子 agent 计数/状态）→ turn 结束后任务继续跑、卡片持续更新 → 完成时 agent 下轮收到通知、卡片翻绿；若任务确实被终止（用户删 work、显式 /stop），卡片翻 stopped + toast 明示，绝不静默；daemon 或进程意外死亡后，journal 里已完成的部分被打捞回来标记 orphaned，损失可见、花费可查。

## User Stories

**创作者（人在 Studio）**

1. As a 创作者, I want agent 启动后台 Workflow 时 Studio 立刻出现任务卡片（名称、阶段、子 agent 计数、running 状态）, so that 我知道钱花在哪、任务真的在跑。
2. As a 创作者, I want 任务卡片随进度实时更新（阶段推进、完成计数）, so that 十几分钟的编排不是黑盒等待。
3. As a 创作者, I want 任务完成时卡片翻 done 并收到 toast, so that 我不用反复问 agent"好了没"。
4. As a 创作者, I want 任务被终止时卡片翻 stopped/killed 并收到明确 toast, so that 我第一时间知道要补救，而不是以为 agent 还在干活。
5. As a 创作者, I want 我发下一条消息、切换模型、暂离浏览器时后台任务**不被连坐杀死**, so that 正常使用 chat 不会毁掉跑了十分钟的付费编排。
6. As a 创作者, I want 刷新页面或断线重连后任务卡片还在且状态准确, so that 可见性不依赖恰好在线的那一刻。
7. As a 创作者, I want 确需终止时有明确的终止入口（如 /stop 或删除 work）且系统告诉我杀了什么, so that 终止是我的决定而非系统的暗箱。
8. As a 创作者, I want 进程意外死亡后已完成的子 agent 结果被打捞回来, so that 中断不等于全部白烧。

**Agent（chat 内被 spawn 的 CLI agent）**

9. As a chat agent, I want 我启动的后台 Workflow 活过 turn 边界, so that 我能遵守本仓 E2E 铁律（多纬 subagent 编排）而不是被迫占满整轮同步跑。
10. As a chat agent, I want 下一轮 turn 收到后台任务的完成通知（而非"process exited"讣告）, so that 我能接续汇总产物。
11. As a chat agent, I want 任务被终止时收到结构化终态而不是无声消失, so that 我能如实向用户汇报并决定是否打捞。
12. As a chat agent, I want resume 后不重复付费重跑已完成的子 agent（至少：重复花费被显式暴露）, so that 中断恢复不是二次烧钱陷阱。

**维护者 / 生态**

13. As a 维护者, I want 任务生命周期帧在 ChatBackend seam 归一化成 provider-agnostic 事件, so that 未来 codex backend 能对等接入同一条可见性链路。
14. As a 维护者, I want `event-stream.md` 契约同步新增任务信封（身份、状态机、snapshot 语义）, so that 任何 CLI agent / 前端实现都能按文档对接。
15. As a 维护者, I want 所有 kill 点收敛到一个带 drain 检查的 chokepoint, so that 未来新增回收路径不会再各自为政地裸杀进程（本 PRD 数出 11 处就是教训）。
16. As a 维护者, I want 上游（claude CLI）帧形状与 ceiling 行为被 fixture 与探针测试钉住, so that Claude Code 版本升级造成的行为漂移能被 CI 抓到而非产线复发。

## Implementation Decisions

按依赖序六个模块（P0）+ 一个打捞件（P1）。核心架构判断：**任务状态是"可变的并发状态"，不是"append-only 的对话转写"**——所以走 registry + snapshot 事件模型（render 进度先例），不新造 chat StreamBlock kind；chat 流里已有的 tool_use chip 保持原样作为"启动的转写记录"。

1. **Spawn ceiling 配置（止血）**——ChatBackend 的 claude spawn env 注入 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`，值可经服务端配置覆盖。默认值在实现期实测后定夺：ceiling=0（无限等）会让 `result` 帧 hold 到后台任务收尾（事故日志证明 print-mode 语义如此），turn 将阻塞整个编排时长——需实测这对 chat UX 与 kill 路径的连锁影响，再在"高值 + drain-gate 兜底"与"0 + 交互语义调整"之间取舍。该决策及其实测证据落 ADR。
2. **任务生命周期归一化（ChatBackend seam 扩展）**——ChatStreamCallbacks 新增后台任务事件回调（started / progress / notification / terminal），保留任务 id、tool_use id 关联、描述、计数与用量字段；claude 后端从 stream-json 的任务类 system 帧翻译，**帧形状先抓真实 fixture 锁定再写解析**（repo 目前没有任何 Workflow stdout fixture）。codex 后端本期返回空实现。
3. **BackgroundTaskRegistry（server 深模块）**——每 chat session × 进程代际一份任务表；接口收敛为三个动词：`applyEvent`（同 id upsert + 状态机推进）、`snapshot`（供重连/查询）、`settleOnExit`（宿主进程退出时把所有仍 running 的任务合成 stopped/killed 终态并给出 reason）。纯逻辑、时钟可注入、不碰 I/O——单测隔离性最好的深模块。
4. **KillGate（drain 纪律 chokepoint）**——全部进程回收路径（新消息替换、killSession、断连 grace、TTL 清扫、backend/model 切换、daemon 退出）收敛过同一个"杀前问一句"的 gate：registry 报告有活任务时，按 cause 分级处理——可等待的 cause 走 drain/延迟，用户显式意图（/stop、删 work）走"杀 + settleOnExit + 广播终态"，绝不静默。
5. **`ui-workflow` 信封 + snapshot（bridge 契约扩展）**——新事件类型承载任务 upsert 与终态（身份 = sessionId + taskId；状态 = running/done/failed/stopped/killed），连接/重连时先发全量 snapshot 再增量推送（render 进度通道的既有模式）；**不复用 `ui-progress`**（无身份无并发无终态，toast-only by design）。契约文档同步更新，明确 same-id replace 语义与进程退出行为。
6. **Web 任务面板（chat 侧可见性）**——独立任务 store（Map keyed by sessionId+taskId，同 id 覆盖式 upsert），chat 面板渲染 durable 任务卡片（不是 2 秒 toast）；仅终态转换触发 toast；`session_killed`/`cli_exited` 不再只折叠成 streaming 布尔，联动卡片翻终态。
7. **Journal 打捞（P1）**——宿主进程死亡后，从 workflow journal 收割已完成 agent 的结果与进度，registry 标记 orphaned（generation-resilience 的 crashed/in-flight/orphaned lease 先例）；打捞只做可见性与止损，不做自动重跑。

明确的架构级决策：**本期不改 per-turn spawn 架构**。迁往长驻进程（stream-json input / Agent SDK）能根治整族问题，但牵动 ADR-005/ADR-013 的全部假设，独立成 ADR 议题（见 Out of Scope）。

## Testing Decisions

- **好测试只测外部行为**：registry 测"事件流进 → snapshot/终态出"，不测内部 Map；KillGate 测"有活任务时该 cause 是否放行/延迟/广播"，不测调用顺序；web store 测"同 id 两次到达渲染一条、状态覆盖"（031 AC 原文）。
- **测试先行 + fixture 先行**：seam 解析的预设测试以真实抓取的 stream-json fixture 驱动（先在真实环境跑一个最小 Workflow 抓帧存 fixture，证红后再写解析）；ceiling 行为写成探针式回归（对 stderr 签名断言），上游版本漂移时 CI 先红。
- **既有先例复用**（feedback_grep_existing_helper_first）：ws-bridge 的 spawn-mock 会话测试（ws-bridge-resume-prompt 模式）测 KillGate 与 settleOnExit；render 进度通道的 snapshot-then-push 测试形态套用到 `ui-workflow`；web 侧沿用 chat store 既有测试形态补 upsert 语义。
- **受测模块**：BackgroundTaskRegistry（最重）、KillGate、seam 归一化（fixture 驱动）、web 任务 store；journal 打捞用事故现场真实 journal 的脱敏副本作 fixture。
- **E2E 预设纬度清单**（实施后按清单派 Workflow 多纬 subagent，主 agent 不亲点浏览器）：① 用户路径纬度——chat 启动后台 workflow → 结束 turn → 发新消息 → 任务存活、下轮收到完成通知；② 呈现纬度——任务卡片出现/更新/翻终态，截图 + DOM textContent 二确；③ 失败纬度——显式 /stop 或删 work → stopped 卡片 + toast；④ 重连纬度——刷新页面后卡片状态经 snapshot 恢复；⑤ 驱动方纬度——agent CLI 视角与人 UI 视角对任务状态的读数一致。

## Out of Scope

- **长驻 agent 进程架构迁移**（stream-json input 模式 / Agent SDK 常驻会话）——根治方向但牵动 chat 全部生命周期假设，独立 ADR 议题，本 PRD 只留 registry/信封等不后悔件。
- **自动跨进程 resume / 任务接管**——registry 只登记 orphaned + 可 resume 线索；自动重跑涉及重复计费与幂等，另立。
- **codex backend 的对等任务可见性**——seam 接口本期就位，codex 帧翻译不做。
- **终端 `/workflows` 树视图的完整复刻**——本期只做卡片级（名称/阶段/计数/状态），不做逐 agent 树与 transcript 下钻。
- **GitHub Issue 自动同步**——#96/#97 的回填按用户单次要求已完成，不建自动化。

## Further Notes

- **上游依赖声明**：600s ceiling、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`、任务类 system 帧全部是 claude CLI（2.1.210 实测）的外部行为，AutoViral 源码零出现。所有依赖它们的实现必须 fixture/探针钉住 + 文档标注版本，升级回归风险由 CI 承担。
- **ceiling 与 drain 的联动风险**：只做止血不做 drain，等于把凶器从 CLI 手里换到 AutoViral 自己手里（11 处 kill 点接棒）；只做 drain 不做止血，600s 上限照样先开枪。两者是一个交付单元。
- **重复计费暴露**：事故实证 resume 会以新 agent ID 重跑已完成 agent。在打捞与终态广播里带上 usage/花费字段，让用户至少"看得见烧了多少"。
- **谱系**：030/031 是 PRD-0009"agent 工作面"家族的延续——上一代修的是 agent 够不着端点（B 系列），这一代修的是 agent 的工作方式（后台编排）在工位里活不下来、看不见。
