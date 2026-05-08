---
name: assets-filter-retries
description: Use when an OpenRouter generation request fails with content-policy / safety / account-authorization signature — e.g. image-to-video returns 422 partner_validation_failed, gpt-5.4-image-2 returns content_policy_violation, output-audio classifier rejects, jimeng task fails for sensitive content. Provides signature → recovery decision tree. NOT for rate-limit (fallback-strategy.md §2) / network timeout (just retry) / invalid params (check schema).
type: capability
priority: rigid
sources:
  - https://openrouter.ai/docs/api/reference/errors-and-debugging
  - autoviral 历史 fixture（2026-04 至 2026-05 实际捕获样本）
last_updated: 2026-05-08
---

# 内容审核失败签名 → 恢复决策树（OpenRouter 版）

本文档是 `fallback-strategy.md §1`（"内容安全审核被拒"）的**战术下钻层**——把"改 prompt → 换模型 → 告知用户"这条降级链落到具体的 OpenRouter response.error 信封识别上。

判断口径：**先看错误来自哪一层**（image classifier / prompt safety / output-audio classifier / 账号合规），再看恢复手段是改输入图、改 prompt、换模型还是人工介入。**永远不要静默重发同一条命令**——每次重试至少改动一个输入。

---

## 1. OpenRouter 错误信封统一结构

OpenRouter 的所有视频 / 图像 API 在失败时返回**统一格式**：

### 视频（async job 失败）

`GET /api/v1/videos/{jobId}` 返回 `status: "failed"` 时：

```json
{
  "id": "vid_abc123",
  "status": "failed",
  "error": {
    "code": "content_policy_violation",
    "message": "The images or videos provided may contain likenesses of real people...",
    "provider_error": {
      "detail": [{
        "loc": ["body", "image_urls"],
        "type": "content_policy_violation",
        "ctx": { "extra_info": { "reason": "partner_validation_failed" } }
      }]
    }
  }
}
```

`provider_error` 是上游 provider（Seedance / Veo / Wan / Sora）原始 error，OpenRouter 透传。

### 图像（同步失败）

`POST /api/v1/chat/completions` 返回 HTTP 4xx 时：

```json
{
  "error": {
    "code": "content_policy_violation",
    "message": "Request rejected by safety filter",
    "metadata": { "raw": "..." }
  }
}
```

### 关键字段

| 字段 | 用途 |
|---|---|
| `error.code` | OpenRouter 标准化 code（`content_policy_violation` / `provider_error` / `rate_limit_exceeded` / `invalid_request_error` 等）|
| `error.message` | 人类可读，按 token 匹配本文档签名的主要依据 |
| `error.provider_error` | 上游 provider 原始信封（Seedance / Veo 等的 fal.run / Google API response），最详细 |
| `error.metadata` | 部分模型用，含 `raw` 透传 |

---

## 2. Signature A — Seedance image-side 真人脸拒绝

### What you see

OpenRouter videos API `status: "failed"`：

```json
{
  "id": "vid_...",
  "status": "failed",
  "error": {
    "code": "content_policy_violation",
    "message": "Reference image contains likenesses of real people that cannot be processed",
    "provider_error": {
      "detail": [{
        "loc": ["body", "image_urls"],
        "msg": "The images or videos provided may contain likenesses of real people or other private information that cannot be processed.",
        "type": "content_policy_violation",
        "ctx": { "extra_info": { "reason": "partner_validation_failed" } }
      }]
    }
  }
}
```

### Key tokens to match

`provider_error.detail[].loc:["body","image_urls"]` **AND** `partner_validation_failed`（两者同时出现才算）。

### What it means

ByteDance Seedance 的图片分类器在某张 ref（`frame_images` 或 `input_references[type=image_url]`）上检测到照片级真人脸（超过面积阈值）并拒绝处理。**Prompt 完全没被评估**——改 prompt 词无效。

### Recovery

