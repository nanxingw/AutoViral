---
name: viral-archetypes
description: Use when planning a video/图文 work and you need to identify which viral pattern fits the emotional intent. Each archetype has its own prompt template, shot grammar, and proven case library. Reference, not rigid — but scanning this BEFORE writing prompts helps you avoid generic AI default output. Skip and you produce content that's "technically correct but no one shares".
type: capability
priority: flexible
sources:
  - https://www.acceptprompt.com/blog/ai-video-prompts (10 viral prompt analysis)
  - https://godofprompt.ai/blog/sora-2-viral-video-prompts
  - https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts
  - taste/01-emotional-storytelling.md (autoviral 内化叙事原则)
---

# Viral Archetypes — 4 大病毒级原型

业界实证：能做到病毒级传播（>10M 播放）的短视频/图文，prompt 几乎都落在这 4 个原型之一。**不是凑巧**——它们各自命中了人类大脑最古老的 4 种情感反应：**视觉愉悦** / **共情共鸣** / **肾上腺素** / **意外笑点**。

> 这份文档不是"创作公式"——viral 不能保证。但**不在这 4 类里的内容很难病毒化**，所以选题前先扫一遍：你想做的内容能映射到哪个原型？映射不上 → 大概率只能做"小而美"，不会爆。

---

## 0. 4 大原型一览

| 原型 | 触发情感 | 核心机制 | 平均时长 | 适合 |
|---|---|---|---|---|
| **① Satisfaction Transformation**（满足感转化）| 视觉愉悦 + Awe | 从"瑕疵/枯死"到"完美/盛开"的强烈视觉对比 | 8-15s | 视觉系账号、生活美学、ASMR 系 |
| **② Emotional Narrative Hook**（情感叙事钩子）| 共情 + 怀旧 | "某个瞬间值得被记住"+ 旁白触发回忆 | 12-20s | 故事系账号、情感号、品牌广告 |
| **③ High-Energy Action**（高能量动作）| 肾上腺素 | 慢动作 + 极致角度 + 关键瞬间 freeze | 6-10s | 体育、动作、特技、表演系 |
| **④ Comedic Absurdity**（喜剧荒诞）| 意外笑点 | 反差设定（严肃形式 + 荒谬主体） | 8-15s | 喜剧、表情包系、二次创作 |

---

## ① Satisfaction Transformation — 满足感转化

### 1.1 触发机制

人脑奖励系统对"**完成 / 修复 / 完美对齐**"的视觉刺激有强烈反应——这是 ASMR / 时间流逝 / 整理收纳类内容的底层。

观众的潜台词："**啊，舒服了。**"

### 1.2 核心 prompt 模式

```
[起点：瑕疵/不完美/枯死状态] 
→ [转化触发：光照变化 / 时间流逝 / 介入] 
→ [过程：渐进式视觉转变（必须是连续的，不能跳）] 
→ [终点：完美/盛开/对齐状态]
+ Closing: 高对比色彩转变描述 + satisfying / awe-inspiring mood
```

### 1.3 真实可运行 prompt（直接套）

**Case A · 枯墙绽放（来源：业界 viral 案例）**
```
[0s] Medium shot: A barren grey concrete wall in an urban alley, 
crumbling at the edges. Camera is static, eye-level, framed dead-center. 
Cool overcast diffuse light at 6500K.

[2s] Warm sunlight breaks through clouds and hits the wall's center. 
The grey concrete wall begins sprouting green moss outward in 
time-lapse acceleration.

[4s] Vines and ivy unfurl across the grey concrete wall surface, 
reaching the edges.

[6s] Wildflowers bloom across the entire surface — vibrant yellow, 
pink, white, purple — in rapid time-lapse.

[8s] Camera slowly pulls back, revealing the entire vertical garden. 
A single bee enters frame.

Time-lapse 8s clip, sharp focus, dramatic color shift from desaturated 
grey to fully saturated bloom, solarpunk aesthetic, awe-inspiring 
satisfying mood, shot on RED Komodo with macro lens, no grain.

Negative: no jump cuts, no flickering, no distortion, no text, 
no people in frame.
```

