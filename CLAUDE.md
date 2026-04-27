# AutoViral

## Skill 结构规范

整个创作能力封装成**一个** skill：`skills/autoviral/`。它不是强制顺序的流程，而是一组可从任意起点切入的正交能力。

```
skills/autoviral/
  SKILL.md            # 主入口
  taste/              # 品味与判断（内化读物，7 份）
  modules/            # 正交能力（4 个）
    research/         # 事实与参考收集
    planning/         # 情感意图 → 可执行 brief
    assets/           # 图/视频/音乐/海报生成
    assembly/         # 剪辑/字幕/混音/节拍对齐
  references/         # 跨模块契约与索引
```

核心原则：

- **一个 skill，四个模块**——不再有 "research → plan → assets → assembly" 的强制顺序
- **`taste/` 是灵魂**（内容质量 > 平台），`modules/` 是术（工具/脚本/API）
- **任意起点**：用户可以从任何模块切入，缺上下文就反问具体问题（优先问情感意图）
- **每个模块的 `capabilities/` 子目录**放扩展能力文档，`scripts/` 放脚本，`references/` 放平台技术规格
- **平台创作建议不进 taste**——平台只作为技术约束（aspect ratio / duration / safe zone）存在

详细规则见：[docs/skill-structure-guide.md](docs/skill-structure-guide.md)


<rules>
启动subagents模式时，所有subagents必须使用Opus模型驱动。
不要随便push代码，但可以commit保证记录
在构建和重构skill时，必须确保自己阅读过https://github.com/obra/superpowers，https://github.com/garrytan/gstack等业界权威skill，对怎么构建skill了如指掌。
</rules>

### Aesthetic Direction
- **调性**：editorial · cool · glass。暗色 #0a0b0f 真中性 / 亮色 #fafaf7 paper-white；噪点 overlay (mix-blend-mode: overlay, opacity 0.035)
- **主色**：`--accent: #a8c5d6`（暗色 cool steel）/ `#2a3a4a`（亮色 deep ink），`--accent-hi`/`-lo`/`-glow` 完整四档
- **字体**：`Inter`（正文，font-feature ss01/cv11）· `Instrument Serif italic`（编辑大字 / 数字徽章）· `JetBrains Mono`（labels / eyebrow / 数据徽章）
- **圆角**：`--radius-sm 6px / --radius-md 10px / --radius-lg 16px / --radius-xl 22px` 四档
- **玻璃**：`backdrop-filter: blur(24px) saturate(140%)` + 1px `--glass-border` + 噪点叠加
- **动画**：pulse-dot · slide-up · shimmer · spin；保持克制（200-400ms）
- **反面参考**：避免高饱和情绪堆叠（spark-red dominance）、avoid 终端极客风、avoid 传统 CMS 后台密表格

### Brand Personality
**editorial · 克制 · 现代质感** — 一个有视觉自信的创作者工作台。像顶尖编辑部 + 创意工作室共用的内部工具：排版果断、留白果断、信息密度按需切换；不依赖高饱和情绪刺激，靠类型对比和玻璃质感建立张力。
