# Design

视觉系统的单一事实源是 `web/src/styles/tokens.css`（含 WCAG 修正注释）；本文件是给设计工作流读的快照式描述。冲突时以 tokens.css 为准。

## Theme

双主题平权：暗色是主场（创作工作室语境），亮色 paper-white 完整支持。`data-theme` 由 pre-paint inline script 在 first paint 前定型（防 FOUC）。

- **暗**：bg `#0a0b0f`（真中性，无暖 tint）+ 角落 ambient radial glow（蓝 0.05 / 紫 0.04）+ 全局噪点 overlay（opacity 0.035, mix-blend overlay）
- **亮**：bg `#fafaf7` paper-white

## Color

策略：**Restrained**——tinted 中性 + 单 accent，accent 只碰选中/主行动/状态。

| Token | 暗 | 亮 | 用途 |
|---|---|---|---|
| `--accent` | `#a8c5d6` cool steel | `#2a3a4a` deep ink | 主行动/选中 |
| `--accent-hi` / `-lo` / `-glow` | `#d6e4ee` / `#5a7a8c` / rgba(168,197,214,.3) | 对应亮档 | 高亮/次级/辉光 |
| `--surface-0/1/2` | rgba 半透明三档（.55/.7/.78） | 白系三档 | 面板层级 |
| `--glass-border` / `--glass-hi` | 白 7% / 12% | 墨 8% / 10% | 玻璃边 |
| `--text` / `-dim` / `-dimmer` / `-muted` | `#ecedf0` → `#82868d` 四档（全部过 AA，有回归测试） | 墨系四档 | 文字层级 |
| `--status-running/done/pending/error/warn` | 语义五色（warn amber 达 AAA） | 对应深档 | 状态，必须三重编码 |

## Typography

三族分工（这是品牌张力的主要来源）：

- **Inter**（`--font-sans`，ss01+cv11）：正文、UI 标签、按钮
- **Instrument Serif italic**（`--font-editorial`）：编辑大字标题、数字徽章（镜号类）——product UI 中唯一允许 display 字体的位置
- **JetBrains Mono**（`--font-mono`，zero+ss01）：eyebrow（10px/0.16em/uppercase）、数据徽章、状态标签

Product register：固定 rem 阶梯（非 fluid），比例紧（~1.2）。

## Shape & Depth

- 圆角四档：`--radius-sm 6 / -md 10 / -lg 16 / -xl 22`
- 玻璃：`backdrop-filter: blur(24px) saturate(140%)` + 1px `--glass-border` + 噪点——**只用于 chrome 层（modal/drawer/顶栏）**；高频重绘区（canvas、滚动列表）禁 backdrop-filter，用实色 `--surface-*` 替代
- 阴影克制：选中态用 `0 0 0 2px --accent-hi` ring 或 `0 0 12px --accent-glow`

## Motion

- 库：`motion/react`（AnimatePresence 已在用）
- 时长 150–250ms（product register），入场类 ≤320ms；缓动 `[0.32, 0.72, 0, 1]`（项目既有）或 ease-out-quart
- 既有关键帧：pulse-dot / slide-up / shimmer / spin
- 状态传达优先，无装饰性编排；`prefers-reduced-motion` 必须降级

## Components

- 按钮基线：pill（5px 11px / 11px / radius 7 / glass border / surface-0）——`.studio-shell` 全局兜底
- 滚动条：6px 细条，thumb `--glass-hi`
- 交互控件五态齐全（default/hover/focus-visible/active/disabled）
- react-flow 画布：默认样式（白色 Controls、点阵 Background、蓝色边）**禁止裸奔**，必须换成 token 化自绘 chrome；画布内交互控件必须带 `HIT_TARGET_CLASS + HIT_TARGET_STYLE`（nopan/nodrag 逃逸，见 `dive/nodes/hitTarget`）
