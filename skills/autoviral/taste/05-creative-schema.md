---
name: creative-schema
description: 从情感意图出发的生产决策 schema——给定意图自动映射到镜头、节奏、排版
type: taste
---

# Creative Schema

## 这份文件是什么

一个**决策语言**。让 agent 把"用户想要什么"翻译成"生产参数"。

给定：创作目标 + 情感意图 + 体裁 → 输出：具体的镜头、节奏、排版选择。

这是 `taste/01-04` 的**可执行索引**。当你要做决策时，先查这里，再回到各自领域文件。

## 决策 Schema

```json
{
  "creative_goal":
    "stop_scroll | educate | sell | inspire | entertain | build_trust | provoke_thought",

  "emotional_intent":
    "curiosity | urgency | awe | warmth | desire | humor | tension | melancholy | pride | irony",

  "format":
    "vertical_video_9x16 | square_video_1x1 | horizontal_video_16x9 | carousel | single_image",

  "duration_band":
    "micro_3to7s | short_8to15s | medium_16to30s | extended_31to60s | longform_60plus",

  "hook_type":
    "visual_shock | counter_intuitive | bold_claim | question | before_after | scenario | identity",

  "arc_type":
    "classic_5act | hook_and_payoff | reversal | parallel | beat_driven | documentary | emotional_slope",

  "cinematography": {
    "shot_mix": "wide_heavy | close_heavy | dynamic_range | extreme_contrast",
    "primary_angle": "eye_level | low | high | top_down | dutch",
    "movement_profile": "mostly_static | slow_push | tracking | handheld | cinematic_mix",
    "composition_bias": "rule_of_thirds | symmetry | leading_lines | negative_space | frame_in_frame"
  },

  "editing": {
    "avg_shot_length_sec": "< 1 | 1-2 | 2-4 | 4-8 | 8+",
    "cut_styles": ["straight", "match", "jump", "smash", "cross", "J_cut", "L_cut"],
    "transition_use": "none | minimal | musical_sync | stylized",
    "rhythm_curve": "steady | crescendo | wave | plateau_drop"
  },

  "design": {
    "hierarchy_strength": "strong | medium | weak",
    "color_palette": "warm | cool | neutral | high_saturation | muted_earth",
    "typography_mood": "authoritative_serif | modern_sans | warm_rounded | bold_display | vintage",
    "text_density": "title_only | title_plus_sub | narrative_overlay | infographic"
  },

  "audio": {
    "music_energy": "silent | ambient | mid | driving | dramatic",
    "sound_design": "minimal | emphasized | layered",
    "voice_role": "none | voiceover | on_camera_sync | character_driven"
  }
}
```

## 意图 → 参数建议（核心映射表）

给定 `emotional_intent`，优先选择：

### curiosity（好奇）
- hook_type: `counter_intuitive` / `question`
- cinematography: shot_mix `close_heavy`, movement `slow_push`, composition `negative_space`
- editing: avg 2-4s, cut `match` + `straight`, rhythm `plateau_drop`
- design: color `neutral`, typography `modern_sans`, text `title_only`
- audio: music `ambient → mid`, sound `emphasized`

### urgency（紧迫）
- hook_type: `bold_claim` / `visual_shock`
- cinematography: shot_mix `close_heavy`, movement `handheld`, composition `leading_lines`
- editing: avg < 1s, cut `jump` + `smash`, rhythm `crescendo`
- design: color `warm` (红/橙), typography `bold_display`, text `title_plus_sub`
- audio: music `driving`, sound `layered`

### awe（敬畏）
- hook_type: `visual_shock`
- cinematography: shot_mix `wide_heavy`, angle `low` / `top_down`, movement `cinematic_mix` (slow push + drone)
- editing: avg 8+s, cut `straight` + `match`, rhythm `steady`
- design: color `neutral`, typography `authoritative_serif`, text `title_only`
- audio: music `dramatic`, voice `none` or sparse voiceover

### warmth（温暖）
- hook_type: `scenario`
- cinematography: shot_mix `close_heavy`, angle `eye_level`, movement `mostly_static` + micro push, composition `rule_of_thirds`
- editing: avg 3-6s, cut `straight` + `L_cut`, rhythm `wave`
- design: color `muted_earth`, typography `warm_rounded`
- audio: music `ambient`, voice `voiceover` (轻声)

### humor（幽默）
- hook_type: `scenario` / `counter_intuitive`
- cinematography: shot_mix `dynamic_range`, angle `eye_level`（笑点时可突变）
- editing: avg 1-2s, cut `jump` + `smash`, rhythm `plateau_drop`（笑点前停顿）
- design: color 可以高饱和，typography `bold_display`
- audio: music `mid`, sound `emphasized`（punchline 音效）

### tension（紧张/悬念）
- hook_type: `question`
- cinematography: shot_mix `extreme_contrast`（远近剧烈切换）, angle `dutch` 用一次
- editing: avg 变速，cut `cross` + `smash`, rhythm `crescendo`
- design: color `cool` (深蓝绿), typography `authoritative_serif`
- audio: music `dramatic`, sound `layered`

### melancholy（忧伤）
- hook_type: `scenario`
- cinematography: shot_mix `wide_heavy`, movement `mostly_static`, composition `negative_space`
- editing: avg 6-10s, cut `straight`, rhythm `steady`
- design: color `muted_earth` / `cool`, typography `authoritative_serif`
- audio: music `ambient` (钢琴/弦乐), voice minimal

### pride（自豪/荣耀）
- hook_type: `before_after`
- cinematography: angle `low`, movement `slow push` 或 crane
- editing: avg 2-4s, rhythm `crescendo`
- design: color `warm`, typography `bold_display`
- audio: music `driving` → `dramatic`

### irony（讽刺/反差）
- hook_type: `counter_intuitive`
- arc_type: `reversal`
- editing: 先建立期待节奏 → 一刀 `smash` 打破
- design: 风格故意做得"像行货"然后被打破，或极度克制
- audio: 期待音乐 → 停止 / 反差音乐

## 使用这份 Schema 的方式

1. **开工前**：用户说"帮我做个 X"。agent 根据上下文填出 `creative_goal` + `emotional_intent` + `format`，**把填好的 JSON 片段展示给用户**，问："我这样理解你的意图对吗？"
2. **不确定时**：把不确定的字段留空，问用户一个具体问题定下来。**不要默默猜满**所有字段。
3. **生产时**：后续的 `modules/assets/` 和 `modules/assembly/` prompt 直接用这些字段作为生产参数。
4. **评审时**：用 `taste/06-rubric.md` 检查产出是否真的对应了这些字段。

## Schema 的扩展原则

- **新情感**：如果用户描述了上面没覆盖的情感（比如"荒诞"、"冷感"），允许新增，但**必须先补它的参数映射**再用。
- **不要随意合并**：相近的情感（好奇 vs 兴趣 vs 求知）有细微但重要的差别，不要懒得分。
- **以情感为锚**，不以体裁为锚：不要建"美食视频 schema"——美食也可以是 warmth / humor / awe，应该按情感决定，不是按体裁。
