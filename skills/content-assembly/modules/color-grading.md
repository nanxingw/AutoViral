# 调色指南模块

当需要为视频添加调色风格、统一色调氛围时，加载此模块。涵盖 LUT 调色、基础参数调色、内容类型专属调色方案以及 AI 智能调色工具。

---

## 一、LUT 调色工作流

LUT（Look-Up Table）是最高效的调色方式——一个 `.cube` 文件即可定义完整的色彩映射。

### 1.1 ffmpeg lut3d 命令

```bash
# 应用 .cube 格式 LUT
ffmpeg -i input.mp4 -vf "lut3d=cinematic.cube" -c:a copy -y output.mp4

# 指定插值方式（tetrahedral 质量最好）
ffmpeg -i input.mp4 -vf "lut3d=cinematic.cube:interp=tetrahedral" -c:a copy -y output.mp4
```

### 1.2 Hald CLUT 应用

Hald CLUT 是图片格式的 LUT，很多调色预设以 PNG 形式分发：

```bash
# 应用 Hald CLUT 图片
ffmpeg -i input.mp4 -i hald_clut.png -filter_complex "[0][1]haldclut" -c:a copy -y output.mp4
```

### 1.3 推荐免费 LUT 资源

| 资源 | 地址 | 说明 |
|------|------|------|
| Lutify.me Free | https://lutify.me/free-luts/ | 专业级免费 LUT 包 |
| FreshLUTs | https://freshluts.com/ | 社区分享，种类丰富 |
| SmallHD Free | https://smallhd.com/community/free-luts | 电影感 LUT |
| RocketStock | https://www.rocketstock.com/free-after-effects-templates/35-free-luts/ | 35 个免费电影 LUT |

> **提示：** 下载 LUT 后放入项目的 `shared-assets/luts/` 目录，方便复用。

---

## 二、基础调色参数

不使用 LUT 时，可直接用 ffmpeg 内置滤镜进行调色。

### 2.1 亮度/对比度/饱和度/伽马

```bash
# eq 滤镜：最常用的基础调色工具
ffmpeg -i input.mp4 -vf "eq=brightness=0.06:contrast=1.2:saturation=1.3:gamma=1.1" -c:a copy -y output.mp4
```

**参数说明：**
| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `brightness` | 0 | -1.0 ~ 1.0 | 亮度偏移，正值提亮 |
| `contrast` | 1.0 | 0 ~ 2.0 | 对比度倍率，>1 增强 |
| `saturation` | 1.0 | 0 ~ 3.0 | 饱和度倍率，>1 更鲜艳 |
| `gamma` | 1.0 | 0.1 ~ 10.0 | 伽马校正，>1 提亮暗部 |

### 2.2 色彩曲线预设

```bash
# curves 滤镜自带多种预设
ffmpeg -i input.mp4 -vf "curves=preset=cross_process" -c:a copy -y output.mp4
```

**可用预设：**
| 预设 | 效果 | 适用场景 |
|------|------|---------|
| `cross_process` | 交叉冲洗，偏色复古 | 胶片/复古风格 |
| `lighter` | 整体提亮 | 风景/旅行 |
| `darker` | 整体压暗 | 电影感/氛围感 |
| `increase_contrast` | 增强对比 | 科技/产品 |
| `negative` | 反色 | 特殊效果 |
| `vintage` | 复古色调 | 文艺/怀旧 |
| `strong_contrast` | 强对比 | 需要冲击力的场景 |

### 2.3 色温调整

ffmpeg 没有直接的色温参数，通过 `colorbalance` 滤镜模拟：

```bash
# 暖色温（偏黄偏红）
ffmpeg -i input.mp4 -vf "colorbalance=rs=0.1:gs=-0.05:bs=-0.15" -c:a copy -y output.mp4

# 冷色温（偏蓝）
ffmpeg -i input.mp4 -vf "colorbalance=rs=-0.1:gs=0:bs=0.15" -c:a copy -y output.mp4
```

**参数说明：** `rs/gs/bs` 分别控制阴影区的 红/绿/蓝 偏移（-1.0 ~ 1.0），另有 `rm/gm/bm`（中间调）和 `rh/gh/bh`（高光）。

---

## 三、内容类型调色参考

根据内容类型选择对应调色方案，可直接复制命令使用：