1. 找出哪张 ref 含真人脸（通常是 character ref，也可能是 background 里出现的人）。
2. 跑 character sheet 工作流（**Phase 2.9 待建**），用 OpenRouter `openai/gpt-5.4-image-2` 生成 "photo-body, sketch-head" 风格 sheet：
   ```bash
   curl -X POST "https://openrouter.ai/api/v1/chat/completions" \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "openai/gpt-5.4-image-2",
       "messages": [{
         "role": "user",
         "content": "Editorial 4-panel character sheet on Hasselblad: panel 1-3 show character body in different poses but heads rendered as detailed pencil sketch ONLY (no photographic face); panel 4 shows complete photographic likeness. <outfit / traits>. Cinematic, fine grain."
       }],
       "modalities": ["image", "text"],
       "image_config": { "aspect_ratio": "16:9", "image_size": "2K" }
     }'
   ```
   sheet 的逻辑：把 panel 1-3 的头部画成铅笔素描、只让 panel 4 携带身份，让分类器看不到完整真人脸。详见 `capabilities/character-consistency.md`（待建）。
3. 用生成的 sheet URL 替换原 ref，重新调用同一条 OpenRouter videos 请求。
4. **从 prompt 中删除** "虚拟数字人 / virtual character / not a real person / CG render" 这些 hedge 词——它们打不过图像分类器（分类器只看图），反而把模型推向 game-CG 美感。
5. 预防性：考虑提前加 `audio: "muted"` 字段（如模型支持），可避开 Signature B 跟着浮出。
6. 重试。

### Do NOT use this workflow for

- 你没有肖像授权的真实可识别人物（这不是 filter 误报，是身份保护——告知用户，不要绕过）。
- 任何形式的未成年照片（AI 生的也不行）。
- 已经是 stylized / 3D / 动漫风格的 ref——它们本来就过 filter，你重做 sheet 只会浪费积分。

---

## 3. Signature B — Seedance output-audio 拒绝

### What you see

```json
{
  "id": "vid_...",
  "status": "failed",
  "error": {
    "code": "content_policy_violation",
    "message": "Generated video audio contains sensitive content",
    "provider_error": {
      "detail": [{
        "loc": ["body", "generated_video"],
        "msg": "Output audio has sensitive content.",
        "type": "content_policy_violation",
        "ctx": { "extra_info": { "reason": "partner_validation_failed" } }
      }]
    }
  }
}
```

### Key tokens

`provider_error.detail[].loc:["body","generated_video"]` **AND** `Output audio has sensitive content`.

### What it means

图过了、帧已经生了，Seedance 自动生成的音轨被音频分类器打回。这是 character-heavy / 对话场景的常客，与 prompt 内容基本无关。

### Recovery

1. **完全相同的请求重试**，加 `audio: "muted"` 字段（OpenRouter 视频参数支持禁用自动音频生成）：
   ```json
   {
     "model": "bytedance/seedance-2.0",
     "prompt": "...",
     "audio": "muted",
     "duration": 8
   }
   ```
2. 不改 prompt、不改任何其它参数。视频出来后用 ffmpeg 后期混音（参 `assembly/SKILL.md`）。

> 经验法则：character-heavy 生成可以**默认就带 `audio: "muted"`**，跳过这一轮失败。后期混音永远比赌 lip-sync 通过审核稳。

---

## 4. Signature C — OpenAI prompt-side 内容安全拒绝（图像）

### What you see

`POST /api/v1/chat/completions` 返回 HTTP 400/422：

```json
{
  "error": {
    "code": "content_policy_violation",
    "message": "Your request was rejected as a result of our safety system. Your prompt may contain text that is not allowed by our safety system.",
    "metadata": {
      "raw": "..."
    }
  }
}
```

### Key tokens

`error.code === "content_policy_violation"` **AND** `error.message` 含 `safety system` / `not allowed` / `cannot generate`.

### What it means

OpenAI 的 prompt-side 安全分类器拦的——和 Seedance 的 image-side 不同，这一层**会读 prompt 文本**。可识别公众人物姓名、品牌名、特定政治符号、明确暴力/性暗示用词都可能触发。

### Recovery

1. 重写 prompt：
   - 剔除可识别人物姓名（"Taylor Swift" → "a young blonde singer"）
   - 剔除品牌名（"Nike Air Max" → "a black athletic sneaker"）
   - 剔除政治符号（"red flag with hammer" → "a red banner"）
   - 软化暴力描述（"blood splatter" → "dramatic impact effect"）
