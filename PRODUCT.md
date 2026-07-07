# Product

## Register

product

## Users

内容创作者（短视频 / 图文 / 海报），在 AutoViral 工作台中与 CLI agent 协作产出成片。两类驱动者共存且平权：**agent 经 `autoviral` CLI** 与 **人经 Studio UI**——两条路径的产出与呈现必须一致（这是产品命题核心，见 CONTEXT.md 不变量）。使用场景是长时间的创作会话：深色工作室环境、大屏、键鼠为主。

## Product Purpose

AI 原生的创作工作站：一个 agent 可编程操作的 NLE（视频时间线 / 图文画布 / 剧本分镜规划层）+ 生成管线（文生图 / i2v / TTS / BGM）+ 成本可观测。成功 = 创作者把 agent 当成真正的剪辑搭档，而不是一个只会吐文件的黑盒。

## Brand Personality

**editorial · 克制 · 现代质感** — 一个有视觉自信的创作者工作台。像顶尖编辑部 + 创意工作室共用的内部工具：排版果断、留白果断、信息密度按需切换；不依赖高饱和情绪刺激，靠类型对比和玻璃质感建立张力。

## Anti-references

- 高饱和情绪堆叠（spark-red dominance）
- 终端极客风（绿字黑底 hacker 味）
- 传统 CMS 后台密表格
- 库默认样式裸奔（react-flow / 浏览器默认控件直接出现在界面上）

## Design Principles

1. **Typography carries the brand** — Inter（正文）· Instrument Serif italic（编辑大字 / 数字徽章）· JetBrains Mono（labels / eyebrow / 数据徽章）三族分工，靠类型对比而非色彩堆叠建立张力。
2. **Restrained accent** — 单一 cool steel 主色（暗 #a8c5d6 / 亮 #2a3a4a）只用于当前选中、主行动、状态指示，不做装饰。
3. **Glass with discipline** — 玻璃质感（blur 24px + 1px 边 + 噪点）是 chrome 层语汇，不进高频重绘区域（canvas 内禁 backdrop-filter）。
4. **State is multi-encoded** — 状态永不只靠颜色：icon + 文字 + 色三重编码（E2E Hard rule 5 的产品化）。
5. **Agent-human parity** — 任何 UI 能力必须有 CLI 等价物，反之亦然；界面呈现的数据与 agent 看到的投影同源。

## Accessibility & Inclusion

- 正文对比 ≥4.5:1、大字 ≥3:1（repo 有 token-level WCAG contrast 回归测试锁死）。
- `prefers-reduced-motion` 必须有降级（crossfade / 瞬时）。
- 全键盘路径：modal focus trap（useModalFocus）、ESC 关闭、aria-label/aria-expanded 完整。
- 暗 / 亮双主题平权，theme 由 pre-paint inline script 定型防 FOUC。