**Case B · 整理一团乱床铺**
```
[0s] Wide shot top-down: A messy unmade bed — duvet bunched, pillows 
scattered, clothes piled. Static camera. Cool morning daylight at 
5500K through unseen window.

[2s] Time-lapse acceleration: Two pairs of hands enter from frame edges 
and begin smoothing the duvet.

[4s] Pillows are fluffed and aligned in geometric symmetry. Clothes 
fold and stack themselves in stop-motion-like rhythm.

[6s] Final smoothing pass. Hands exit frame. Duvet creases tighten.

[8s] Static hold on the perfectly made bed — corners crisp, pillows 
aligned, single decorative throw pillow placed at 30°.

Time-lapse 8s clip, sharp focus, clean Scandinavian minimalist palette 
(white, oat, pale wood), satisfying ASMR-like mood, shot on Sony FX3, 
no grain, no music overlay needed.

Negative: no distortion, no time skip, no clutter remaining.
```

**Case C · 墙面修复（碎裂 → 完整）**
```
[0s] Close-up macro: A cracked white plaster wall, deep fissures 
running through it. Camera is static, eye-level. Side-lit by single 
warm 3000K key from camera-left, hard shadows revealing depth.

[2s] Cracks slowly fill in with fresh wet plaster, time-lapse, 
rippling like liquid finding its level.

[4s] Surface smooths into perfect matte finish. Last crack fills 
from corner inward.

[6s] A single sunbeam moves across the now-perfect wall, lighting 
microtexture.

[8s] Camera slowly pulls back, revealing the wall is actually a small 
section of a vast restored cathedral interior.

Cinematic 8s clip, restoration documentary aesthetic, fine grain, 
warm restoration palette (cream plaster, golden lamp, deep wood 
shadows), reverent and satisfying mood, shot on ARRI Alexa Mini.

Negative: no jump cuts, no people in frame, no distortion.
```

### 1.4 拍摄/生成自检

- ☐ 起点和终点的视觉差**足够大**（灰色 → 饱和；混乱 → 几何；破损 → 完整）
- ☐ 转化过程**连续**（time-lapse / 渐进），不能跳切
- ☐ 没有人脸抢戏（满足感原型主体应该是**物件/环境**）
- ☐ 末尾有 1-2 秒"成品 hold"，让观众回味
- ☐ 配 ASMR 音效（生长声 / 摩擦声 / 完成 ding）

---

## ② Emotional Narrative Hook — 情感叙事钩子

### 2.1 触发机制

人脑对**叙事 + 共情**的反应远强于"信息"。观众的潜台词："**啊，我也想起 XX 了。**"——这才是引发分享的核心。

### 2.2 核心 prompt 模式

```
[场景锚点：能触发集体记忆的具体物件/场景] 
+ [人物：年龄/状态能让观众投射的身份] 
+ [慢节奏单一动作：手指轻抚 / 眼神远望 / 缓慢翻页] 
+ [Voiceover：能击中"我也曾……"句式，押韵或诗意，≤2 句]
+ Closing: warm + nostalgic + 暖光 + 浅景深 + slow push-in
```

### 2.3 真实可运行 prompt

**Case A · 祖母翻相册（业界标杆 viral）**
```
[0s] Medium shot: A grandmother's hands gently hold a worn leather 
photo album resting on her lap. The grandmother sits in a sunlit 
armchair, frame composition cuts off her face above the eyes. Camera 
is static, eye-level.

[2s] Her wrinkled fingers slowly trace each face on the open page. 
Voiceover (warm female, 60s): "Some moments never really leave us."

[5s] She turns the page. A single faded photograph slips out.

[7s] Voiceover continues: "They just wait quietly, until we're ready 
to remember." She picks up the photo with both hands.

[8s] Slow push-in to the photograph in her hands — a young couple 
on a beach, decades ago.

Cinematic 8s clip, warm Kodak Gold 200 emulation with soft halation, 
fine grain, golden afternoon light at 3000K through unseen lace 
curtain, Morandi warm palette, deeply nostalgic mood, shot on Sony 
Venice with 85mm at f/2.

Negative: no on-camera dialogue, no upbeat music, no fast cuts, 
no distortion.
```

