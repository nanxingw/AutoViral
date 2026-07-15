# boundary-probe — Studio 预览硬切边界保真回归夹具（PRD-0016 S1）

浏览器插桩探针 + 跑法文档。看守 12×4s 硬切夹具在预览里"跨切点单调播放"：切点不停（no stall）、不重放（no backward jump）、帧钟单调（monotonic clock）。既用于 PRD-0016 的**证红 / 转绿**，也是升 Remotion / 改 Player 配置时的回归网。

- 探针源码：[`boundary-probe.js`](./boundary-probe.js)（整段可注入）
- 根因与诊断陷阱：[docs/issues/032](../../docs/issues/032-preview-hardcut-stutter-replay.md)、[PRD-0016](../../docs/prd/0016-preview-hardcut-fidelity.md)

---

## 前置条件

1. **daemon 在跑**：`http://localhost:3271`（预构建 `web/dist`）。改过 `src/server`/`src/shared` 要先 `npm run build:backend` + 重启 daemon 再插桩（dist 进程启动即冻结）。
2. **夹具 work**：12×4s 背靠背硬切、无转场、CFR 24fps、in:0/out:4，前 48s 切点在 4/8/12…44s。参考 work id `w_20260715_0035_20d`（或按其 composition 形状新建等价夹具）。
3. **可见前台 tab（关键）**：探针必须在**前台可见**的 Chrome tab 里跑。遮挡 / 后台 tab 的 rAF 节流会把帧钟拖慢，诱发**与 bug 同形的假 ct 回拽**（032 诊断陷阱亲历）。用 `osascript -e 'tell application "Google Chrome" to activate'` 把窗口置前。
4. **E2E 纪律**：主 agent 绝不自己点浏览器判定；本夹具由**浏览器插桩 subagent** 执行（CLAUDE.md `<e2e>`）。

---

## 跑法（一段流程，非一次性手工）

### 0. 打开 Studio 该 work，等 Player 就绪

导航到 `http://localhost:3271/studio/<workId>`；等预览面板出现时码 `FRAME 00:00.00 / 00:48.00`（或对应总时长），且预览画布出现首帧（非 `LOADING…`）。

### 1. 注入探针

把 `boundary-probe.js` 整段内容通过 `javascript_tool`（或 DevTools console）执行。返回 `boundary-probe installed @ …` 即成功。暴露：

| 全局 | 作用 |
|---|---|
| `window.__probe` | 全部原始状态 |
| `window.__probeDrive` | `{ seek(sec), play(), pause(), mute(), unmute(), masterSec(), duration() }` |
| `window.__probeRun(opts)` | 自动跑 N 轮 seek→play→pause，返回 `Promise<{rounds,totalCrossings,needsGesture,aborted?}>` |
| `window.__probeReset(tag)` | 清空采样、保留媒体 hook（muted/unmuted 分段用） |
| `window.__probeSummary()` | 结构化判据汇总 |

**驱动是全脚本化的**（合成 pointerdown 走 Scrubber 精确 seek；`autoviral:ui-play/pause` window 事件走 Player）——唯一需要真鼠标的是**首次 play**（解锁 AudioContext / autoplay 策略）。

### 2. rAF 心跳门控（判定前必过）

```js
window.__probe.rafRate   // 读一次；等 ~1.5s 让心跳窗攒满
```

**`rafRate` 必须 ≥30 才允许判定。** <30 说明 tab 被节流（遮挡 / 后台）：先 `osascript activate` Chrome 置前台再读；仍 <30 则**如实返回 blocked，绝不在节流环境下判定**——那会产出与 bug 同形的假负跳。

### 3. 首次真实手势解锁

用**真实鼠标点击**预览下方的圆形 Play 按钮一次（`aria-label="Play"`），看画面动起来后再点一次 Pause。此后 AudioContext 已解锁，后续可全程脚本驱动。

### 4. 主跑：循环跨界 ≥20 次

```js
await window.__probeRun({ startSec: 3.2, endSec: 13.5, targetCrossings: 20 });
```

每轮 seek 到 3.2s → play → 播到 ~13.5s → pause（覆盖 4/8/12s 三个切点），累计跨界 ≥20 停。若返回 `aborted:true` 且 `reason` 含 "clock-not-advancing"，说明 autoplay 仍被挡——回第 3 步补一次真实手势。关键节点截图（seek 后、播放中跨切点、pause 后）。

### 5. 主从诊断（stall vs 回放）：muted / unmuted 各一跑

