---
name: assets-filter-retries
description: 用于生成脚本（jimeng / openrouter / dreamina CLI）返回内容审核 / 图像分类器失败信封时——例如 "image2video 报 partner_validation_failed"、"gpt-5.4-image-2 返 content_policy_violation"、"422 Output audio has sensitive content"、"jimeng 任务 failed 含敏感词"。给出 signature → recovery 决策树。不用于：API 限流（fallback-strategy.md §2）、网络/超时（直接重试）、参数非法（查 -h）。
---

# 内容审核失败签名 → 恢复决策树

本文档是 `fallback-strategy.md §1`（"内容安全审核被拒"）的**战术下钻层**——把"改 prompt → 换模型 → 告知用户"这条降级链落到具体的错误信封识别上。当生成脚本以非零退出 + JSON 错误信封返回时，agent 先在这里**匹配签名**，再决定该执行哪一步恢复动作；只有当本文档列出的所有签名都不匹配、或恢复都失败后，才升级到 fallback-strategy.md 的告知用户分支。

判断口径：**先看错误来自哪一层**（image classifier / prompt safety / output audio classifier / 平台账户授权），再看恢复手段是改输入图、改 prompt、改 flag 还是人工介入。**永远不要静默重发同一条命令**——每次重试至少改动一个输入。

---

## 三家 provider 的失败渠道

| Provider | 脚本 / 工具 | Surface 的错误信息 | 完整信封可见性 |
|---|---|---|---|
| **dreamina CLI**（Seedance 2.0/3.0） | `dreamina image2video / text2video / ...` | CLI 直接打印 fal.run / 火山 API 响应 body 到 stderr | **完整可见**（最易匹配） |
| **OpenRouter**（`gpt-5.4-image-2` 生图、`google/lyria-*` 生乐） | `openrouter_generate.py` | `RuntimeError("API 错误 {status}: {resp.text[:500]}")`（L303-304）+ `data['error'].message`（L309-310） | **截断到 500 字符**——大多数情况够用，envelope 末段的 `details` 字段可能被截 |
| **jimeng**（火山 Visual API 视频） | `jimeng_generate.py` | `RuntimeError("提交失败: {data['message']}")`（L188）+ `RuntimeError("任务失败: {data['data'].message}")`（L215-217） | **仅 message 字段**——无完整 envelope，只能按 message 关键词模糊匹配 |

> 这意味着 dreamina 的签名可以做精确 token 匹配（pneuma 范本直接迁移）；OpenRouter 大多数情况够用但有边界；jimeng 必须靠中文 message 关键字（**fixture 待补**）。

---

## Signature A — dreamina/Seedance image-side 拒绝

**What you see**（fal.run 直通响应，dreamina CLI 不预处理）：

```
bytedance/seedance-2.0 reference-to-video failed (422):
{"detail":[{"loc":["body","image_urls"],
            "msg":"The images or videos provided may contain
                   likenesses of real people or other private
                   information that cannot be processed.",
            "type":"content_policy_violation",
            "ctx":{"extra_info":{"reason":"partner_validation_failed"}}, ...}]}
```

> [FIXTURE NEEDED — verify dreamina CLI 是否原样透传上述信封，或会包装成 `{"error": "...", "raw": {...}}` 的 CLI 形态。验证方法：拿一张含真人正脸的高清照跑 `dreamina image2video --image <photo> --prompt "walking"` 并把 stderr 贴到此处。]

**Key tokens to match:** `loc:["body","image_urls"]` **AND** `partner_validation_failed`（两者同时出现才算）。

**What it means:** ByteDance 的图片分类器在某张 `--image` / `--image-url` ref 上检测到照片级真人脸（超过面积阈值）并拒绝处理。**Prompt 完全没被评估**——改 prompt 词无效。

**Recovery:**

1. 找出哪张 ref 含真人脸（通常是 character ref，也可能是 background 里出现的人）。
2. 跑 character sheet 脚本（**Phase 2.9 待建**），生成 "photo-body, sketch-head" 的 16:9 sheet：
   ```bash
   python3 skills/autoviral/modules/assets/scripts/make_character_sheet.py \
     --source-url <被拒的图> \
     --outfit "..." \
     --traits "..." \
     --output assets/image/character-sheet-<name>.jpg
   ```
   sheet 的逻辑：把 panel 1-3 的头部画成铅笔素描、只让 panel 4 携带身份，让分类器看不到完整真人脸。详见 `capabilities/character-consistency.md`（待建）。
3. 用生成的 sheet 替换原 ref，重新调用同一条 dreamina 命令。
4. **从 prompt 中删除** "虚拟数字人 / virtual character / not a real person / CG render" 这些 hedge 词——它们打不过图像分类器（分类器只看图），反而把模型推向 game-CG 美感。
5. 若 dreamina CLI 支持 `--no-audio` 一并加上（**[FIXTURE NEEDED] — Phase 2.7 报告 dreamina CLI 不接受 `--no-audio` 标志；需用 `dreamina image2video -h` 二次验证当前版本是否新增**）。Signature B 经常在重试时跟着浮出，预防性消音可省一轮。
6. 重试。