**Case B · 父亲送女儿到大学**
```
[0s] Medium shot from behind: A middle-aged father stands at the 
open trunk of a sedan, lifting out the last cardboard box marked 
"books". His daughter, 18, in a college sweatshirt, watches from 
beside him. Static camera. Soft morning light at 4500K.

[3s] He sets the box down. Pauses. Hand lingers on the lid. 
Voiceover (warm male, 50s, slight crack): "I packed this one extra 
careful."

[6s] He turns. The middle-aged father pulls his daughter into a hug. 
Her face presses into his shoulder. Camera holds — neither moves for 
two seconds.

[10s] He releases. Smiles, blinks fast. Hands her a folded note.

[12s] Static hold on her opening the note in her palm — single line 
of handwriting, blurred to suggest letter contents are private.

Cinematic 12s clip, Kodak Vision3 250D emulation, fine grain, 
warm September morning palette (beige sweatshirt, dusty rose sky, 
weathered car paint), bittersweet mood, shot on ARRI Alexa Mini 
with 50mm at f/2.

Negative: no on-camera spoken dialogue between characters, no upbeat 
music, no jump cuts.
```

**Case C · 老厨师最后一晚**
```
[0s] Wide shot: An empty restaurant after closing — chairs upturned 
on tables, single light over the kitchen pass. An elderly chef in 
white coat stands alone at the pass, slowly untying his apron. 
Static camera. Warm tungsten 2700K key.

[3s] Medium close-up: The elderly chef folds the apron into a precise 
square. Voiceover (warm male, 70s): "Forty-two years."

[6s] He sets the apron on the pass. His hand stays on it for a moment.

[9s] Voiceover: "Every plate was for someone who walked in tired."

[12s] He turns off the pass light. Restaurant goes dark except for 
a single candle on a far table.

[15s] Static hold on his silhouette at the kitchen door, hand on 
the frame, looking back once.

Cinematic 15s clip, fine 35mm grain, deep warm chiaroscuro palette 
(amber tungsten, deep shadow, cream apron), reverent and tender mood, 
shot on Sony Venice with 35mm Cooke S4 at f/2.

Negative: no fast cuts, no on-camera dialogue, no music with vocals.
```

### 2.4 拍摄/生成自检

- ☐ 场景物件能触发集体记忆（旧相册 / 宿舍门 / 厨房围裙 / 老火车票…）
- ☐ 人物年龄/状态让大多数观众能投射（祖辈 / 父辈 / 自己）
- ☐ Voiceover 是"诗意短句"，不是"信息陈述"
- ☐ 节奏**慢**（每个 beat 至少 2-3 秒）
- ☐ 不要用纯音乐 BGM 抢戏，voiceover 优先

---

## ③ High-Energy Action — 高能量动作

### 3.1 触发机制

肾上腺素 + 视觉震撼。观众潜台词："**卧槽。**"

### 3.2 核心 prompt 模式

```
[极端角度起手（极低/极高/极近）] 
+ [快速运镜（rocket up / whip pan / 急冲）] 
+ [慢动作关键瞬间] 
+ [音画 punctuation（球进框/拳击中/水花炸开）]
+ Closing: cinematic + slow-mo + high contrast + 4K
```

### 3.3 真实可运行 prompt

**Case A · 罚球决胜（业界标杆）**
```
[0s] Extreme low-angle close-up: A professional basketball player's 
sneakers approach the free-throw line. Camera is at floor level, 
shoes fill the frame. Sweat drips visible on the wood.

[2s] Camera rockets upward at high speed, revealing the packed arena 
— thousands of fans on their feet behind the player. Crowd roar 
swells.

[4s] Slow-motion: The ball leaves the player's fingertips, rotating 
backward. Time stretches. Camera switches to behind-ball POV tracking 
its arc.

[6s] Ball passes through the rim — clean swish. Net snaps.

[7s] Hard cut to wide: Arena explodes. Crowd jumps. Confetti falls.

[8s] Static hold on the player's face — eyes closed, single tear 
catching the light.

Cinematic 8s clip, hyper-real motion, anamorphic 2.39:1 frame, 
crushed teal-and-amber color grade with bright key on player, 
adrenaline and triumph mood, shot on Phantom high-speed for slow-mo 
sections, ARRI Alexa for wide.

Negative: no shaky low-quality, no distortion, no extra fingers, 
no subtitles.
```

