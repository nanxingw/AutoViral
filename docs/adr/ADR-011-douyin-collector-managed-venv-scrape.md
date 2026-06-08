# ADR-011: Douyin creator-analytics collector — managed-venv scrape via the user's browser session

- **Status:** Accepted
- **Date:** 2026-06-08（随 v0.1.5 发布回填 — 决策在 PRD-0006 实现期定）
- **Deciders:** nanxingw（拍板"数据源 = 本地已有 + 重建抖音采集器"、采集器走"托管 Python venv"而非纯 TS）+ AI design partner（PRD-0006 调研 + git 考古被删采集器）
- **Related:** [PRD-0003 §1](../prd/0003-v0.1.2-zero-friction-setup.md)（外部依赖自举 + 托管 venv/doctor 机制，本 ADR 复用）· [ADR-007](ADR-007-single-media-provider-registry.md)（单一 provider registry——本采集器**不**走它，见决策 #5）
- **Resolves:** [PRD-0006](../prd/0006-v0.1.5-inspiration-data-redesign.md) 切片 S4/S5 + 用户问题"我的作品数据从哪来 / 怎么更新"

## Context

PRD-0006 调研把"数据页是空壳"的根因挖到底（主 agent 亲手验磁盘 + git 考古）：

1. **数据页坐在一份冻结的真实抖音抓取上。** `~/.autoviral/analytics/douyin/latest.json`（冻于 2026-05-14）含创作者全部 9 件作品的真实 per-post 指标 + `avg_play=624`。这些数据**真实但永不更新**：唯一的采集器是个 Python 脚本（`collect.py`），在 agentic-terminal 重构里**被删了**（#72 / commit 29b9e96），`POST /api/analytics/refresh` 自此硬返 501。

2. **被删采集器的真实机制**（从 `29b9e96^` 捞出 `douyin.py`）：用 Python `f2` 库（`DouyinCrawler`）+ `browser_cookie3`，从用户**已登录浏览器**里读 `sessionid` cookie，解析 profile URL → `sec_user_id` → 抓 profile + 作品。**难点不在 TS-vs-Python，而在抖音的请求签名**（`a_bogus`/`X-Bogus`）——`f2` 在 Python 侧已解决；纯 TS 重写等于自己重实现并追着抖音每次改版跑。

3. **人口属性（年龄/性别/地域）+ 洞察永远填不满。** `latest.json` 顶层只有 `[platform,collected_at,account,works,summary]`——**无 demographics/insights 键，无任何代码写过**。这是平台 OAuth-only 的私有数据：用户的真实平台里**小红书无个人数据 API、抖音需企业主体（营业执照）**，且任何平台在 5 粉规模下都不返回受众画像。"等待后台采集首批样本"是**架构性谎言**——不是 stale，是 architecturally impossible。

4. **AutoViral 是本地优先、无服务端集群**的单机工具（CONTEXT "What AutoViral is"）。任何"采集"只能在用户这台机器上、用用户的身份发生。

## Decision

**以托管 Python venv 恢复 `f2` + `browser_cookie3` 采集器，用用户已登录浏览器的抖音 session 抓取其本人创作者数据；同时删除（而非推迟）做不到的人口属性卡。**

### 本 ADR 锁定的决策

1. **托管 Python venv，不纯 TS 重写。** 采集器作为托管依赖恢复，跑在 `~/.autoviral/collector-venv`，**复用 [PRD-0003 §1](../prd/0003-v0.1.2-zero-friction-setup.md) 给 TTS 装 edge-tts 的同一套 doctor / managed-bin / venv 引导机制**。理由见 Context #2：`f2` 已解决抖音签名，纯 TS 要自己维护并追改版。接口 `refresh(profileUrl) → CreatorData | CollectorError`；解析边界（raw f2 JSON → `CreatorData`）是纯函数、fixture 可测，实际抓取走集成。

2. **鉴权 = 读用户浏览器的 `sessionid` cookie，本地、显式、不上传。** 抖音创作者数据私有，必须用用户身份。采集读用户已登录 douyin.com 的浏览器 cookie。**首跑需用户在浏览器登录** = 本 PRD 唯一 HITL 触点。Settings 把这个隐私权衡**显式摆出**（cookie-consent 说明就在刷新按钮旁），不藏。cookie/token **仅本地使用，绝不上传**。

