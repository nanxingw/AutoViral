# smart_crop

Phase 6 reframing utilities. Picks an aspect-correct ROI from a source frame
using one of three strategies (`face` / `saliency` / `center`) and crops video
clips with `crop_9_16.py`.

## Strategy ladder (D2)

1. **face** — `mediapipe.tasks.vision.FaceDetector` (BlazeFace short-range);
   ROI follows the largest face. Returns `None` when no face is found so the
   caller falls back to saliency.
2. **saliency** — `cv2.BackgroundSubtractorMOG2` motion mass; ROI follows the
   largest motion contour. Stateful per clip.
3. **center** — fixed centre crop. Always returns an ROI.

`auto_strategy_for_video()` probes the first ~30 frames and picks whichever
strategy succeeds first.

## One-time setup: face detector model

mediapipe 0.10+ dropped the legacy `mp.solutions.face_detection` API. The
replacement (`mp.tasks.vision.FaceDetector`) needs an explicit `.tflite` model
on disk. We don't vendor it (it's a 224 KB binary); fetch it once:

```bash
python3 skills/autoviral/modules/assembly/scripts/smart_crop/download_model.py
```

This writes `~/.autoviral/models/blaze_face_short_range.tflite`. Idempotent —
re-running is a no-op.

Without this file, the face strategy logs a single warning to stderr and
returns `None`, so callers degrade to saliency / center. No code path crashes.

### Source

`https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite`

## Tests

```bash
bun run test:python
```

The face-positive test (`test_face_strategy_uses_mediapipe_tasks_api`) is
gated on `pytest.importorskip("mediapipe.tasks")` plus existence of the model
file, so CI without the download still passes.