| 内容类型 | 调色方向 | ffmpeg 参数示例 |
|---------|---------|----------------|
| 美食 | 暖色温+高饱和 | `eq=saturation=1.3,colorbalance=rs=0.1:gs=-0.05:bs=-0.1` |
| 时尚/美妆 | 柔和低对比+莫兰迪 | `eq=contrast=0.95:saturation=0.85:gamma=1.05` |
| 旅行/风景 | 高对比+鲜艳 | `eq=contrast=1.2:saturation=1.2,curves=preset=lighter` |
| 科技/数码 | 冷色调+高对比 | `eq=contrast=1.15:saturation=0.9,colorbalance=rs=-0.1:bs=0.1` |
| 日常/Vlog | 自然+微暖 | `eq=brightness=0.02:saturation=1.05:gamma=1.02` |
| 胶片/复古 | 低饱和+偏色+颗粒 | `eq=saturation=0.7,noise=alls=15:allf=t` |

**完整命令示例（美食类）：**

```bash
ffmpeg -i input.mp4 \
  -vf "eq=saturation=1.3,colorbalance=rs=0.1:gs=-0.05:bs=-0.1" \
  -c:a copy -y output.mp4
```

**完整命令示例（胶片/复古类）：**

```bash
ffmpeg -i input.mp4 \
  -vf "eq=saturation=0.7,noise=alls=15:allf=t" \
  -c:a copy -y output.mp4
```

---

## 四、AI 智能调色工具

当需要更精细的调色或参考特定影片风格时，可使用以下 AI 工具：

### 4.1 agentic-color-grader

- **GitHub:** https://github.com/perbhat/agentic-color-grader
- **原理：** LLM Agent 驱动，用自然语言描述目标风格，AI 自动生成调色参数
- **适用场景：** 需要模仿特定电影/风格但不确定具体参数时

```bash
# 安装
pip install agentic-color-grader

# 使用示例
agentic-color-grader --input input.mp4 --style "warm cinematic look like Wong Kar-wai" --output graded.mp4
```

### 4.2 AI_color_grade_lut

- **GitHub:** https://github.com/andjoer/AI_color_grade_lut
- **原理：** 基于 pix2pix 模型，输入参考图片自动生成匹配的 LUT 文件
- **适用场景：** 有参考图片/截图，想让视频匹配该色调时

```bash
# 克隆仓库
git clone https://github.com/andjoer/AI_color_grade_lut.git
cd AI_color_grade_lut

# 根据参考图生成 LUT
python generate_lut.py --reference reference.jpg --output my_style.cube

# 然后用 ffmpeg 应用生成的 LUT
ffmpeg -i input.mp4 -vf "lut3d=my_style.cube" -c:a copy -y graded.mp4
```

---

## 五、调色一致性原则

### 5.1 同一作品统一调色

同一作品的所有片段**必须**使用相同的调色参数，确保视觉一致性：

```bash
# 先在一个片段上调好参数
ffmpeg -i norm-01.mp4 -vf "eq=brightness=0.03:contrast=1.1:saturation=1.15" -c:a copy -y graded-01.mp4

# 确认效果满意后，批量应用相同参数
for i in norm-01.mp4 norm-02.mp4 norm-03.mp4 norm-04.mp4 norm-05.mp4; do
  ffmpeg -i "$i" -vf "eq=brightness=0.03:contrast=1.1:saturation=1.15" -c:a copy -y "graded-${i#norm-}"
done
```

### 5.2 调色顺序建议

1. 先完成剪辑拼接（第1-4步）
2. 在**接近成品**的阶段再调色
3. 调色后不要再做可能影响色彩的操作（如重新编码、叠加滤镜）

### 5.3 调色预览

在正式处理前，先对单帧进行调色预览：

```bash
# 抽取一帧
ffmpeg -i input.mp4 -ss 00:00:03 -frames:v 1 -y preview-before.png

# 应用调色参数到该帧
ffmpeg -i preview-before.png -vf "eq=brightness=0.03:contrast=1.1:saturation=1.15" -y preview-after.png

# 对比 preview-before.png 和 preview-after.png 确认效果
```

---

## 六、组合调色滤镜

多个滤镜可以用逗号串联：

```bash
# 暖调 + 提亮 + 轻微颗粒 = 日系胶片感
ffmpeg -i input.mp4 \
  -vf "eq=brightness=0.05:contrast=0.95:saturation=0.9:gamma=1.1,colorbalance=rs=0.08:gs=0.02:bs=-0.05,noise=alls=8:allf=t" \
  -c:a copy -y output.mp4

# LUT + 微调
ffmpeg -i input.mp4 \
  -vf "lut3d=cinematic.cube,eq=brightness=0.02:saturation=1.1" \
  -c:a copy -y output.mp4
```

> **注意：** 滤镜顺序影响最终效果。一般先做基础校正（eq），再做色彩偏移（colorbalance），最后加纹理效果（noise）。