3. **诚实失败，un-501。** `POST /api/analytics/refresh` 从硬 501 改为真刷新。无登录态 → 结构化 `CollectorError{needsRelogin}` + **401** + 可操作提示"请先登录 douyin.com，再点同步"——不是静默 501 死胡同，不是假成功，失败不覆盖 `上次同步` 时间戳。

4. **人口属性：删卡，不推迟。** 年龄/性别/地域对用户的真实平台在其规模下**架构上不可得**（Context #3）。诚实的唯一做法是**删掉**这三张卡 + 洞察空卡，换诚实三段式空态 + 平台诚实矩阵（讲清每个平台到底能不能拿）。**明确否决**"接 YouTube connect-channel OAuth 拿真人口属性"作为本版方案——用户主要不在 YouTube、5 粉也无返回、需 Google 验证审核，对当前零价值（留作未来可选，见备选 C）。

5. **采集器不进 provider registry（ADR-007）。** ADR-007 的单一 registry 管的是**生成类** MediaProvider（image/video/tts），有统一 `MediaProvider` 契约 + `envKey` 约定。采集器是**数据获取**、鉴权方式（浏览器 cookie）和契约都不同，强塞进去会扭曲那个抽象。它留在 `src/domain/analytics-collector.ts`，自成一类。

6. **本地优先 → secrets 明文存本地，是有意接受的风险。** 抖音 cookie 落本地、`config.yaml` 里即梦密钥等也是明文——这是**本地优先、单机单用户**架构的必然取舍：没有服务端保管库，秘密只能在用户自己的机器上。`GET /api/config` 响应层已脱敏（#60），但磁盘文件本身明文。**接受**此风险（威胁模型 = 能读用户磁盘的人已经赢了）；不为它引入本地 keychain 集成的复杂度。

### 备选（已否决）

- **A. 纯 TS 重写采集器。** 不引 Python 依赖，但要自己实现并维护抖音 `a_bogus`/`X-Bogus` 签名，每次抖音改版即崩。否决（Context #2）。
- **B. 保留 501 / 不重建采集器，只展示冻结快照。** 最省事，但用户数据永远停在 5-14，且"我怎么更新"无解。否决——用户明确要能刷新。
- **C. 接 YouTube Analytics OAuth 拿真人口属性。** 是拿真年龄/性别/地域的唯一诚实路（本地 daemon 做 loopback receiver），但对用户的真实平台（抖音/小红书）无用、需 Google 验证审核、5 粉无返回。作为**本版**方案否决，标记为未来可选，**不**在 v0.1.5 承诺。
- **D. 服务端集中采集（绕开用户登录）。** 违反本地优先架构（CONTEXT），且抖音私有数据本就无法被第三方代抓。否决。

## Consequences

### Positive
- **数据能真正刷新**：用户登录抖音后点同步，数据从冻结快照刷到最新——闭合了"我的数据从哪来/怎么更新"。
- **诚实落地**：删掉做不到的承诺（人口卡）、un-501、失败给可操作提示——与 invariant 8 一致。
- **复用既有 venv/doctor 机制**：不引入新的依赖管理范式（PRD-0003 已铺好路）。

### Negative / 成本
- **首跑依赖用户浏览器登录态**——subagent 无法代登，真 scrape 成功路径只能由用户自验（401 诚实路径已 E2E 验过）。
- **爬虫固有脆弱性**：抖音改版可能让 `f2` 失效；ToS 灰色；可能 IP 限流。这是"要能刷新本人数据"与"无官方个人 API"之间的现实取舍，已知并接受。
- **多一个托管 Python 依赖**（`collector-venv`），doctor 要体检它。
- **secrets 明文**是有意接受的风险，但对"把 config 分享出去"的场景不设防（用户须自知，已在对话中提示轮换即梦密钥）。

### Neutral
- 不改 ADR-007：生成类仍走单一 provider registry；采集器是另一类、另立门户（决策 #5）。
- 趋势数据（灵感页）是**另一个**数据获取子系统，与本采集器无关：4 平台仅小红书真 Playwright 抓，其余 3 个 `agentFallback` LLM 推理（见 CONTEXT「trend provenance」）。

---

> **已采纳（2026-06-08，随 v0.1.5 发布回填）**：采集器接线 + un-501 + Settings cookie-consent 已落，D4 解析边界 fixture 测试绿；401 诚实失败路径经浏览器 E2E 验证。真数据成功路径待用户登录抖音后自验。
