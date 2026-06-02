# 趋势调研：用 Claude CLI 替代 Playwright 爬虫

> Explore/Analytics 页面的数据获取方案

## 问题

原设计：DataCollector → PublishEngine.getAdapter() → adapter.scrapeTrending(page) via Playwright。

实际情况：Playwright 没有初始化，没有登录 cookies，scrape 100% 失败。整条数据管道不可用。

## 解决方案

用 Claude CLI + WebSearch 替代 Playwright 爬虫。CLI 能搜索网络并返回结构化数据。

```typescript
async function researchTrends(platforms: string[]): Promise<{collected: string[]; errors: string[]}> {
  for (const platform of platforms) {
    const prompt = `搜索 ${platform} 当前热门趋势，输出 JSON：
      {"videos": [{title, views, likes, comments}], "tags": [{tag, posts, trend}]}`;

    const result = await runCliBrief(prompt);  // claude -p ... --model haiku
    // 解析 JSON → 保存到 ~/.skill-evolver/trends/{platform}/{date}.yaml
  }
}
```

## Prompt 设计要点

### 1. 强制 JSON 输出

```
你必须输出有效的 JSON，这是硬性要求，不允许输出其他格式。
即使搜索结果不完整，也要根据已有信息尽力填充，估算数据也可以。
```

不加这句，CLI 可能返回解释性文字（"我无法获取实时数据..."）而不是 JSON。

### 2. 指定搜索词

```
使用 WebSearch 搜索以下内容：
- "小红书 热门话题 2026"
- "小红书 爆款内容 趋势"
```

明确告诉 CLI 搜索什么，比模糊的"搜索热门内容"效果好得多。

### 3. JSON 提取容错

CLI 输出可能包裹在 ```json ``` 代码块中。提取时要处理：

```typescript
const stripped = result.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
const firstBrace = stripped.indexOf("{");
const lastBrace = stripped.lastIndexOf("}");
const data = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
```

用 `indexOf/lastIndexOf` 而不是正则 `\{[\s\S]*\}`（正则在嵌套 JSON 中不可靠）。

## 数据流

```
前端 "开始调研" 按钮
  → POST /api/collector/trigger {type: "research", platforms: ["xiaohongshu", "douyin"]}
    → researchTrends()
      → claude -p "搜索热门..." --model haiku --output-format json
      → 解析 JSON
      → 写入 ~/.skill-evolver/trends/{platform}/{date}.yaml
  ← {collected: ["xiaohongshu", "douyin"], errors: []}
前端 fetchTrends()
  → GET /api/trends/xiaohongshu
  ← {videos: [...], tags: [...]}
  → 渲染卡片
```

## 平台差异

| 平台 | WebSearch 效果 | 备注 |
|------|---------------|------|
| 小红书 | 好 | 有大量公开热门话题数据 |
| 抖音 | 一般 | 抖音数据封闭，WebSearch 获取的是趋势分析而非实时榜单 |
| YouTube | 好 | 英文搜索结果丰富 |
| TikTok | 好 | 国际版数据公开 |

## 成本

每次调研约消耗 ~$0.02（haiku 模型 + WebSearch），可接受。
