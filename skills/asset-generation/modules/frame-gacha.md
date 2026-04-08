---
name: frame-gacha
description: 首帧抽卡模块——批量生成候选首帧、用户选择、锁定/重抽/跳过的完整流程
---

# 首帧抽卡（Frame Gacha）模块

## 核心原则

图片生成成本低、速度快；视频生成成本高、耗时长。**在投入视频生成之前，先用"抽卡"机制让用户从多张候选首帧中挑选最满意的一张。** 每个镜头生成 4 张候选首帧，用户确认后再进入视频生成环节，避免因首帧不满意导致的视频重复生成浪费。

---

## 流程

### Step 1: 批量生成候选首帧

调用 `POST /api/generate/image/batch`，一次性生成 4 张候选首帧：

```json
{
  "workId": "{workId}",
  "prompt": "{优化后的提示词}",
  "shotId": "{shotId}",
  "aspectRatio": "9:16"
}
```

系统会将 4 张候选图存储在：
```
assets/frames/candidates/{shot-id}/
├── seed-1001.png
├── seed-1002.png
├── seed-1003.png
└── seed-1004.png
```

### Step 2: 展示候选首帧，等待用户选择

在对话中以编号图片形式展示 4 张候选首帧，附带预览链接：

```
🎰 第 {N} 镜首帧抽卡结果（4 张候选）：

1️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/{shotId}/seed-1001.png
2️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/{shotId}/seed-1002.png
3️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/{shotId}/seed-1003.png
4️⃣ http://localhost:3271/api/works/{workId}/assets/frames/candidates/{shotId}/seed-1004.png

请选择 1-4，或说「重新抽卡」生成新的候选。
```

### Step 3: 锁定用户选择

用户选定后，调用 `POST /api/frames/select` 锁定首帧：

```json
{
  "workId": "{workId}",
  "shotId": "{shotId}",
  "selectedSeed": 1002
}
```

系统行为：
- 选中的首帧复制到 `assets/frames/frame-{shotId}.png`（正式首帧路径）
- 其余 3 张候选标记为 `_rejected`（文件名追加 `_rejected` 后缀，如 `seed-1001_rejected.png`）

### Step 4: 重新抽卡（Re-roll）

如果用户说「都不满意」「重新抽卡」「换一批」等，重新调用 `POST /api/generate/image/batch`，使用新的随机种子生成新一批 4 张候选。旧候选会被新候选覆盖。

### Step 5: 跳过选择（Skip）

如果用户说「跳过」「直接用第一张」「随便选一张」等，自动选择第一张候选（seed 最小的那张），执行 Step 3 的锁定流程。

---

## 注意事项

1. **候选存放在子文件夹中**：候选首帧统一存放在 `assets/frames/candidates/{shot-id}/` 子目录，与正式首帧 `assets/frames/frame-{shotId}.png` 路径分离，保持目录结构清晰。

2. **文件名格式**：候选文件名为 `seed-{XXXX}.png`，其中 `{XXXX}` 是生成时使用的随机种子编号，便于后续复现或微调。

3. **镜头间独立**：每个镜头（shot）的抽卡流程完全独立，一个镜头的选择不影响其他镜头。用户可以对不同镜头做不同选择（有的精挑细选，有的快速跳过）。

4. **角色一致性**：如果分镜中有多个镜头涉及同一角色，在 prompt 中保持角色描述一致（外貌、服装、发型等关键特征），必要时在后续镜头的 prompt 中引用已锁定首帧的角色特征描述，确保跨镜头角色连贯。

5. **宽高比继承**：`aspectRatio` 应从分镜计划中继承，保持全片镜头尺寸一致。常用竖屏 `9:16`，横屏 `16:9`。