**Case B · 越野赛车涉水（业界标杆）**
```
[0s] Wide tracking shot, low angle: A low-slung off-road buggy 
approaches a wide shallow river crossing at incredible speed through 
a forest stage. Camera mounted on a chase rig, mud splattered on lens.

[2s] The off-road buggy hits the water. Massive sheet of muddy water 
erupts upward, completely engulfing the buggy.

[4s] Slow-motion expansion: Water sheet hangs in air, droplets 
suspended. Sun catches each droplet.

[5s] Time resumes. Buggy emerges from the spray, water cascading off 
its roll cage.

[7s] Hard cut to in-cab POV: Driver grins, mud-covered visor lifts.

[8s] Static low-angle: Buggy roars past camera and exits frame right.

Cinematic 8s clip, found-footage rally aesthetic, handheld with 
deliberate shake, fine grain, saturated forest greens contrasted with 
muddy ochre water, raw and visceral mood, shot on Sony Venice 
high-speed mode.

Negative: no smooth tripod feel, no extra fingers, no clean lens 
(want mud), no slow build — start at speed.
```

**Case C · 拳击命中关键一击**
```
[0s] Medium close-up: Two boxers circling in a ring. Camera tracks 
laterally, matching their footwork. Hard top-down ring lights at 
5500K creating chiaroscuro shadows.

[2s] Boxer A throws a feint left jab. Boxer B leans back. Camera 
position shifts to over Boxer A's shoulder.

[3s] Slow-motion: Boxer A's right hook starts. Camera switches to 
extreme close-up on the fist's trajectory, sweat trail visible.

[5s] Fist makes contact with Boxer B's jaw. Sweat sprays in a slow 
arc. Mouth guard pops half out.

[6s] Time resumes. Boxer B falls back. Crowd around the ring jumps.

[8s] Static low-angle: Boxer A stands over fallen opponent, gloves 
raised.

Cinematic 8s clip, anamorphic 2.39:1, deep contrast film noir grade 
(crushed blacks, hot highlights), visceral and brutal mood, shot on 
ARRI Alexa Mini with high-speed for slow-mo, anamorphic flare from 
ring lights.

Negative: no distortion, no extra fingers, no smooth motion (need 
visceral impact).
```

### 3.4 拍摄/生成自检

- ☐ **起手是极端角度**（极低 / 极高 / 极近 / 反向）
- ☐ 至少有 1 个慢动作关键瞬间
- ☐ 关键瞬间被音画 punctuation 标记（drop / cut / boom）
- ☐ 不超过 1-2 个主导动作（多了观众抓不住）
- ☐ 末尾有 1 秒"胜利 freeze"或"未完成感"

---

## ④ Comedic Absurdity — 喜剧荒诞

### 4.1 触发机制

把**严肃的视觉/听觉形式**用在**荒谬的主体**上。观众潜台词："**这什么鬼，再看一遍。**"——再看 = 完播率高 = 算法推。

### 4.2 核心 prompt 模式

```
[严肃形式的视觉 setup（film noir / 法庭 / 商务会议 / 纪录片）]
+ [荒谬的主体（鸭子 / 婴儿 / 动物 / 物品当作人类）]
+ [一切其他元素都按严肃形式来处理 — 这是笑点核心]
+ [反差落点 — 让观众确认这不是错觉]
+ Closing: 严肃形式的标准美学（不要因为是搞笑就降低制作感）
```

**铁律**：荒诞 = **形式严肃 × 主体荒谬**。如果连形式都跟着搞笑（比如加滑稽配乐 / 卡通字体），笑点会被稀释。**保持形式严肃**才是 viral 关键。

### 4.3 真实可运行 prompt

**Case A · 警察审橡皮鸭（业界标杆）**
```
[0s] Medium close-up: A grizzled detective in a brown trench coat 
sits across a metal interrogation table from a small yellow rubber 
duck. Camera is static, eye-level on the detective. Hard top-down 
film noir key light at 3000K, deep shadows.

[3s] The grizzled detective in the brown trench coat sternly asks, 
"Where were you on the night of the bubble bath?" His face leans 
forward into the light.

[5s] Cut to extreme close-up of the small yellow rubber duck. It 
emits a single nervous squeak.

[7s] Cut back. The grizzled detective in the brown trench coat 
slams his notepad shut. Frame holds on his deadpan stare.

8s clip, fine grain, high-contrast film noir black and white with 
warm amber accent on key light, deadpan absurd mood, shot on ARRI 
Alexa Mini, 50mm prime.

Negative: no comedic music, no cartoon style, no laughter track, 
no distortion.
```

