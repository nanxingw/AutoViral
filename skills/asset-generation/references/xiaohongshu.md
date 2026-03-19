# 小红书 (XHS) 素材生成参考

## 分辨率与宽高比规格

| 用途 | 宽高比 | 像素 (w×h) | 备注 |
|------|--------|-----------|------|
| 标准帖子 | 3:4 | 1080×1440 | 小红书最常见的格式 |
| 长图 | 9:16 | 1080×1920 | 用于全屏冲击效果 |
| 方图 | 1:1 | 1080×1080 | 用于产品网格、对比展示 |
| 封面图 | 3:4 | 1080×1440 | 多图帖子的第一张图 |
| 头像 | 1:1 | 1080×1080 | 各平台通用 |

**API 安全值（64 的倍数）：**
- 3:4 → 1088×1440 或 1080×1440
- 9:16 → 1088×1920
- 1:1 → 1088×1088

## 图片生成细节

小红书是一个**图文平台**——高质量图片是主要的内容形式，配合文字描述。

### 封面图的重要性

**封面图**是小红书内容中最关键的素材：
- 它直接决定了发现页的点击率
- 必须视觉效果出众、一眼抓住注意力，并清晰传达帖子的主题
- 一定要先生成封面图并获得用户确认后，再进行后续图片的生成
- 3:4 宽高比 (1080×1440) 是标准封面格式

### 小红书审美优先原则

小红书用户有很高的审美标准。每张图片都应该给人以下感觉：
- **杂志级品质**——精致、构图考究、有设计感
- **令人向往**——提升感的生活方式、精美的场景、精心策划的质感
- **视觉统一**——一篇帖子中的所有图片应共享一致的色调、光线风格和氛围

### 多图帖子策略

小红书帖子通常包含 3-9 张图片：
1. **封面图：** 主视觉图——视觉冲击力最强，定下整组图的基调
2. **内容图：** 辅助图片，用于讲述故事或展示细节
3. **末图：** 通常是总结、引导互动（CTA），或"收藏备用"的参考卡片

使用风格一致性技巧（风格后缀、色板锚定、角色描述复用）确保帖子中所有图片的视觉统一。

## 小红书专属风格关键词

**小红书通用审美：**
```
aesthetic, Instagram-worthy, magazine quality, curated, polished, aspirational lifestyle, visually appealing
```

**生活方式/种草：**
```
soft and warm aesthetic, lifestyle flat lay, cozy atmosphere, inviting, lifestyle photography, Morandi color palette, editorial quality
```

**美妆：**
```
beauty photography, clean skin, soft glow, beauty editorial, high-end cosmetics photography, porcelain skin, dewy finish
```

**家居：**
```
interior design photography, minimalist aesthetic, Scandinavian style, cozy home, warm tones, architectural digest quality
```

**穿搭/OOTD：**
```
street style photography, fashion editorial, outfit details, full-body shot, styled look, fashion-forward
```

## 小红书图片质量标准

1. **色彩调色至关重要**——小红书用户期待有意识的色彩调色。偏暖、微微降饱和度的色调（莫兰迪色系）最受欢迎。避免过饱和或刺眼的颜色。

2. **构图是关键**——运用三分法、引导线和有意识的留白。小红书用户会注意并欣赏用心的构图。

3. **光线要柔和、有美感**——自然窗光、黄金时段光线、柔和的漫射光是首选。避免硬阴影或闪光灯直拍的感觉。

4. **注重细节和质感**——小红书用户会放大看图。要包含精细的细节：面料质感、食物装饰、产品特写。在提示词中使用 `highly detailed, sharp focus`。

5. **白平衡一致**——一篇帖子中的所有图片应该有统一的白平衡和色温。每条提示词中都要包含明确的色温关键词。

6. **干净的背景**——杂乱的背景会降低视觉品质感。在合适的场景中使用 `clean background, uncluttered, minimal distractions`。

7. **宽高比统一**——同一篇帖子内的所有图片保持相同的宽高比，确保浏览体验整洁。