```js
// (a) 非静音
window.__probeReset("unmuted"); window.__probeDrive.unmute();
await window.__probeRun({ targetCrossings: 12 });
const unmuted = window.__probeSummary();

// (b) 全局静音
window.__probeReset("muted"); window.__probeDrive.mute();
await window.__probeRun({ targetCrossings: 12 });
const muted = window.__probeSummary();
```

**`mute()` 点的是 Remotion playerRef.mute() 的真按钮**——这才切换 `use-playback.js` 的 buffering-freeze 决策（未静音才冻结帧钟）；单独设 `el.muted` 不改 Remotion 内部 `mediaMuted`。比较两态下 `waitingCount` / `clockFreezeCount`（帧钟停滞）与 `backwardJumpCount`（回放）的分布即可判主从：
- 非静音 stall/freeze 显著、静音下消失 ⇒ **stall 是"未静音 buffering 冻结帧钟"主导**。
- 负跳在两态都在 ⇒ 回放机制（0.15s 纠偏赋值）与静音无关，是独立下游。

### 6. 收割

```js
JSON.stringify(window.__probeSummary(), null, 2)
```

---

## 判定标准（三断言）

当前实现（PRD-0016 修复前）**预期红**——下列至少一条 fail：

| 断言 | 绿条件 | 红信号 |
|---|---|---|
| ① 无 stall | `waitingCount === 0 && stalledCount === 0 && clockFreezeCount === 0` | 切点处 `waiting` 事件 / 帧钟冻结 >0 |
| ② 无回放 | `backwardJumpPlayerCount === 0` | 播放中的 Player 媒体 ct 负跳 >0.05s（`from>to`，非 seek 诱发） |
| ③ 帧钟单调 | `monotonicClock === true` | master frame clock 出现 >0.05s 后退 |

辅助：`mountToCanplay`（切点新 Player `<video>` 挂载→canplay 延迟分布）量化冷挂载代价；rAF 门控 `rafRateOk` 必须 true 否则判定作废。

### filmstrip 噪声隔离（真实重素材 work 必读）

真实 work 的 timeline filmstrip 会为**每个 clip 惰性挂载抽帧 `<video>`**（本夹具 work 实测 mediaTracked ≈ 247）。它们 `paused`、只 `seek` 取帧、从不 `play`，其抽帧 seek 会伪装成 ct 负跳、其加载会伪装成 waiting。探针据两点把它们剥离，判据只认 **Player 媒体**：

- **Player clip `<video>` 带 `#t=start,end` 媒体分片**（`meta.isFragment`），filmstrip 不带；
- **Player 媒体曾触发 `playing`**（`meta.everPlaying`），filmstrip 从不。

因此：`waitingCount`/`stalledCount` 只计 Player 媒体（`waitingAll`/`stalledAll` 保留原始含 filmstrip 计数供审计）；`backwardJumpCount` 只在 `!el.paused` 元素上判（自动排除 filmstrip），`backwardJumpPlayerCount` 再叠加 everPlaying 约束——**断言②以 `backwardJumpPlayerCount` 为准**。`master frame clock`（断言③）源自 DOM 时码，天然只反映 Player，filmstrip 免疫。

**通过标准（S2 转绿后）**：主跑 + muted/unmuted 两跑均 `waitingCount===0`、`backwardJumpCount===0`、`monotonicClock===true`。

---

## rAF 门控要求（硬性）

- 判定前 `window.__probe.rafRate ≥ 30`（`__probeSummary().rafRateOk === true`，要求 ≥70% 心跳样本 ≥30）。
- 不满足：`osascript -e 'tell application "Google Chrome" to activate'` 置前台重试；仍不满足返回 **blocked**，不出 fail/pass 结论。
- 依据：遮挡 tab 的 rAF 节流会诱发与 #98 同形的 ct 回拽假象（032 诊断陷阱）。`__probeSummary()` 会带回 `rafRateMin` / `rafSamples` 供审计门控是否真的生效。

## 已知陷阱

- 合成 pointerdown 会让 Scrubber 的 `setPointerCapture` 抛 `NotFoundError`——探针已临时 no-op 掉该方法再 seek。
- `use-playback.js:124-149` 的 AudioContext-resume 门控可能比 hidden-timeout 更早停钟；muted 跑可绕开（也正是主从诊断要对比的量）。
- master frame clock 从 DOM 时码 `FRAME MM:SS.ss` 解析（0.01s 分辨率、100ms 采样）——足够抓 >0.05s 后退，但亚帧级抖动不在其分辨率内（那由媒体元素 ct 负跳断言②覆盖）。