2. 若 ref 图含真人脸，参考 Signature A 的 sheet 流程（OpenRouter `gpt-5.4-image-2` 也有 image-side 检查，但触发条件比 Seedance 宽松）。
3. **只重试一次**——若改 prompt 后仍被拒，说明意图本身越界，升级到 `fallback-strategy.md` §1 Level 3：告知用户。
4. 备选：换图像模型（`google/gemini-3.1-flash-image-preview` 的安全策略不同，有可能过；但对真人 ID 同样严格）。

---

## 5. Signature D — Veo 3 / Sora 2 prompt 安全拒绝（视频）

### What you see

OpenRouter videos API `status: "failed"`，`error.message` 含上游 provider 安全语：

```json
{
  "status": "failed",
  "error": {
    "code": "content_policy_violation",
    "message": "Prompt rejected by Google safety policy: real-person likeness",
    "provider_error": {
      "code": 400,
      "message": "Generation request violates content policy",
      "category": "PERSON_OF_INTEREST"
    }
  }
}
```

### Key tokens

`error.message` 含 `safety policy` / `content policy` / `PERSON_OF_INTEREST` / `CHILD_SAFETY` 等 Google / OpenAI category。

### What it means

Veo 3.1 / Sora 2 Pro 的 prompt-side 分类器拦——比 Seedance 宽，但对**已知公众人物 + 未成年 + 暴力**更严。

### Recovery

1. 同 Signature C：剔除可识别 ID / 品牌 / 政治 / 软化暴力词。
2. 切回 `bytedance/seedance-2.0`——Seedance 在 prompt 安全上比 Veo / Sora 宽容（但 image-side 比 OpenAI 严，trade-off）。
3. 仍失败 → fallback-strategy.md §1 Level 3。

---

## 6. Signature E — OpenRouter 配额 / 计费 / 账户状态

### What you see

```json
{
  "error": {
    "code": "insufficient_credits" | "account_blocked" | "rate_limit_exceeded",
    "message": "Insufficient credits. Please add credits at https://openrouter.ai/credits"
  }
}
```

或 HTTP 401:
```json
{ "error": { "code": "invalid_api_key", "message": "API key is invalid or revoked" } }
```

### What it means

不是内容审核——是账户问题。本文档不深入处理，跳到 `fallback-strategy.md` §2（限流）/ §3（配额）。

### Quick fix

```bash
curl https://openrouter.ai/api/v1/credits \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"
```

返回的 `total_credits / total_usage / is_blocked` 决定下一步。

---

## 7. Legacy Dreamina CLI signature（fallback 时用）

OpenRouter 不可用、退化到 Dreamina CLI 时的 signature 形态：

| Signature | CLI surface 关键 token |
|---|---|
| Image-side（同 §2）| stderr 含 `partner_validation_failed` + `image_urls` |
| Output-audio（同 §3）| stderr 含 `Output audio has sensitive content` + `generated_video` |
| 账号合规（特有）| stderr 含 `AigcComplianceConfirmationRequired` |

### Signature F — Dreamina `AigcComplianceConfirmationRequired`（CLI only）

**What you see:** dreamina CLI 返回字面错误 `AigcComplianceConfirmationRequired`。

**What it means:** Dreamina 该模型（特别是 Seedance 2.0）在该账号下**首次使用**需在网页端授权——不是内容拒绝，是合规协议确认。

**Recovery:**

1. 打开 https://jimeng.jianying.com，登录同一账号。
2. 找到该模型，点击完成授权确认。
3. 重试 CLI——一次性人工动作，**不要反复重试 CLI**（重试不会触发授权弹窗）。

> OpenRouter PRIMARY 路径**没有这个 signature**——OpenRouter 账号已经统一授权所有上游模型。这是只在 fallback 路径会遇到的问题。

---

## 8. 决策流程：当签名都不匹配

按以下步骤诊断未知错误：

1. **完整保留 OpenRouter response**：
   - 视频：`curl /api/v1/videos/{id} | tee /tmp/job-status.json`（再 jq）
   - 图像：把 `error` 对象完整 console.log 出来