**Do NOT use this workflow for:**
- 你没有肖像授权的真实可识别人物（这不是 filter 误报，是身份保护——告知用户，不要绕过）。
- 任何形式的未成年照片（AI 生的也不行）。
- 已经是 stylized / 3D / 动漫风格的 ref——它们本来就过 filter，你重做 sheet 只会浪费积分。

---

## Signature B — dreamina/Seedance output-audio 拒绝

**What you see:**

```
bytedance/seedance-2.0 reference-to-video failed (422):
{"detail":[{"loc":["body","generated_video"],
            "msg":"Output audio has sensitive content.",
            "type":"content_policy_violation",
            "ctx":{"extra_info":{"reason":"partner_validation_failed"}}, ...}]}
```

> [FIXTURE NEEDED — 同 Signature A，dreamina CLI 是否原样透传待验证。]

**Key tokens:** `loc:["body","generated_video"]` **AND** `Output audio has sensitive content`.

**What it means:** 图过了、帧已经生了，Seedance 自动音轨被音频分类器打回。这是 character-heavy prompt 的常客，与 prompt 内容基本无关。

**Recovery:**

1. **完全相同的命令重试**，加 `--no-audio`（**待验证**——若 dreamina CLI 不支持，则降级走 `multimodal2video --audio <silent.wav>` 注入静音轨，或改用 `frames2video`/`image2video` 默认无声路径）。
2. 不改 prompt、不改 seed、不改任何其它参数。

> 经验法则：character-heavy 生成可以**默认带消音 flag**，跳过这一轮失败。

---

## Signature C — OpenRouter `gpt-5.4-image-2` 内容安全拒绝

**What you see:**

[FIXTURE NEEDED] — 当前未捕获到真实样本。**Capture protocol**：

```bash
python3 skills/autoviral/modules/assets/scripts/openrouter_generate.py \
  --prompt "<deliberately violating prompt, e.g. 真实可识别公众人物的肖像请求>" \
  --output /tmp/should-fail.png \
  2>/tmp/openrouter-err.log

# 把 stderr 中的 RuntimeError 行（前 500 字符）贴到这里。
# OpenRouter 通常返回 {"error": {"message": "...", "code": "content_policy_violation", ...}}，
# 信封被 openrouter_generate.py L309-310 拆出 message 字段。
```

**Tentative key tokens（到 fixture 落地前的工作假设，禁止当成确定签名）：** `content_policy_violation` / `safety` / `not allowed` / `cannot generate` 出现在 RuntimeError 文本中。

**What it means（假设）：** OpenAI 的 prompt-side 安全分类器拦的——和 Seedance 的 image-side 不同，这一层**会读 prompt**。

**Recovery（保守路径，不依赖 fixture）：**

1. 重写 prompt：剔除可识别人物姓名、品牌名、明确暴力/性暗示用词、特定政治符号。改写为通用描述（"a young woman in red dress" 而非 "<celebrity name> in red dress"）。
2. 若 ref 图含真人脸，参考 Signature A 的 sheet 流程（OpenRouter 也有 image-side 检查，但触发条件比 Seedance 宽松）。
3. **只重试一次**——若改 prompt 后仍被拒，说明意图本身越界，升级到 fallback-strategy.md §1 Level 3：告知用户。

---

## Signature D — jimeng（火山 Visual API）视频任务失败

**What you see:**

[FIXTURE NEEDED] — `jimeng_generate.py` 只 surface `data['message']` 字段（L189 / L216），不包含完整 envelope。**Capture protocol**：

```bash
python3 skills/autoviral/modules/assets/scripts/jimeng_generate.py video \
  --prompt "<deliberately violating prompt>" \
  --output /tmp/should-fail.mp4 \
  2>/tmp/jimeng-err.log

# 把 RuntimeError 中文 message（"提交失败: ..." / "任务失败: ..."）贴到此处。
# 火山常见返回包括 "审核未通过" / "内容违规" / "敏感词" / 错误码 50412 等——
# 列出实际命中的中文短语，作为后续 token 匹配。
```

**Tentative key tokens（待 fixture 确认）：** "审核未通过" / "内容违规" / "敏感" / `code:50412`。

**What it means（假设）：** 火山的内容审核（prompt 或首帧任一侧均可触发）。

**Recovery（保守路径）：**

1. 若用了 `--first-frame`：先按 Signature A 流程检查首帧是否含真人脸，必要时换 sheet。
2. 重写 prompt 去敏感词（参考 fallback-strategy.md §1 Level 1）。
3. 仍失败 → fallback-strategy.md §1 Level 2：换模型 / 换 provider（dreamina 走另一条路）。
4. 仍失败 → Level 3：告知用户。

