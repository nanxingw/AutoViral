# 视频增强模块

当 AI 生成的视频素材存在帧率低、分辨率不足、画面微抖或面部细节模糊等问题时，加载此模块。涵盖帧插值、超分辨率、视频稳定和面部修复等后处理工具。

---

## 一、帧插值（Frame Interpolation）

AI 生成的视频通常只有 24fps 甚至更低，通过帧插值提升到 60fps 可大幅改善流畅度。

### 1.1 RIFE（推荐）

- **GitHub:** https://github.com/hzwer/ECCV2022-RIFE
- **原理：** 基于 IFNet 的实时中间帧估计，效果好且速度快
- **适用：** 24fps → 48fps 或 60fps

```bash
# 安装
git clone https://github.com/hzwer/ECCV2022-RIFE.git
cd ECCV2022-RIFE
pip install -r requirements.txt

# 2倍帧率（24fps → 48fps）
python3 inference_video.py --exp=1 --video=video.mp4

# 4倍帧率（24fps → 96fps，再用 ffmpeg 截取到 60fps）
python3 inference_video.py --exp=2 --video=video.mp4

# 指定输出路径
python3 inference_video.py --exp=1 --video=input.mp4 --output=interpolated.mp4
```

**参数说明：**
| 参数 | 值 | 效果 |
|------|---|------|
| `--exp=1` | 2倍 | 24→48fps |
| `--exp=2` | 4倍 | 24→96fps |
| `--exp=3` | 8倍 | 24→192fps（通常不需要） |

> 插值后用 ffmpeg 统一到目标帧率：`ffmpeg -i interpolated.mp4 -r 60 -y output_60fps.mp4`

### 1.2 Video2X 一体化方案

- **GitHub:** https://github.com/k4yt3x/video2x
- **特点：** 集成了帧插值 + 超分辨率，一个工具搞定两个需求

```bash
# 安装
pip install video2x

# 帧插值（使用 RIFE 引擎）
video2x -i input.mp4 -o output.mp4 -f rife -r 2

# 超分 + 帧插值一起做
video2x -i input.mp4 -o output.mp4 -f rife -r 2 -p realesrgan -s 2
```

---

## 二、超分辨率（Super Resolution）

将 AI 生成的 720p 或更低分辨率视频提升到 1080p，显著改善清晰度。

### 2.1 Real-ESRGAN（推荐）

- **GitHub:** https://github.com/xinntao/Real-ESRGAN
- **原理：** 基于 ESRGAN 的真实场景超分辨率模型，对 AI 生成内容效果尤佳
- **适用：** 720p → 1080p，或 540p → 1080p

```bash
# 方式一：使用预编译版本（推荐，无需 Python 环境）
# 下载 realesrgan-ncnn-vulkan：https://github.com/xinntao/Real-ESRGAN/releases

# 视频 2 倍超分（720p → 1440p，再裁切到 1080p）
realesrgan-ncnn-vulkan -i input.mp4 -o output.mp4 -n realesrgan-x4plus -s 2

# 动画/二次元专用模型
realesrgan-ncnn-vulkan -i input.mp4 -o output.mp4 -n realesrgan-x4plus-anime -s 2
```

```bash
# 方式二：Python 版本
pip install realesrgan

# 对单张图片超分
python3 -c "
from realesrgan import RealESRGANer
from basicsr.archs.rrdbnet_arch import RRDBNet
import cv2

model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
upsampler = RealESRGANer(scale=4, model_path='weights/RealESRGAN_x4plus.pth', model=model)

img = cv2.imread('input.png', cv2.IMREAD_UNCHANGED)
output, _ = upsampler.enhance(img, outscale=2)
cv2.imwrite('output.png', output)
"
```

**超分后裁切到标准分辨率：**
```bash
# 超分后可能不是标准分辨率，用 ffmpeg 裁切
ffmpeg -i upscaled.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,crop=1080:1920" -c:a copy -y final_1080p.mp4
```

### 2.2 GFPGAN 面部修复

- **GitHub:** https://github.com/TencentARC/GFPGAN
- **适用：** AI 生成视频中人脸模糊、扭曲时，专门修复面部细节

```bash
# 安装
pip install gfpgan

# 对视频逐帧修复面部
python3 -c "
import cv2, os
from gfpgan import GFPGANer

restorer = GFPGANer(model_path='experiments/pretrained_models/GFPGANv1.4.pth', upscale=1)

cap = cv2.VideoCapture('input.mp4')
fps = cap.get(cv2.CAP_PROP_FPS)
w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

out = cv2.VideoWriter('face_restored.mp4', cv2.VideoWriter_fourcc(*'mp4v'), fps, (w, h))

while True:
    ret, frame = cap.read()
    if not ret:
        break
    _, _, restored = restorer.enhance(frame, paste_back=True)
    out.write(restored)

cap.release()
out.release()
print('面部修复完成')
"

# 重新编码为 H.264（cv2 输出的 mp4v 编码兼容性差）
ffmpeg -i face_restored.mp4 -c:v libx264 -crf 23 -c:a copy -y face_restored_h264.mp4
```

---

## 三、视频稳定（Video Stabilization）

AI 生成的视频可能存在轻微抖动或不自然的晃动，使用 vid.stab 插件消除。

### 3.1 vid.stab + ffmpeg 两遍处理

