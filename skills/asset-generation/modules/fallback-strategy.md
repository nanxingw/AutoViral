---
name: fallback-strategy
description: 受阻时的系统性降级策略——质量优先，最小让步
---

# 受阻降级策略

## 核心原则
- 质量优先：宁可不交付，不可降质交付
- 最小让步：每一级降级都选择对最终内容质量影响最小的替代方案
- 透明决策：涉及质量降级的决策必须告知用户

## 降级场景与标准路径

### 1. 内容安全审核被拒
(e.g., image2video returns PROHIBITED_CONTENT)
Level 1: 改写 prompt 去除敏感词，保留原命令 (image2video)
Level 2: 换模型版本 (seedance2.0 → 3.0)
Level 3: 告知用户，请用户决定: a) 接受 text2video b) 调整素材 c) 用户手动上传
❌ 错误：静默退化到 text2video

### 2. API 限流/排队
Level 1: 并行提交多任务
Level 2: 切换到 fast 模型
Level 3: 设合理超时，告知用户预计时间

### 3. 服务不可用
Level 1: 检测到后立即告知用户
Level 2: 给出修复指令
Level 3: 切换到备用服务

### 4. 参数不支持
Level 1: 查 -h 确认支持的参数
Level 2: 自动调整到最近的合法值
Level 3: 告知用户调整了什么

### 5. 环境依赖缺失
Level 1: 检测能力 (ffmpeg -filters, python -c "import xxx")
Level 2: 用替代方案 (e.g., Pillow 替代 ffmpeg drawtext)
Level 3: 不要假设环境完整

### 6. 生成质量不达标
Level 1: 自检结果
Level 2: 调整 prompt 重试 (最多 3 次)
Level 3: 展示给用户决定

## 前置检测清单
在批量执行前必须完成:
1. dreamina user_credit — 检查积分
2. ffmpeg -filters | grep drawtext — 检查字幕能力
3. 对敏感题材先做 1 个样本测试
4. 确认网络连通性

## 首帧驱动原则
视频生成应优先使用 image2video（首帧驱动），而非 text2video（纯文生视频）：
- image2video 保留首帧的视觉控制力，画面一致性更高
- text2video 仅在 image2video 不可用时作为降级方案
- 如果已生成高质量首帧，浪费它们去用 text2video 是不可接受的质量损失