**Case B · 婴儿主持商务会议**
```
[0s] Wide corporate boardroom shot: A polished mahogany conference 
table. At the head, a 14-month-old toddler stands on a high chair 
in a tiny tailored suit, gripping a marker. Six adult executives in 
business attire sit around the table, leaning forward attentively. 
Camera is static, framed dead-center on the toddler. Cool corporate 
overhead fluorescents at 5500K.

[3s] The toddler turns to a whiteboard behind them, draws a single 
random scribble. Then turns back to the executives. The toddler 
points at the scribble with the marker authoritatively.

[6s] The executives nod gravely. One starts typing notes on a laptop. 
Another adjusts glasses, leans in.

[9s] The toddler claps once. The executives applaud politely.

[12s] Static wide hold. The toddler reaches for a glass of water on 
the table — knocks it over. The executives instantly clap harder.

Cinematic 12s clip, corporate documentary aesthetic, sharp focus, 
neutral office palette (mahogany, navy, white), deadpan straight-faced 
mood, shot on Sony FX3 with 35mm prime at f/4.

Negative: no comedic sound effects, no laughter, no exaggerated 
expressions on adults — they must take it 100% seriously, no cartoon.
```

**Case C · 企鹅健身教练**
```
[0s] Medium shot: A bright commercial gym, mirror walls, racks of 
weights. In the center, a king penguin stands beside a barbell loaded 
with two small plates. Three middle-aged humans in workout gear 
stand in a row in front of the penguin, attentive. Camera is static. 
Bright daylight LEDs at 5500K.

[3s] The king penguin demonstrates a deadlift form by waddling 
forward and waddling back beside the barbell. The three middle-aged 
humans nod and mirror the movement.

[7s] Cut to one human attempting a deadlift. The king penguin tilts 
its head observationally, then flippers a corrective tap on the 
human's shoulder.

[10s] The human adjusts form. The king penguin gives an approving 
beak nod.

[12s] Static wide hold: All three humans deadlift in unison while 
the king penguin walks down the line inspecting them with serious 
intent.

Cinematic 12s clip, gym fitness documentary aesthetic, sharp focus, 
clean bright commercial palette, deadpan absurd mood, shot on Canon 
C70 with 24-70mm at f/4.

Negative: no comedic music, no laugh track, no anthropomorphizing 
the penguin's facial expression beyond natural, no cartoon.
```

### 4.4 拍摄/生成自检

- ☐ **形式严肃**（film noir / 法庭 / 纪录片 / 商务会议 / 学术讲座）
- ☐ **主体荒谬**（动物当人 / 婴儿当成人 / 物品当主角）
- ☐ **画面里所有人/物都 100% 严肃对待**——一个角色破功，全场塌
- ☐ **不要**加搞笑音效、罐头笑声、卡通风格
- ☐ 落点是反差确认（让观众"再看一遍确认我没看错"）

---

## 跨原型组合（高阶）

最强的 viral 内容经常**跨两个原型**：

| 组合 | 案例 |
|---|---|
| ② + ① | 老人翻完相册，时间流逝把照片中的人物在画面中"复活"——情感叙事 + 满足感转化 |
| ① + ④ | 墙面修复时刷出一张笑脸——满足感 + 喜剧荒诞 |
| ③ + ④ | 严肃格斗形式但对手是吉娃娃——高能量 + 喜剧荒诞 |
| ② + ③ | 父亲送女儿大学的同时穿插他自己年轻时奔跑去赶火车的慢动作——情感叙事 + 高能量 |

---

## 为什么不在这 4 类里？

如果你想做的内容**映射不上**任何原型，回到 `taste/00-prime-directive.md` 重新问情感意图——大概率是意图模糊。常见的"映射不上"陷阱：

- "教用户做某件事" → 缺乏情感钩子，是 utility，不是 viral
- "展示我的产品" → 商业宣传，不是 viral
- "讲我的故事" → 太自我，缺乏观众投射点
- "好看" → 模糊判断，没情感锚

修法：把这些重新表述成 4 原型之一。"教用户做菜"→ ① 满足感转化（食材到完成菜的转变）。"展示产品"→ ② 情感叙事钩子（产品在某个时刻陪伴某人）。"讲我的故事"→ ② + 投射点。

---

## See also

- `taste/01-emotional-storytelling.md` — 叙事弧的道
- `taste/05-creative-schema.md` — 情感意图 → 决策语言
- `video-prompt-narrative.md` — Seedance 2.0 timeline 协议（这份的视频实现）
- `image-prompt-narrative.md` — 单帧图像的实现
- `keyword-library.md` — 关键词分类索引