---

## Signature E — dreamina `AigcComplianceConfirmationRequired`

**What you see:** dreamina CLI 返回字面错误 `AigcComplianceConfirmationRequired`（已记录于 `dreamina-mastery.md` §8 L335-341）。

**What it means:** 该模型（特别是 Seedance 2.0）在该账号下**首次使用**需在网页端授权——不是内容拒绝，是合规协议确认。

**Recovery:**

1. 打开 https://jimeng.jianying.com，登录同一账号。
2. 找到该模型，点击完成授权确认。
3. 重试 CLI——一次性人工动作，**不要反复重试 CLI**（重试不会触发授权弹窗）。

---

## 决策流程：当签名都不匹配

按以下步骤诊断未知错误：

1. **完整保留 stderr**（重定向到文件，别让终端截掉）：`<command> 2>/tmp/err.log`。
2. **比对本文档的 5 个签名**——按 token 子串匹配（不要求完全相等），命中即按对应 Recovery 走。
3. **若明显是 content-policy 但签名不匹配**：删除 prompt 中所有可能敏感词、检查所有 ref 图、重试一次。仍失败 → fallback-strategy.md §1 Level 3。
4. **若明显不是 content-policy**（如网络、限流、参数非法）：跳出本文档，按 fallback-strategy.md §2/§4 路由。
5. **绝不静默重发**——每次重试必须改动至少一个输入（prompt / ref / flag）。
6. **新签名出现时**：按本文末 "Fixture capture protocol" 把它登记进本文档，让下一次能直接命中。

---

## 常见错误 / Anti-patterns

❌ 在 prompt 里加 "this is virtual / CG / not real / 数字人 / 虚拟形象" 试图绕开图像分类器——这些词**只读 prompt 不读图**，对 Signature A 完全无效，对 Signature C 反而可能成为新的 trigger。

❌ 对真实可识别公众人物的图反复跑 character-sheet 流程——sheet 是给"AI 误判为真人"的虚构角色用的，不是给真人改装。这是身份保护问题，告知用户。

❌ 对 Signature A 反复改 prompt 重试——分类器看的是图、不是字。改 100 次 prompt 也过不了。

❌ 第一次失败就跳到 fallback-strategy.md §1 Level 3 告知用户——先在本文档内做一次有针对性的 Recovery，再决定是否升级。

❌ 同时改 prompt + ref + flag 后重试——失败时不知道哪一项见效。**一次改一个变量**，方便复盘。

❌ 把 dreamina CLI / OpenRouter / jimeng 的错误一锅烩——三家分类器训练数据不同、阈值不同，同一张图在 dreamina 被拒不代表 OpenRouter 也会拒。Signature E（账号授权）和 Signature A（图像分类）更是完全不同的层。

---

## Fixture capture protocol

把 `[FIXTURE NEEDED]` 占位符替换成真实信封的标准流程：

1. 选一个生成脚本（`openrouter_generate.py` / `jimeng_generate.py` / `dreamina <subcommand>`）。
2. 构造一条**确定会被拒**的输入：
   - **Image-side 测试**：含真人正脸的高清照片做 ref。
   - **Prompt-side 测试**：明显违规 prompt（参考 OpenAI / 火山 公开使用条款，但**别真去测未成年/极端暴力**——跑常见名人名 + 政治敏感词足够触发，且更易模糊化记录）。
3. 重定向 stderr 到文件：`<command> 2>/tmp/captured-error.log`。
4. 打开日志，找 JSON 信封（一般在 `{` 和最后一个 `}` 之间，含 `content_policy` / `partner_validation` / `审核` 关键字）。
5. 把信封复制到对应 Signature 章节的 "What you see" 代码块中——**敏感细节脱敏**为 `<...>`。
6. 在该 Signature 章节末尾追加一行 `> Last verified: YYYY-MM-DD by <handle>`，让后续读者知道 fixture 的新鲜度。
7. 把 `[FIXTURE NEEDED]` 标记删掉，把 "Tentative key tokens" 改为 "Key tokens"。

---

## See also

- `capabilities/fallback-strategy.md` §1 — 战术 Recovery 全部失败时的告知用户路径
- `capabilities/character-consistency.md` — Signature A 的 photo-body/sketch-head sheet 流程（**Phase 2.9 待建**）
- `capabilities/structured-generation.md` — 上游 `[autoviral:create-asset]` 信封的处理上下文
- `capabilities/dreamina-mastery.md` §8 — Signature E（`AigcComplianceConfirmationRequired`）的来源
- `scripts/jimeng_generate.py` L188 / L215-217 — Signature D 的 surface 路径
- `scripts/openrouter_generate.py` L303-304 / L309-310 — Signature C 的 surface 路径
- `scripts/filter_retry/detect_signature.py` — 程序化签名匹配器（**Phase 2.10 待建**），未来取代 agent 手动比对
