# AutoViral

## Skill 结构规范

整个创作能力封装成**一个** skill：`skills/autoviral/`。它不是一条流水线，而是一组可从任意起点切入的正交能力。

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