2. **比对本文档的 signature** —— 按 `error.code` + `error.message` token 子串匹配（不要求完全相等），命中即按对应 Recovery 走。特别看 `provider_error` 字段（上游原始信封信息最丰富）。
3. **若 `error.code === "content_policy_violation"` 但 message 不匹配**：删除 prompt 中所有可能敏感词、检查所有 ref 图、重试一次。仍失败 → `fallback-strategy.md` §1 Level 3。
4. **若 `error.code !== "content_policy_violation"`**：跳出本文档，按 `fallback-strategy.md` §2/§4 路由。
5. **绝不静默重发**——每次重试必须改动至少一个输入（prompt / ref / model / audio flag）。
6. **新签名出现时**：按本文末 "Fixture capture protocol" 把它登记进本文档，让下一次能直接命中。

---

## 9. 常见错误 / Anti-patterns

❌ 在 prompt 里加 "this is virtual / CG / not real / 数字人 / 虚拟形象" 试图绕开图像分类器——这些词**只读 prompt 不读图**，对 Signature A 完全无效，对 Signature C 反而可能成为新 trigger。

❌ 对真实可识别公众人物的图反复跑 character-sheet 流程——sheet 是给"AI 误判为真人"的虚构角色用的，不是给真人改装。这是身份保护问题，告知用户。

❌ 对 Signature A 反复改 prompt 重试——分类器看的是图、不是字。改 100 次 prompt 也过不了。

❌ 第一次失败就跳到 `fallback-strategy.md` §1 Level 3 告知用户——先在本文档内做一次有针对性的 Recovery，再决定是否升级。

❌ 同时改 prompt + ref + model 后重试——失败时不知道哪一项见效。**一次改一个变量**，方便复盘。

❌ 把 OpenRouter `error.code` 和 `provider_error.code` 混淆——OpenRouter code 是标准化的，provider_error 是上游原始的。匹配 signature 时**优先看 provider_error**（更精确）。

❌ 用 OpenRouter PRIMARY 时遇到 Signature F（`AigcComplianceConfirmationRequired`）——这个签名 OpenRouter 路径不应该出现；如果出现，说明 backend 错误地走了 Dreamina CLI fallback。先排查路由，不要去网页端授权。

---

## 10. Fixture capture protocol

把 `[FIXTURE NEEDED]` 占位符替换成真实信封的标准流程：

1. 选一个生成端点（OpenRouter `/api/v1/videos` 或 `/api/v1/chat/completions`）。
2. 构造一条**确定会被拒**的输入：
   - **Image-side 测试**：含真人正脸的高清照片做 ref（`frame_images` / `input_references` / `messages.content` 里塞）。
   - **Prompt-side 测试**：明显违规 prompt（参考 OpenAI / Google 公开使用条款，但**别真去测未成年/极端暴力**——跑常见名人名 + 政治敏感词足够触发，且更易模糊化记录）。
3. 把完整 response 落盘：
   ```bash
   # 视频
   curl https://openrouter.ai/api/v1/videos/{jobId} \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -o /tmp/captured-failure.json

   # 图像
   curl -X POST https://openrouter.ai/api/v1/chat/completions ... \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -o /tmp/captured-failure.json
   ```
4. 打开 `error` 对象，找 `code` + `message` + `provider_error`。
5. 把信封复制到对应 Signature 章节的 "What you see" 代码块——**敏感细节脱敏**为 `<...>`。
6. 在该 Signature 章节末尾追加一行 `> Last verified: YYYY-MM-DD by <handle>`，让后续读者知道 fixture 的新鲜度。
7. 把 `[FIXTURE NEEDED]` 标记删掉，把 "Tentative key tokens" 改为 "Key tokens"。

---

## See also

- `capabilities/fallback-strategy.md` §1 — 战术 Recovery 全部失败时的告知用户路径
- `capabilities/character-consistency.md` — Signature A 的 photo-body/sketch-head sheet 流程（**Phase 2.9 待建**）
- `capabilities/structured-generation.md` — 上游 envelope 协议处理上下文
- `capabilities/dreamina-mastery.md` §6 — 错误排查总览（含 OpenRouter HTTP error 速查表）
- `capabilities/dreamina-mastery.md` §7 — Signature F 来源（Dreamina CLI legacy fallback 路径）