vid.stab 是 ffmpeg 内置支持的视频稳定滤镜，需要两遍处理：

**第一遍：检测运动轨迹**
```bash
ffmpeg -i shaky.mp4 -vf vidstabdetect=shakiness=5:accuracy=15 -f null -
# 生成 transforms.trf 文件（运动数据）
```

**第二遍：应用稳定变换**
```bash
ffmpeg -i shaky.mp4 -vf vidstabtransform=smoothing=10:input=transforms.trf -c:a copy -y stabilized.mp4
```

**参数调整：**

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `shakiness` | 5 | 1-10 | 预估抖动程度，越大检测越敏感 |
| `accuracy` | 15 | 1-15 | 检测精度，15 为最高 |
| `smoothing` | 10 | 0-100 | 平滑程度，越大越稳但可能裁切更多 |

**按抖动程度选择参数：**
| 抖动程度 | shakiness | smoothing | 适用场景 |
|---------|-----------|-----------|---------|
| 轻微（AI微抖） | 3-5 | 5-10 | AI 生成视频 |
| 中等 | 5-7 | 10-20 | 手持拍摄 |
| 严重 | 8-10 | 20-30 | 运动/行走拍摄 |

### 3.2 一行命令版

```bash
# 两步合一（用 && 串联）
ffmpeg -i shaky.mp4 -vf vidstabdetect=shakiness=5:accuracy=15 -f null - && \
ffmpeg -i shaky.mp4 -vf vidstabtransform=smoothing=10:input=transforms.trf -c:a copy -y stabilized.mp4
```

### 3.3 稳定后裁边

稳定处理会在边缘产生黑边，需要裁切掉：

```bash
# 稳定 + 裁切黑边 + 缩放回原尺寸
ffmpeg -i shaky.mp4 \
  -vf "vidstabtransform=smoothing=10:input=transforms.trf,crop=iw*0.95:ih*0.95,scale=1080:1920" \
  -c:a copy -y stabilized_clean.mp4
```

---

## 四、推荐处理链

对于 AI 生成的视频素材，推荐按以下顺序处理：

```
AI 生成视频 → RIFE 帧插值（流畅度）→ Real-ESRGAN 超分（清晰度）→ vid.stab 稳定（消除微抖）→ LUT 调色（氛围感）
```

### 完整命令流水线

```bash
# 假设 AI 生成的原始视频为 ai_raw.mp4

# 第1步：帧插值 24fps → 48fps+
cd ECCV2022-RIFE
python3 inference_video.py --exp=1 --video=ai_raw.mp4 --output=step1_interpolated.mp4
cd -

# 第2步：超分辨率提升
realesrgan-ncnn-vulkan -i step1_interpolated.mp4 -o step2_upscaled.mp4 -n realesrgan-x4plus -s 2

# 第3步：裁切到标准分辨率 + 统一帧率
ffmpeg -i step2_upscaled.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,crop=1080:1920" -r 30 -c:a copy -y step3_normalized.mp4

# 第4步：视频稳定（如有微抖）
ffmpeg -i step3_normalized.mp4 -vf vidstabdetect=shakiness=4:accuracy=15 -f null - && \
ffmpeg -i step3_normalized.mp4 -vf "vidstabtransform=smoothing=8:input=transforms.trf,crop=iw*0.96:ih*0.96,scale=1080:1920" -c:a copy -y step4_stabilized.mp4

# 第5步：调色（参考 modules/color-grading.md）
ffmpeg -i step4_stabilized.mp4 -vf "eq=brightness=0.03:contrast=1.1:saturation=1.15" -c:a copy -y enhanced_final.mp4

# 清理中间文件
rm step1_interpolated.mp4 step2_upscaled.mp4 step3_normalized.mp4 step4_stabilized.mp4 transforms.trf
```

---

## 五、注意事项

### 5.1 环境要求

- **RIFE / Real-ESRGAN / GFPGAN** 需要额外安装（pip/brew），不是 ffmpeg 内置功能
- **vid.stab** 是 ffmpeg 插件，macOS 通过 `brew install ffmpeg` 安装的版本通常已包含
- 验证 vid.stab 是否可用：`ffmpeg -filters 2>&1 | grep vidstab`

### 5.2 性能考虑

| 工具 | GPU 需求 | 1分钟视频处理时间（估算） |
|------|---------|------------------------|
| RIFE | 推荐 | 有 GPU: 1-3 分钟；无 GPU: 10-30 分钟 |
| Real-ESRGAN | 推荐 | 有 GPU: 5-15 分钟；无 GPU: 30-120 分钟 |
| GFPGAN | 推荐 | 有 GPU: 3-10 分钟；无 GPU: 20-60 分钟 |
| vid.stab | 不需要 | CPU: 1-2 分钟 |

### 5.3 使用建议

- **处理时间较长**，建议仅对关键镜头使用，不必对所有片段都做增强
- **超分和帧插值对 GPU 有要求**，Apple Silicon Mac 可通过 MPS 后端加速
- **按需选择**：不是所有步骤都必须做，根据素材实际问题选择需要的处理
  - 帧率低（<30fps） → 帧插值
  - 分辨率低（<1080p） → 超分辨率
  - 画面抖动 → 视频稳定
  - 人脸模糊 → GFPGAN 面部修复
- **先处理单帧/短片段预览效果**，确认满意后再处理完整视频
