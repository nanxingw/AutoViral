# Phase 6 — Smart Crop + Platform Export Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land platform-aware export. Selecting a preset (e.g. 抖音 9:16) updates the composition's output dimensions / fps / export profile and — on user confirmation — reframes every existing video clip via a Python smart-crop pipeline (mediapipe face tracking → cv2 saliency → center-of-mass fallback). The render pipeline then honours the preset's codec / video-bitrate / audio-bitrate when encoding the final MP4.

**Architecture:** The smart-crop work runs as Python scripts (mediapipe / OpenCV) under `skills/autoviral/modules/assembly/scripts/smart_crop/`, invoked from the Node server through a new thin `child_process.spawn` bridge that parses stdout-JSON. A new `POST /api/video/reframe` endpoint orchestrates the two-stage pipeline (saliency → crop_9_16) and registers the reframed asset plus a `reframe`-typed provenance edge. The Studio Tweaks panel grows a new **Platform Preset** section with a confirmation dialog that lists every clip about to be reframed; on confirm, a single zustand transaction updates `comp.exportPresets[0]` plus `width / height / fps / aspect` and fires off-thread reframes for each video clip. The Phase 3 render pipeline replaces its rename-stub encode stage with a real ffmpeg encode pass driven by `comp.exportPresets[0]`.

**Tech Stack:**
- Python 3.11 with `mediapipe`, `opencv-python`, `numpy` (installed via `uv pip install -r requirements.txt`)
- ffmpeg 8.1 (already present, libx264/libx265 confirmed)
- Node side: `child_process.spawn` (no new npm deps), Hono routes, Zod schemas (existing `ExportPresetSchema` is already complete — no schema change in Phase 6)
- Frontend: existing React 18 + TypeScript + zustand. No new web deps.
- Tests: `pytest` for Python (introduces `skills/autoviral/pytest.ini`), Vitest + Testing Library for web/server.

---

## 0. Locked decisions (D1–D5)

Locked 2026-05-06 (this conversation). **Do not re-litigate.** Each task below cites the Dn it consumes.

| # | Decision | Lands in |
|---|---|---|
| **D1** | Python deps live in `skills/autoviral/modules/assembly/scripts/smart_crop/requirements.txt` (`mediapipe`, `opencv-python`, `numpy`). Install via `uv pip install -r`. **No** repo-wide pyproject.toml; AutoViral keeps Python deps local to each pipeline script for now. | 6.A |
| **D2** | Smart-crop strategy ladder = `face` (mediapipe FaceDetection) → `saliency` (cv2 BackgroundSubtractor / contours) → `center` (no deps). Default = `face`. If mediapipe import fails or 0 faces are detected for the clip, fall back to `saliency`. If saliency is degenerate (no significant motion / contour areas under threshold), fall back to `center`. | 6.A `strategies.py` |
| **D3** | Selecting a platform preset opens a confirmation modal listing every video clip that would be reframed. **On confirm**: reframe ALL listed clips in one transaction. **On cancel**: only update the preset (keep `comp.aspect` / `width` / `height`), leave clips alone. | 6.D `ReframeConfirmDialog.tsx` |
| **D4** | Reframe output naming extends `buildSafeOutputFilename` from `src/server/remotion-renderer.ts`: format = `<safeTitle>__9x16__<strategy>__<ISO>.mp4`. The strategy segment ("face" / "saliency" / "center") is the actual strategy used by the script (after fallbacks), not the requested one — recorded for traceability and surfaced on the provenance edge. | 6.A `crop_9_16.py`, 6.C `/api/video/reframe` |
| **D5** | Preset application is a single zustand transaction: updates `comp.exportPresets[0]` AND `comp.width` / `comp.height` / `comp.fps` / `comp.aspect` atomically. No partial state where exportPresets refer to one platform while dimensions still match another. | 6.D `applyPlatformPreset` action |

---

## 1. File Structure

```
skills/autoviral/
├── pytest.ini                                           ← NEW (6.A) — pytest discovery for Phase 6 onwards
└── modules/assembly/
    ├── scripts/
    │   └── smart_crop/                                  ← NEW (6.A / 6.B)
    │       ├── requirements.txt                         ← 6.A — mediapipe / opencv-python / numpy
    │       ├── strategies.py                            ← 6.A — face / saliency / center dispatcher
    │       ├── saliency.py                              ← 6.A — per-second ROI computation CLI
    │       ├── crop_9_16.py                             ← 6.B — ffmpeg crop+scale CLI (consumes ROI list)
    │       └── __tests__/
    │           ├── test_strategies.py                   ← 6.A unit tests
    │           ├── test_saliency.py                     ← 6.A unit tests
    │           └── test_crop_9_16.py                    ← 6.B unit tests
    └── references/
        └── platform-specs.md                            ← NEW (6.D) — full preset table + safe zones

src/server/
├── python-bridge.ts                                     ← NEW (6.C) — thin spawn wrapper, stdout-JSON
├── python-bridge.test.ts                                ← NEW (6.C) — unit tests with vi.mock
├── api.ts                                               ← MODIFY (6.C) — POST /api/video/reframe
├── api.reframe.test.ts                                  ← NEW (6.C) — endpoint tests
├── render-pipeline.ts                                   ← MODIFY (6.E) — replace rename-stub with ffmpeg encode
└── render-pipeline.test.ts                              ← MODIFY (6.E) — add encode-stage assertions

web/src/features/studio/
├── store.ts                                             ← MODIFY (6.D) — add applyPlatformPreset action
├── __tests__/store.test.ts                              ← MODIFY (6.D) — applyPlatformPreset tests
├── panels/Tweaks/
│   ├── PlatformPresetSection.tsx                        ← NEW (6.D) — dropdown + confirm flow
│   ├── PlatformPresetSection.test.tsx                   ← NEW (6.D)
│   ├── ReframeConfirmDialog.tsx                         ← NEW (6.D)
│   ├── ReframeConfirmDialog.test.tsx                    ← NEW (6.D)
│   └── index.tsx                                        ← MODIFY (6.D) — mount new section
└── __tests__/
    └── phase6-integration.test.tsx                      ← NEW (6.F) — AC1+AC2 end-to-end

package.json                                             ← MODIFY (6.A) — add `test:python` script
```

---

## 2. Conventions for this plan

- **TDD**: every code change starts with a failing test. Run the test, see it fail with the *expected* error message, then write the minimal code to make it pass.
- **Commands**:
  - Web suite: `bun run test:web` (one-shot — never use `:watch` per repo `<testing>` block)
  - Server suite: `bun run test:server`
  - Python suite: `bun run test:python` (new in 6.A — wraps `python3 -m pytest skills/autoviral`)
  - Type-check: `bun run typecheck`
  - Single Python test: `python3 -m pytest skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_saliency.py -v`
  - Run from repo root: `/Users/nanjiayan/Desktop/AutoViral/autoviral`
- **Python testing**:
  - All Python tests use `pytest` and live in `__tests__/test_*.py` next to the script under test.
  - Synthetic video fixtures are generated in a per-test `tmp_path` directory using `ffmpeg -f lavfi -i testsrc=duration=2:size=1920x1080:rate=30 -f lavfi -i sine=frequency=1000:duration=2 -shortest -pix_fmt yuv420p out.mp4`. **Never check binary fixtures into git.**
  - mediapipe is heavy and may hit transient downloads during model load — for unit tests we either (a) seed a known face fixture or (b) mock mediapipe inputs via `monkeypatch`. Integration tests that genuinely run mediapipe are gated under `@pytest.mark.integration` and excluded from default runs.
- **Server testing**: server tests use `vi.mock` to stub `child_process.spawn` so vitest never actually runs Python or ffmpeg. The bridge contract (stdout-JSON, non-zero exit → reject) is locked, so mocks replace it exactly.
- **Commits**: bite-sized — usually one commit per Step group inside a Task. Use the message style of prior phases: `feat(scope): summary (Phase 6.X)` or `test(scope): summary (Phase 6.X)`. Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` if running interactively.
- **Imports**: project uses `@/` alias for `web/src/`. Server-side uses relative imports.

---

## Task 6.A — Python smart-crop saliency + strategies + pytest scaffolding

**Goal:** Land the Python foundation. After this task, a clip-relative ROI list (per second) can be computed via `python3 saliency.py --input <video> --output <json> --strategy face|saliency|center|auto`, and `pytest` recognises the `skills/autoviral` tree.

**Pitfalls:**
- `mediapipe` for Python 3.11 ships separate wheels for Apple Silicon vs Intel. If `pip install` resolves to a wheel that segfaults on import, document `pip install mediapipe-silicon` as the macOS fallback in `requirements.txt` comment.
- The model file (`face_detection_short_range.tflite`) is downloaded on first import. CI/dev hosts behind a firewall need `MEDIAPIPE_DISABLE_GPU=1` and may pre-cache via `mediapipe_face_detection.FaceDetection()`.
- Saliency strategy is **not** OpenCV's `cv2.saliency` (it requires `opencv-contrib-python`, which the project does not install). We use a lightweight foreground-mass approach: BackgroundSubtractorMOG2 across consecutive frames → `cv2.findContours` on the mask → bounding box of the largest contour cluster.
- ROI smoothing: rolling mean window of 15 ROI samples (= 0.5 s at 30 fps) — small jitters are expected; large jumps need to be smoothed by the consumer (`crop_9_16.py`), not the producer.
- pytest config: a project-level `skills/autoviral/pytest.ini` is enough; do not create a top-level pytest config that fights with vitest.

**Files:**
- Create: `skills/autoviral/pytest.ini`
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/requirements.txt`
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/strategies.py`
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/saliency.py`
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/__init__.py` (empty — pytest collection hint)
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_strategies.py`
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_saliency.py`
- Modify: `package.json` — add `"test:python": "python3 -m pytest skills/autoviral"`

### Step 1: pytest scaffolding + requirements + dep install

- [ ] **Step 1.1: Create `skills/autoviral/pytest.ini`**

```ini
[pytest]
testpaths = modules
python_files = test_*.py
python_classes = Test*
python_functions = test_*
markers =
    integration: tests that exercise real mediapipe / ffmpeg pipelines (excluded from default runs)
addopts = -ra --strict-markers -m "not integration"
```

- [ ] **Step 1.2: Create `skills/autoviral/modules/assembly/scripts/smart_crop/requirements.txt`**

```text
# Phase 6 smart-crop dependencies. Install with:
#   uv pip install -r skills/autoviral/modules/assembly/scripts/smart_crop/requirements.txt
#
# Apple Silicon: if `mediapipe` segfaults on import, replace with `mediapipe-silicon`.
# Linux CI behind a firewall: pre-warm the FaceDetection model cache before running tests.
mediapipe>=0.10.13
opencv-python>=4.10.0
numpy>=1.26.0
```

- [ ] **Step 1.3: Add `test:python` script to `package.json`**

Edit the `"scripts"` block — insert after `"test:server:watch"`:

```json
    "test:python": "python3 -m pytest skills/autoviral",
```

- [ ] **Step 1.4: Install Python deps into the workstation environment**

Run:

```bash
cd /Users/nanjiayan/Desktop/AutoViral/autoviral
uv pip install -r skills/autoviral/modules/assembly/scripts/smart_crop/requirements.txt
```

Expected: deps install cleanly. If `uv` is not available, fall back to `python3 -m pip install -r ...`.

- [ ] **Step 1.5: Sanity-check the imports**

```bash
python3 -c "import mediapipe; import cv2; import numpy as np; print(mediapipe.__version__, cv2.__version__, np.__version__)"
```

Expected: prints three version strings. If `mediapipe` import fails on macOS, see Step 1.2's note about `mediapipe-silicon`.

- [ ] **Step 1.6: Commit**

```bash
git add skills/autoviral/pytest.ini skills/autoviral/modules/assembly/scripts/smart_crop/requirements.txt package.json
git commit -m "$(cat <<'EOF'
chore(phase-6): pytest config + smart-crop requirements (Phase 6.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 2: `strategies.py` — TDD

The strategy module owns the dispatcher: given a video frame (numpy ndarray BGR) and a strategy name, return an `(x, y, w, h)` ROI in source pixel coordinates. It also implements `auto_strategy_for_video(video_path) -> str` which probes the first ~30 frames to decide between `face` / `saliency` / `center` per D2.

- [ ] **Step 2.1: Create `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/__init__.py`** (empty)

```python
```

- [ ] **Step 2.2: Create `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_strategies.py`**

```python
"""Unit tests for strategies.py — focuses on dispatch + center fallback.

Face strategy needs mediapipe; saliency strategy needs cv2.BackgroundSubtractor.
We exercise both end-to-end via a synthetic fixture (a moving white square on a
black background — no real face). The face strategy is expected to find no
faces and return None, which the dispatcher then falls back to saliency, and
finally to center for a uniform-frame edge case.
"""

from __future__ import annotations

import pathlib
import subprocess

import numpy as np
import pytest

from skills.autoviral.modules.assembly.scripts.smart_crop import strategies


def _make_synth_video(tmp_path: pathlib.Path, duration: int = 2) -> pathlib.Path:
    """Generate a 1920x1080@30fps test video using ffmpeg lavfi."""
    out = tmp_path / "synth.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc=duration={duration}:size=1920x1080:rate=30",
            "-pix_fmt", "yuv420p", str(out),
        ],
        check=True,
    )
    return out


def test_center_strategy_returns_centered_roi():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    roi = strategies.compute_roi(frame, strategy="center", target_aspect=(9, 16))
    # 9:16 ROI of a 1920x1080 source with center anchor:
    #   target_w = 1080 * 9/16 = 607.5 → 607 (floor)
    #   roi.x = (1920 - 607) // 2 = 656
    #   roi.y = 0, roi.h = 1080
    assert roi.h == 1080
    assert roi.w == 607
    assert 650 <= roi.x <= 660
    assert roi.y == 0


def test_center_strategy_for_1_to_1():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    roi = strategies.compute_roi(frame, strategy="center", target_aspect=(1, 1))
    # Target 1:1, source 16:9 → square crop = 1080x1080 centered.
    assert roi.w == 1080
    assert roi.h == 1080
    assert 419 <= roi.x <= 421
    assert roi.y == 0


def test_face_strategy_returns_none_on_face_free_frame():
    """No face in the frame → strategy returns None (caller falls back)."""
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    roi = strategies.compute_roi(frame, strategy="face", target_aspect=(9, 16))
    assert roi is None


def test_saliency_strategy_returns_roi_when_motion_present(tmp_path):
    """Synthesise a tiny motion clip and feed two frames to the saliency
    strategy via its stateful API."""
    state = strategies.SaliencyState()
    a = np.zeros((1080, 1920, 3), dtype=np.uint8)
    b = a.copy()
    b[400:600, 800:1000] = 255  # bright square appears
    strategies.saliency_step(state, a)
    roi = strategies.saliency_step(state, b, target_aspect=(9, 16))
    assert roi is not None
    # Saliency centres on the bright square's centroid (~900, 500).
    assert 800 <= (roi.x + roi.w // 2) <= 1000


def test_auto_strategy_picks_center_when_video_is_uniform(tmp_path):
    """testsrc has lots of motion + colour bars but no faces → auto should
    choose 'saliency' (or 'center' if saliency mass is degenerate)."""
    video = _make_synth_video(tmp_path)
    chosen = strategies.auto_strategy_for_video(str(video))
    assert chosen in {"saliency", "center"}


def test_compute_roi_with_unknown_strategy_raises():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    with pytest.raises(ValueError, match="unknown strategy"):
        strategies.compute_roi(frame, strategy="bogus", target_aspect=(9, 16))
```

- [ ] **Step 2.3: Run the failing tests**

```bash
python3 -m pytest skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_strategies.py -v
```

Expected: collection error or import error — `strategies` module does not exist yet.

- [ ] **Step 2.4: Create `skills/autoviral/modules/assembly/scripts/smart_crop/strategies.py`**

```python
"""Smart-crop strategy dispatcher.

Three strategies (per Phase 6 D2):
    "face"     — mediapipe FaceDetection; returns ROI around the largest face,
                 padded to the target aspect. None if no face detected.
    "saliency" — cv2.BackgroundSubtractorMOG2 across frames; ROI follows the
                 largest motion contour. Stateful — call saliency_step() per
                 frame in order. Returns None on the first frame (no diff).
    "center"   — fixed center crop, no deps. Always returns an ROI.

`auto_strategy_for_video()` probes the first ~30 frames and picks one:
  faces detected → "face"
  no faces but saliency mass > threshold → "saliency"
  otherwise → "center"

Public types:
    Roi(x, y, w, h)             — top-left + size, source pixels (ints)
    SaliencyState               — opaque per-clip state for saliency_step()
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple

import numpy as np

try:
    import cv2  # type: ignore[import]
except ImportError as exc:  # pragma: no cover — defensive
    raise RuntimeError("opencv-python is required for smart_crop.strategies") from exc

try:
    import mediapipe as mp  # type: ignore[import]
    _MEDIAPIPE_OK = True
except Exception:  # pragma: no cover — environment-dependent
    mp = None  # type: ignore[assignment]
    _MEDIAPIPE_OK = False


@dataclass
class Roi:
    x: int
    y: int
    w: int
    h: int

    def as_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


@dataclass
class SaliencyState:
    subtractor: object = field(default=None)


def _target_size(frame_shape: Tuple[int, int], target_aspect: Tuple[int, int]) -> Tuple[int, int]:
    """Compute (w, h) of the target ROI inside a frame_shape (H, W) source."""
    h, w = frame_shape
    aw, ah = target_aspect
    # Try height-bound first.
    cand_w = int(h * aw / ah)
    if cand_w <= w:
        return cand_w, h
    # Otherwise width-bound.
    cand_h = int(w * ah / aw)
    return w, cand_h


def _clamp_roi(x: int, y: int, w: int, h: int, frame_w: int, frame_h: int) -> Roi:
    x = max(0, min(x, frame_w - w))
    y = max(0, min(y, frame_h - h))
    return Roi(x=int(x), y=int(y), w=int(w), h=int(h))


def _center_roi(frame: np.ndarray, target_aspect: Tuple[int, int]) -> Roi:
    h, w = frame.shape[:2]
    tw, th = _target_size((h, w), target_aspect)
    return _clamp_roi((w - tw) // 2, (h - th) // 2, tw, th, w, h)


def _face_roi(frame: np.ndarray, target_aspect: Tuple[int, int]) -> Optional[Roi]:
    if not _MEDIAPIPE_OK:
        return None
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    with mp.solutions.face_detection.FaceDetection(model_selection=0, min_detection_confidence=0.5) as fd:
        result = fd.process(rgb)
    if not result.detections:
        return None
    # Pick the largest detection by relative bbox area.
    largest = max(
        result.detections,
        key=lambda d: d.location_data.relative_bounding_box.width
        * d.location_data.relative_bounding_box.height,
    )
    bb = largest.location_data.relative_bounding_box
    cx = (bb.xmin + bb.width / 2) * w
    cy = (bb.ymin + bb.height / 2) * h
    tw, th = _target_size((h, w), target_aspect)
    return _clamp_roi(int(cx - tw / 2), int(cy - th / 2), tw, th, w, h)


def saliency_step(state: SaliencyState, frame: np.ndarray, *, target_aspect: Tuple[int, int] = (9, 16)) -> Optional[Roi]:
    """Stateful per-frame saliency. Returns None for the first frame."""
    if state.subtractor is None:
        state.subtractor = cv2.createBackgroundSubtractorMOG2(history=30, varThreshold=25, detectShadows=False)
        state.subtractor.apply(frame)  # type: ignore[union-attr]
        return None
    mask = state.subtractor.apply(frame)  # type: ignore[union-attr]
    # Threshold + dilate to consolidate.
    _, thresh = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)
    thresh = cv2.dilate(thresh, np.ones((5, 5), np.uint8), iterations=2)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(biggest) < 50:  # degenerate
        return None
    M = cv2.moments(biggest)
    if M["m00"] == 0:
        return None
    cx = int(M["m10"] / M["m00"])
    cy = int(M["m01"] / M["m00"])
    h, w = frame.shape[:2]
    tw, th = _target_size((h, w), target_aspect)
    return _clamp_roi(cx - tw // 2, cy - th // 2, tw, th, w, h)


def compute_roi(
    frame: np.ndarray,
    *,
    strategy: str,
    target_aspect: Tuple[int, int],
    saliency_state: Optional[SaliencyState] = None,
) -> Optional[Roi]:
    """Single-frame entry point used by tests and one-shot callers."""
    if strategy == "center":
        return _center_roi(frame, target_aspect)
    if strategy == "face":
        return _face_roi(frame, target_aspect)
    if strategy == "saliency":
        state = saliency_state or SaliencyState()
        return saliency_step(state, frame, target_aspect=target_aspect)
    raise ValueError(f"unknown strategy: {strategy!r}")


def auto_strategy_for_video(video_path: str, *, probe_frames: int = 30) -> str:
    """Probe the first `probe_frames` frames and pick a strategy per D2."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return "center"
    state = SaliencyState()
    saw_face = False
    saw_saliency = False
    try:
        for _ in range(probe_frames):
            ok, frame = cap.read()
            if not ok:
                break
            if not saw_face and _face_roi(frame, target_aspect=(9, 16)) is not None:
                saw_face = True
            roi = saliency_step(state, frame, target_aspect=(9, 16))
            if roi is not None:
                saw_saliency = True
    finally:
        cap.release()
    if saw_face:
        return "face"
    if saw_saliency:
        return "saliency"
    return "center"
```

- [ ] **Step 2.5: Run the tests — expect all 6 PASS**

```bash
python3 -m pytest skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_strategies.py -v
```

Expected: 6 PASS. If `test_face_strategy_returns_none_on_face_free_frame` fails because mediapipe could not download its model in the test environment, gate it with `pytest.importorskip("mediapipe")` and document the limitation.

- [ ] **Step 2.6: Commit**

```bash
git add skills/autoviral/modules/assembly/scripts/smart_crop/strategies.py skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/__init__.py skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_strategies.py
git commit -m "$(cat <<'EOF'
feat(smart-crop): strategies dispatcher + face/saliency/center (Phase 6.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 3: `saliency.py` CLI — TDD

`saliency.py` is the Python entry point that walks an entire video and emits a JSON document:

```json
{
  "video": "/abs/path/to/input.mp4",
  "frames": 60,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "strategy_requested": "auto",
  "strategy_used": "saliency",
  "rois": [
    {"t": 0.0, "x": 656, "y": 0, "w": 607, "h": 1080},
    {"t": 1.0, "x": 700, "y": 0, "w": 607, "h": 1080}
  ]
}
```

Per-second sampling (one ROI per second of source video) keeps the JSON small; `crop_9_16.py` interpolates between samples.

- [ ] **Step 3.1: Create `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_saliency.py`**

```python
"""Tests for saliency.py CLI — runs end-to-end against a synthetic fixture."""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys


def _make_synth_video(tmp_path: pathlib.Path, duration: int = 2) -> pathlib.Path:
    out = tmp_path / "synth.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc=duration={duration}:size=1920x1080:rate=30",
            "-pix_fmt", "yuv420p", str(out),
        ],
        check=True,
    )
    return out


def test_saliency_cli_emits_valid_json(tmp_path):
    video = _make_synth_video(tmp_path)
    out_json = tmp_path / "rois.json"
    script = pathlib.Path(__file__).parent.parent / "saliency.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--input", str(video),
         "--output", str(out_json),
         "--strategy", "center",
         "--target-aspect", "9:16"],
        capture_output=True, text=True, check=True,
    )
    # Script writes the JSON to --output AND echoes the same payload to stdout.
    payload = json.loads(result.stdout)
    on_disk = json.loads(out_json.read_text())
    assert payload == on_disk
    assert payload["width"] == 1920
    assert payload["height"] == 1080
    assert payload["strategy_used"] == "center"
    assert payload["strategy_requested"] == "center"
    assert len(payload["rois"]) >= 2  # 2s @ 1 sample/s + start sample
    for roi in payload["rois"]:
        assert {"t", "x", "y", "w", "h"} <= roi.keys()
        assert roi["w"] == 607
        assert roi["h"] == 1080


def test_saliency_cli_auto_strategy_picks_center_for_uniform_video(tmp_path):
    """testsrc has motion but no faces — auto picks saliency or center."""
    video = _make_synth_video(tmp_path)
    out_json = tmp_path / "rois.json"
    script = pathlib.Path(__file__).parent.parent / "saliency.py"
    subprocess.run(
        [sys.executable, str(script),
         "--input", str(video),
         "--output", str(out_json),
         "--strategy", "auto",
         "--target-aspect", "9:16"],
        check=True,
    )
    payload = json.loads(out_json.read_text())
    assert payload["strategy_used"] in {"saliency", "center"}
    assert payload["strategy_requested"] == "auto"


def test_saliency_cli_rejects_invalid_strategy(tmp_path):
    video = _make_synth_video(tmp_path)
    out_json = tmp_path / "rois.json"
    script = pathlib.Path(__file__).parent.parent / "saliency.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--input", str(video),
         "--output", str(out_json),
         "--strategy", "bogus",
         "--target-aspect", "9:16"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0


def test_saliency_cli_rejects_invalid_aspect(tmp_path):
    video = _make_synth_video(tmp_path)
    out_json = tmp_path / "rois.json"
    script = pathlib.Path(__file__).parent.parent / "saliency.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--input", str(video),
         "--output", str(out_json),
         "--strategy", "center",
         "--target-aspect", "totally-bogus"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
```

- [ ] **Step 3.2: Run — expect failures (script does not exist)**

```bash
python3 -m pytest skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_saliency.py -v
```

- [ ] **Step 3.3: Create `skills/autoviral/modules/assembly/scripts/smart_crop/saliency.py`**

```python
#!/usr/bin/env python3
"""Compute per-second smart-crop ROIs for a video.

Usage:
    python3 saliency.py --input <video> --output <rois.json> \\
        --strategy face|saliency|center|auto --target-aspect 9:16

Output (also echoed to stdout for the python-bridge contract):
    {
      "video": "...",
      "frames": <int>,
      "fps": <float>,
      "width": <int>,
      "height": <int>,
      "strategy_requested": "<requested>",
      "strategy_used": "<actual after fallbacks>",
      "rois": [{"t": <sec>, "x": <int>, "y": <int>, "w": <int>, "h": <int>}, ...]
    }

The CLI is the contract surface for src/server/python-bridge.ts. STDOUT is
strict JSON; diagnostics go to STDERR. Non-zero exit on validation errors.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Tuple

import cv2  # type: ignore[import]

# Allow `python3 path/to/saliency.py` to import its sibling module.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from smart_crop import strategies  # type: ignore[import]


VALID_STRATEGIES = {"face", "saliency", "center", "auto"}


def _parse_aspect(s: str) -> Tuple[int, int]:
    parts = s.split(":")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"target-aspect must be W:H, got {s!r}")
    try:
        a, b = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"target-aspect must be W:H ints, got {s!r}") from exc
    if a <= 0 or b <= 0:
        raise argparse.ArgumentTypeError(f"target-aspect must be positive, got {s!r}")
    return a, b


def _resolve_strategy(requested: str, video_path: str) -> str:
    if requested == "auto":
        return strategies.auto_strategy_for_video(video_path)
    return requested


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--strategy", default="auto", choices=sorted(VALID_STRATEGIES))
    p.add_argument("--target-aspect", required=True, type=_parse_aspect)
    p.add_argument("--samples-per-sec", type=float, default=1.0,
                   help="ROI sample rate. Default 1.0 = one ROI per source second.")
    args = p.parse_args()

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        print(f"saliency.py: cannot open {args.input}", file=sys.stderr)
        return 2
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    sample_period = max(1, int(round(fps / args.samples_per_sec)))

    strategy_used = _resolve_strategy(args.strategy, args.input)
    state = strategies.SaliencyState()
    rois: list[dict] = []
    frame_idx = 0
    last_roi: strategies.Roi | None = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if strategy_used == "saliency":
            # Step every frame to keep the BG subtractor warm; only emit on cadence.
            roi = strategies.saliency_step(state, frame, target_aspect=args.target_aspect)
        elif strategy_used == "face":
            roi = strategies.compute_roi(frame, strategy="face", target_aspect=args.target_aspect)
            if roi is None:
                # Per-frame face miss → degrade silently to last good ROI; if
                # never had one, use center for this frame.
                roi = last_roi or strategies._center_roi(frame, args.target_aspect)
        else:  # center
            roi = strategies._center_roi(frame, args.target_aspect)

        if frame_idx % sample_period == 0 and roi is not None:
            t = frame_idx / fps
            rois.append({"t": round(t, 3), **roi.as_dict()})
            last_roi = roi
        elif roi is not None:
            last_roi = roi
        frame_idx += 1

    cap.release()

    # If saliency produced nothing (degenerate), fall back to center per D2.
    if not rois:
        # One ROI is enough for crop_9_16 to interpolate from.
        cap2 = cv2.VideoCapture(args.input)
        ok, frame = cap2.read()
        cap2.release()
        if ok:
            center = strategies._center_roi(frame, args.target_aspect)
            rois = [{"t": 0.0, **center.as_dict()}]
            strategy_used = "center"

    payload = {
        "video": str(pathlib.Path(args.input).resolve()),
        "frames": total_frames,
        "fps": fps,
        "width": width,
        "height": height,
        "strategy_requested": args.strategy,
        "strategy_used": strategy_used,
        "rois": rois,
    }
    pathlib.Path(args.output).write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload))  # stdout contract for python-bridge
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3.4: Run the saliency tests — expect 4 PASS**

```bash
python3 -m pytest skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_saliency.py -v
```

Expected: 4 PASS.

- [ ] **Step 3.5: Run the full Python suite as a regression gate**

```bash
bun run test:python
```

Expected: 10 PASS (6 strategies + 4 saliency).

- [ ] **Step 3.6: Commit**

```bash
git add skills/autoviral/modules/assembly/scripts/smart_crop/saliency.py skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_saliency.py
git commit -m "$(cat <<'EOF'
feat(smart-crop): saliency.py CLI — per-second ROI extraction (Phase 6.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6.B — `crop_9_16.py` ffmpeg crop+scale CLI

**Goal:** Consume the ROI list emitted by `saliency.py` and produce a cropped MP4 with the target aspect. ROI samples are smoothed by a rolling mean (window=15 ROI samples; configurable via `--smooth-window`); per-frame ROI is interpolated linearly between samples and rendered via ffmpeg's `crop=W:H:'X':'Y'` filter graph.

**Pitfalls:**
- ffmpeg's `crop` filter accepts `eif()` expressions but not arbitrary callables. Two strategies are viable: (a) compute per-frame `(x, y)` in Python, build a `sendcmd`-style filter graph, or (b) split the input into N segments where each segment has constant ROI and concat. We choose (a) because it's a single ffmpeg invocation. The expression uses `between(t, t0, t1)` selectors.
- Output dimensions: target = `(target_h * aw / ah, target_h)` using a height-bound crop. After crop we always `scale=` to the canonical preset resolution (1080×1920 for 9:16, 1080×1080 for 1:1, etc) so downstream encoders get a fixed dimension regardless of source size.
- Long videos: an expression with 1000+ `between()` clauses can exceed ffmpeg's expression length limits. We chunk: at most 200 ROI segments per `crop` filter; longer clips re-emit a fresh `crop` per segment via the segment-concat path.
- Audio: the audio stream is passed through unmodified (`-c:a copy`).
- Output filename: caller provides `--output`; `saliency.py` already encodes the `<safeTitle>__9x16__<strategy>__<ISO>.mp4` convention (D4) so this script does not invent the name.

**Files:**
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/crop_9_16.py`
- Create: `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_crop_9_16.py`

### Step 1: TDD — failing tests for crop_9_16

- [ ] **Step 1.1: Create `skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_crop_9_16.py`**

```python
"""crop_9_16.py — end-to-end test against a synthetic 1920x1080 fixture.

We build the ROI JSON file with one center ROI, run the script, and probe the
output MP4 with ffprobe to confirm dimensions + duration.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys


def _make_synth_video(tmp_path: pathlib.Path, duration: int = 2) -> pathlib.Path:
    out = tmp_path / "synth.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"testsrc=duration={duration}:size=1920x1080:rate=30",
            "-f", "lavfi", "-i", f"sine=frequency=1000:duration={duration}",
            "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", "-c:v", "libx264",
            str(out),
        ],
        check=True,
    )
    return out


def _ffprobe(path: pathlib.Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def test_crop_9_16_produces_1080x1920_output(tmp_path):
    video = _make_synth_video(tmp_path)
    rois_path = tmp_path / "rois.json"
    rois_path.write_text(json.dumps({
        "video": str(video),
        "frames": 60, "fps": 30.0,
        "width": 1920, "height": 1080,
        "strategy_requested": "center", "strategy_used": "center",
        "rois": [
            {"t": 0.0, "x": 656, "y": 0, "w": 607, "h": 1080},
            {"t": 1.0, "x": 656, "y": 0, "w": 607, "h": 1080},
        ],
    }))
    output = tmp_path / "out.mp4"
    script = pathlib.Path(__file__).parent.parent / "crop_9_16.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--input", str(video),
         "--rois", str(rois_path),
         "--output", str(output),
         "--target-resolution", "1080x1920"],
        capture_output=True, text=True, check=True,
    )
    payload = json.loads(result.stdout)
    assert payload["output"] == str(output.resolve())
    probe = _ffprobe(output)
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert v["width"] == 1080
    assert v["height"] == 1920
    # Audio stream survives.
    assert any(s["codec_type"] == "audio" for s in probe["streams"])


def test_crop_9_16_smooths_roi_jitter(tmp_path):
    """ROI sequence with a 1-frame jitter at t=0.5s → output dimensions are
    still 1080x1920 (smoothing prevents ffmpeg crop overflow)."""
    video = _make_synth_video(tmp_path)
    rois_path = tmp_path / "rois.json"
    rois_path.write_text(json.dumps({
        "video": str(video),
        "frames": 60, "fps": 30.0,
        "width": 1920, "height": 1080,
        "strategy_requested": "saliency", "strategy_used": "saliency",
        "rois": [
            {"t": 0.0, "x": 656, "y": 0, "w": 607, "h": 1080},
            {"t": 0.5, "x": 1100, "y": 0, "w": 607, "h": 1080},  # jitter
            {"t": 1.0, "x": 656, "y": 0, "w": 607, "h": 1080},
            {"t": 1.5, "x": 656, "y": 0, "w": 607, "h": 1080},
        ],
    }))
    output = tmp_path / "out.mp4"
    script = pathlib.Path(__file__).parent.parent / "crop_9_16.py"
    subprocess.run(
        [sys.executable, str(script),
         "--input", str(video),
         "--rois", str(rois_path),
         "--output", str(output),
         "--target-resolution", "1080x1920",
         "--smooth-window", "3"],
        capture_output=True, text=True, check=True,
    )
    probe = _ffprobe(output)
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert v["width"] == 1080
    assert v["height"] == 1920


def test_crop_9_16_rejects_empty_roi_list(tmp_path):
    video = _make_synth_video(tmp_path)
    rois_path = tmp_path / "rois.json"
    rois_path.write_text(json.dumps({
        "video": str(video), "frames": 0, "fps": 30.0,
        "width": 1920, "height": 1080,
        "strategy_requested": "center", "strategy_used": "center", "rois": [],
    }))
    script = pathlib.Path(__file__).parent.parent / "crop_9_16.py"
    result = subprocess.run(
        [sys.executable, str(script),
         "--input", str(video),
         "--rois", str(rois_path),
         "--output", str(tmp_path / "out.mp4"),
         "--target-resolution", "1080x1920"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "empty" in result.stderr.lower() or "no roi" in result.stderr.lower()
```

- [ ] **Step 1.2: Run — expect import / file-not-found errors (script missing)**

```bash
python3 -m pytest skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_crop_9_16.py -v
```

### Step 2: Implement `crop_9_16.py`

- [ ] **Step 2.1: Create `skills/autoviral/modules/assembly/scripts/smart_crop/crop_9_16.py`**

```python
#!/usr/bin/env python3
"""Crop a video to a target aspect using a per-second ROI list.

Usage:
    python3 crop_9_16.py --input <video> --rois <rois.json> \\
        --output <out.mp4> --target-resolution 1080x1920 [--smooth-window 15]

Algorithm:
    1. Read ROI samples from --rois.
    2. Smooth ROIs with a rolling-mean window (default 15).
    3. Build an ffmpeg `crop` filter expression with sendcmd-style segments —
       for each consecutive pair of ROI samples, emit a `between(t, t0, t1)*expr`
       term that linearly interpolates x/y/w/h.
    4. Append `scale=W:H` to land on the canonical target resolution.
    5. Pass audio through with -c:a copy.

Output JSON to stdout (python-bridge contract):
    {"output": "/abs/path", "duration": <sec>, "width": <int>, "height": <int>}
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
from typing import List, Sequence


def _smooth(values: Sequence[float], window: int) -> List[float]:
    if window <= 1 or len(values) <= 1:
        return list(values)
    out: List[float] = []
    half = window // 2
    for i in range(len(values)):
        lo = max(0, i - half)
        hi = min(len(values), i + half + 1)
        chunk = values[lo:hi]
        out.append(sum(chunk) / len(chunk))
    return out


def _build_crop_expr(rois: List[dict], smooth_window: int) -> tuple[str, str, int, int]:
    """Return (x_expr, y_expr, crop_w, crop_h)."""
    if not rois:
        raise ValueError("empty ROI list — saliency.py must always emit at least one")

    xs = _smooth([r["x"] for r in rois], smooth_window)
    ys = _smooth([r["y"] for r in rois], smooth_window)
    # ROI w/h are uniform per video (depend only on source dims + target aspect).
    crop_w = rois[0]["w"]
    crop_h = rois[0]["h"]

    if len(rois) == 1:
        return str(int(xs[0])), str(int(ys[0])), crop_w, crop_h

    # Build piecewise-linear expressions over time.
    # Result: between(t,t0,t1) * (x0 + (x1-x0)*((t-t0)/(t1-t0))) summed.
    x_terms: List[str] = []
    y_terms: List[str] = []
    for i in range(len(rois) - 1):
        t0 = rois[i]["t"]
        t1 = rois[i + 1]["t"]
        if t1 <= t0:
            continue
        dx = xs[i + 1] - xs[i]
        dy = ys[i + 1] - ys[i]
        x_terms.append(
            f"between(t,{t0:.4f},{t1:.4f})*({xs[i]:.2f}+{dx:.2f}*((t-{t0:.4f})/({t1 - t0:.4f})))"
        )
        y_terms.append(
            f"between(t,{t0:.4f},{t1:.4f})*({ys[i]:.2f}+{dy:.2f}*((t-{t0:.4f})/({t1 - t0:.4f})))"
        )
    # After the last sample, hold the final value.
    x_terms.append(f"gte(t,{rois[-1]['t']:.4f})*{xs[-1]:.2f}")
    y_terms.append(f"gte(t,{rois[-1]['t']:.4f})*{ys[-1]:.2f}")
    return "+".join(x_terms), "+".join(y_terms), crop_w, crop_h


def _parse_resolution(s: str) -> tuple[int, int]:
    parts = s.lower().split("x")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"target-resolution must be WxH, got {s!r}")
    return int(parts[0]), int(parts[1])


def main() -> int:
    if shutil.which("ffmpeg") is None:
        print("crop_9_16.py: ffmpeg not on PATH", file=sys.stderr)
        return 2

    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--rois", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--target-resolution", required=True, type=_parse_resolution)
    p.add_argument("--smooth-window", type=int, default=15)
    args = p.parse_args()

    rois_blob = json.loads(pathlib.Path(args.rois).read_text())
    rois = rois_blob.get("rois", [])
    if not rois:
        print("crop_9_16.py: empty ROI list — refusing to crop", file=sys.stderr)
        return 3

    target_w, target_h = args.target_resolution
    try:
        x_expr, y_expr, crop_w, crop_h = _build_crop_expr(rois, args.smooth_window)
    except ValueError as exc:
        print(f"crop_9_16.py: {exc}", file=sys.stderr)
        return 3

    filter_graph = (
        f"crop={crop_w}:{crop_h}:x='{x_expr}':y='{y_expr}',"
        f"scale={target_w}:{target_h}:flags=lanczos,setsar=1"
    )

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", args.input,
        "-vf", filter_graph,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "copy",
        "-movflags", "+faststart",
        args.output,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"crop_9_16.py: ffmpeg failed:\n{proc.stderr}", file=sys.stderr)
        return proc.returncode

    payload = {
        "output": str(pathlib.Path(args.output).resolve()),
        "width": target_w,
        "height": target_h,
        "strategy_used": rois_blob.get("strategy_used"),
    }
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2.2: Run the tests — expect 3 PASS**

```bash
python3 -m pytest skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_crop_9_16.py -v
```

Expected: 3 PASS. The two end-to-end tests each invoke ffmpeg twice (fixture build + crop) so allow ~10–15s wall time.

- [ ] **Step 2.3: Run the full Python suite**

```bash
bun run test:python
```

Expected: 13 PASS (6 strategies + 4 saliency + 3 crop_9_16).

- [ ] **Step 2.4: Commit**

```bash
git add skills/autoviral/modules/assembly/scripts/smart_crop/crop_9_16.py skills/autoviral/modules/assembly/scripts/smart_crop/__tests__/test_crop_9_16.py
git commit -m "$(cat <<'EOF'
feat(smart-crop): crop_9_16.py — ffmpeg crop+scale w/ ROI smoothing (Phase 6.B)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6.C — `python-bridge.ts` + `POST /api/video/reframe`

**Goal:** Bridge the Python smart-crop pipeline into the Node server. Two deliverables:

1. `python-bridge.ts` — a thin `child_process.spawn` wrapper exposing `runPythonScript(scriptPath, args, options): Promise<string>`. Resolves the JSON parsed from stdout; rejects on non-zero exit / timeout. Captures stderr for diagnostics. Default 60s timeout, configurable per call.
2. `/api/video/reframe` Hono route — accepts `{ workId, videoId, fromAspect, toAspect, strategy? }`, runs `saliency.py` then `crop_9_16.py` via the bridge, registers the new asset on the work's `composition.yaml`, and adds a `reframe`-typed provenance edge.

**Pitfalls:**
- `spawn` vs `execFile`: `spawn` for streamed stderr (long jobs); `execFile` for one-shots. We use `spawn` and accumulate stdout/stderr manually so timeout cancellation kills the child cleanly.
- stdout JSON contract: every Phase 6 Python script's last stdout line is the JSON payload. The bridge does `JSON.parse(stdout.trim())` — any logging Python wants to do must go to stderr. Document this in the bridge's header comment.
- Timeout cleanup: `child.kill('SIGKILL')` after timeout; resolve a `Promise<never>` with a "timed out" error including stderr-so-far.
- The reframe endpoint **does not block** on the actual ffmpeg work — it's slow (5–30s per clip). The route waits synchronously today (Phase 6 keeps it simple); Phase 7 introduces the queue and turns this into a background job. Document this.
- Asset registration: the new MP4 lands inside `<workDir>/assets/reframed/`. The endpoint adds an `AssetEntry` and a `ProvenanceEdge` whose `operation.type === "reframe"`, `params: { fromAspect, toAspect, strategyRequested, strategyUsed }`. The DAG must reflect: source video → reframed video.
- The `ProvenanceEdge.operation.type` enum currently includes "upload", "derive", "trim", "caption" (Phase 1). Phase 6 introduces `"reframe"`. Confirm the schema update by inspecting `src/shared/composition.ts` — if the enum is closed, extend it; if it's an open string, no change needed. **(Audit before writing tests; if a schema change is required, add it as a separate commit named `feat(schema): add 'reframe' provenance op (Phase 6.C)`.)**

**Files:**
- Create: `src/server/python-bridge.ts`
- Create: `src/server/python-bridge.test.ts`
- Modify: `src/server/api.ts` — add POST /api/video/reframe
- Create: `src/server/api.reframe.test.ts`
- Possibly modify: `src/shared/composition.ts` (only if `ProvenanceOpType` is a closed enum and lacks `"reframe"`)

### Step 1: `python-bridge.ts` — TDD

- [ ] **Step 1.1: Audit the ProvenanceEdge schema**

```bash
grep -n "ProvenanceEdge\|operation.*type\|reframe\|derive" /Users/nanjiayan/Desktop/AutoViral/autoviral/src/shared/composition.ts
```

If `operation.type` is an enum that does not include `"reframe"`, the engineer must add it — file a follow-up TODO inline if needed and add `"reframe"` to the enum. Commit that schema change as its own commit before continuing.

- [ ] **Step 1.2: Create `src/server/python-bridge.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { runPythonScript } from "./python-bridge";

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      // Test cases drive emit timing manually via __spawnHandle.
      (globalThis as any).__spawnHandle = proc;
      return proc;
    }),
  };
});

describe("runPythonScript", () => {
  beforeEach(() => {
    (globalThis as any).__spawnHandle = null;
  });

  it("resolves with parsed JSON when child exits 0", async () => {
    const promise = runPythonScript("/x.py", ["--a", "1"], { timeoutMs: 1000 });
    const proc = (globalThis as any).__spawnHandle;
    proc.stdout.emit("data", Buffer.from('{"hello":"world"}'));
    proc.emit("close", 0);
    const result = await promise;
    expect(result).toEqual({ hello: "world" });
  });

  it("rejects when child exits non-zero, including stderr in the error", async () => {
    const promise = runPythonScript("/x.py", [], { timeoutMs: 1000 });
    const proc = (globalThis as any).__spawnHandle;
    proc.stderr.emit("data", Buffer.from("boom: bad arg"));
    proc.emit("close", 2);
    await expect(promise).rejects.toThrow(/exit 2/);
    await expect(promise).rejects.toThrow(/boom: bad arg/);
  });

  it("rejects when stdout is not valid JSON", async () => {
    const promise = runPythonScript("/x.py", [], { timeoutMs: 1000 });
    const proc = (globalThis as any).__spawnHandle;
    proc.stdout.emit("data", Buffer.from("not json"));
    proc.emit("close", 0);
    await expect(promise).rejects.toThrow(/JSON/i);
  });

  it("rejects with timeout error and kills the child after timeoutMs", async () => {
    vi.useFakeTimers();
    const promise = runPythonScript("/x.py", [], { timeoutMs: 50 });
    const proc = (globalThis as any).__spawnHandle;
    vi.advanceTimersByTime(60);
    await expect(promise).rejects.toThrow(/timed out/i);
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });

  it("uses the last stdout line as the JSON payload (script may log earlier)", async () => {
    const promise = runPythonScript("/x.py", [], { timeoutMs: 1000 });
    const proc = (globalThis as any).__spawnHandle;
    proc.stdout.emit("data", Buffer.from('"intermediate diagnostic"\n'));
    proc.stdout.emit("data", Buffer.from('{"final":true}\n'));
    proc.emit("close", 0);
    expect(await promise).toEqual({ final: true });
  });
});
```

- [ ] **Step 1.3: Run — expect failures (module missing)**

```bash
bun run test:server -- src/server/python-bridge.test.ts
```

- [ ] **Step 1.4: Create `src/server/python-bridge.ts`**

```ts
// src/server/python-bridge.ts
//
// Thin wrapper around child_process.spawn for invoking Python smart-crop and
// other AutoViral pipeline scripts.
//
// Contract with the called script:
//   * stdout: the LAST non-empty line MUST be a JSON document. Anything before
//     that may be diagnostics, but parsers will discard it.
//   * stderr: free-form diagnostics. Captured for inclusion in error messages.
//   * exit code: 0 = success; non-zero = failure (rejection includes stderr).
//
// Default timeout 60s; configurable per-call. On timeout we SIGKILL the child
// and reject with a "timed out after Nms" Error whose `.cause` carries the
// stderr accumulated up to the kill.

import { spawn } from "node:child_process";

export interface RunPythonOptions {
  /** Milliseconds before SIGKILL. Default 60 000. */
  timeoutMs?: number;
  /** Override the Python binary. Default "python3". */
  python?: string;
  /** cwd for the spawned process. Default process.cwd(). */
  cwd?: string;
  /** Extra env vars merged on top of process.env. */
  env?: Record<string, string>;
}

export async function runPythonScript<T = unknown>(
  scriptPath: string,
  args: string[] = [],
  opts: RunPythonOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const python = opts.python ?? "python3";

  return new Promise<T>((resolve, reject) => {
    const child = spawn(python, [scriptPath, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts.env ?? {}) },
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* noop */ }
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer | string) => { stdout += b.toString(); });
    child.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });

    child.on("close", (code: number | null) => {
      clearTimeout(killTimer);
      if (timedOut) {
        const err = new Error(`runPythonScript: ${scriptPath} timed out after ${timeoutMs}ms`);
        (err as any).cause = stderr;
        reject(err);
        return;
      }
      if (code !== 0) {
        const err = new Error(`runPythonScript: ${scriptPath} exit ${code}\n${stderr}`);
        (err as any).cause = stderr;
        reject(err);
        return;
      }
      // Take the last non-empty line of stdout as the JSON payload.
      const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last) {
        reject(new Error(`runPythonScript: ${scriptPath} produced no stdout`));
        return;
      }
      try {
        resolve(JSON.parse(last) as T);
      } catch (e) {
        reject(new Error(
          `runPythonScript: ${scriptPath} stdout is not valid JSON: ${(e as Error).message}\nlast line: ${last}`,
        ));
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(killTimer);
      reject(err);
    });
  });
}
```

- [ ] **Step 1.5: Run — expect 5 PASS**

```bash
bun run test:server -- src/server/python-bridge.test.ts
```

Expected: 5 PASS.

- [ ] **Step 1.6: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 1.7: Commit**

```bash
git add src/server/python-bridge.ts src/server/python-bridge.test.ts
git commit -m "$(cat <<'EOF'
feat(server): python-bridge — spawn wrapper w/ stdout-JSON + 60s timeout (Phase 6.C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 2: `POST /api/video/reframe` — TDD

The endpoint flow:

1. Validate body via Zod: `{ workId, videoId, fromAspect, toAspect, strategy? }`.
2. Resolve the source video path under the work's assets dir; reject 404 if missing.
3. Build the `safeTitle` (from work title or composition title) and the output filename per D4: `<safeTitle>__9x16__<strategy>__<ISO>.mp4`. Reframe outputs land in `<workDir>/assets/reframed/`.
4. Run `saliency.py` → produces `rois.json` in a tmp dir.
5. Run `crop_9_16.py` with `--rois rois.json --output <reframed mp4>`.
6. Read the work's `composition.yaml`, append a new `AssetEntry` for the reframed file and a `ProvenanceEdge` `{ fromAssetId: videoId, toAssetId: <new>, operation: { type: "reframe", actor: "system", params: { fromAspect, toAspect, strategyRequested, strategyUsed } } }`. Persist.
7. Return `{ asset: <new entry>, edge: <new edge>, strategyUsed }`.

- [ ] **Step 2.1: Create `src/server/api.reframe.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRoutes } from "./api";

vi.mock("./python-bridge", () => ({
  runPythonScript: vi.fn(),
}));

vi.mock("./work-store", () => ({
  getWork: vi.fn(),
  getAssetPath: vi.fn(),
  // Other exports — the route only touches getWork + getAssetPath.
  listWorks: vi.fn(),
  createWork: vi.fn(),
  updateWork: vi.fn(),
  deleteWork: vi.fn(),
  listAssets: vi.fn(),
  saveWorkChat: vi.fn(),
}));

vi.mock("node:fs/promises", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(async () => undefined),
  };
});

import { runPythonScript } from "./python-bridge";
import { getWork, getAssetPath } from "./work-store";
import { readFile, writeFile } from "node:fs/promises";

const _runPython = runPythonScript as unknown as ReturnType<typeof vi.fn>;
const _getWork = getWork as unknown as ReturnType<typeof vi.fn>;
const _getAssetPath = getAssetPath as unknown as ReturnType<typeof vi.fn>;
const _readFile = readFile as unknown as ReturnType<typeof vi.fn>;
const _writeFile = writeFile as unknown as ReturnType<typeof vi.fn>;

const SAMPLE_COMPOSITION_YAML = `
id: c_w1
workId: w1
fps: 30
width: 1920
height: 1080
duration: 5
aspect: 16:9
tracks: []
updatedAt: "2026-05-06T00:00:00Z"
assets:
  - id: vid1
    uri: /api/works/w1/assets/source.mp4
    kind: video
    metadata: {}
    status: ready
provenance:
  - fromAssetId: null
    toAssetId: vid1
    operation:
      type: upload
      actor: user
      timestamp: "2026-05-06T00:00:00Z"
      params: {}
exportPresets: []
`;

describe("POST /api/video/reframe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _getWork.mockResolvedValue({ id: "w1", title: "demo" });
    _getAssetPath.mockResolvedValue("/abs/works/w1/assets/source.mp4");
    _readFile.mockResolvedValue(SAMPLE_COMPOSITION_YAML);
    _writeFile.mockResolvedValue(undefined);
    // saliency.py first, then crop_9_16.py.
    _runPython.mockResolvedValueOnce({
      video: "/abs/works/w1/assets/source.mp4",
      width: 1920, height: 1080, fps: 30,
      strategy_requested: "auto", strategy_used: "face",
      rois: [{ t: 0, x: 656, y: 0, w: 607, h: 1080 }],
    });
    _runPython.mockResolvedValueOnce({
      output: "/abs/works/w1/assets/reframed/demo__9x16__face__2026-05-06T00-00-00.mp4",
      width: 1080, height: 1920, strategy_used: "face",
    });
  });

  it("happy path: runs saliency + crop, registers asset + reframe edge", async () => {
    const res = await apiRoutes.request("/api/video/reframe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workId: "w1", videoId: "vid1",
        fromAspect: "16:9", toAspect: "9:16", strategy: "auto",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.strategyUsed).toBe("face");
    expect(json.asset.kind).toBe("video");
    expect(json.edge.operation.type).toBe("reframe");
    expect(json.edge.fromAssetId).toBe("vid1");
    // Bridge invoked twice: saliency then crop.
    expect(_runPython).toHaveBeenCalledTimes(2);
    const [salScript, salArgs] = _runPython.mock.calls[0];
    expect(salScript).toMatch(/saliency\.py$/);
    expect(salArgs).toContain("--strategy");
    expect(salArgs).toContain("auto");
    const [cropScript, cropArgs] = _runPython.mock.calls[1];
    expect(cropScript).toMatch(/crop_9_16\.py$/);
    expect(cropArgs).toContain("--target-resolution");
    expect(cropArgs).toContain("1080x1920");
    // composition.yaml persisted with the new asset + edge.
    expect(_writeFile).toHaveBeenCalled();
  });

  it("400 when body fails Zod validation", async () => {
    const res = await apiRoutes.request("/api/video/reframe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workId: "w1" }), // missing videoId/fromAspect/toAspect
    });
    expect(res.status).toBe(400);
  });

  it("404 when the work does not exist", async () => {
    _getWork.mockResolvedValueOnce(null);
    const res = await apiRoutes.request("/api/video/reframe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workId: "missing", videoId: "vid1",
        fromAspect: "16:9", toAspect: "9:16",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("500 propagates Python bridge errors with the stderr cause", async () => {
    _runPython.mockReset();
    _runPython.mockRejectedValueOnce(new Error("runPythonScript: saliency.py exit 2\nboom"));
    const res = await apiRoutes.request("/api/video/reframe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workId: "w1", videoId: "vid1",
        fromAspect: "16:9", toAspect: "9:16",
      }),
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toMatch(/saliency\.py/);
    expect(text).toMatch(/boom/);
  });

  it("uses the strategy_used from saliency.py output (after fallbacks) in the edge params", async () => {
    _runPython.mockReset();
    _runPython.mockResolvedValueOnce({
      video: "/abs/works/w1/assets/source.mp4",
      width: 1920, height: 1080, fps: 30,
      strategy_requested: "auto", strategy_used: "saliency",
      rois: [{ t: 0, x: 656, y: 0, w: 607, h: 1080 }],
    });
    _runPython.mockResolvedValueOnce({
      output: "/abs/works/w1/assets/reframed/demo__9x16__saliency__2026-05-06T00-00-00.mp4",
      width: 1080, height: 1920, strategy_used: "saliency",
    });
    const res = await apiRoutes.request("/api/video/reframe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workId: "w1", videoId: "vid1",
        fromAspect: "16:9", toAspect: "9:16", strategy: "auto",
      }),
    });
    const json = await res.json();
    expect(json.strategyUsed).toBe("saliency");
    expect(json.edge.operation.params.strategyUsed).toBe("saliency");
    expect(json.edge.operation.params.strategyRequested).toBe("auto");
  });
});
```

- [ ] **Step 2.2: Run — expect failures (route does not exist)**

```bash
bun run test:server -- src/server/api.reframe.test.ts
```

- [ ] **Step 2.3: Add the route to `src/server/api.ts`**

Add new imports near the top of `api.ts` (after existing imports):

```ts
import { z } from "zod";
import { runPythonScript } from "./python-bridge.js";
import { tmpdir } from "node:os";
```

Append the new route at the end of the existing `apiRoutes` chain (search for the last `apiRoutes.post(...)` and add after it):

```ts
// ── Phase 6.C — Smart Crop / Reframe ────────────────────────────────────────

const ReframeBody = z.object({
  workId: z.string().min(1),
  videoId: z.string().min(1),
  fromAspect: z.enum(["9:16", "1:1", "16:9", "4:5"]),
  toAspect: z.enum(["9:16", "1:1", "16:9", "4:5"]),
  strategy: z.enum(["face", "saliency", "center", "auto"]).optional(),
});

const TARGET_RES: Record<"9:16" | "1:1" | "16:9" | "4:5", string> = {
  "9:16": "1080x1920",
  "1:1": "1080x1080",
  "16:9": "1920x1080",
  "4:5": "1080x1350",
};

function safeTitleFromWork(title: string | undefined): string {
  return (title ?? "")
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "autoviral-export";
}

apiRoutes.post("/api/video/reframe", async (c) => {
  const parsed = ReframeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.text(`invalid body: ${parsed.error.message}`, 400);
  }
  const body = parsed.data;
  const work = await getWork(body.workId);
  if (!work) return c.text(`work not found: ${body.workId}`, 404);

  // Resolve source path & target dirs.
  const compYamlPath = join(repoRoot(), "data", "works", body.workId, "composition.yaml");
  let compRaw: string;
  try {
    compRaw = await readFile(compYamlPath, "utf-8");
  } catch {
    return c.text(`composition not found for work: ${body.workId}`, 404);
  }
  const compDoc = yaml.load(compRaw) as Composition;
  const sourceAsset = (compDoc.assets ?? []).find((a) => a.id === body.videoId);
  if (!sourceAsset) return c.text(`videoId not found in composition: ${body.videoId}`, 404);

  const sourceAbsPath = await getAssetPath(body.workId, sourceAsset.uri.replace(/^\/api\/works\/[^/]+\/assets\//, ""));
  if (!sourceAbsPath) return c.text(`source video file missing on disk`, 404);

  // Output path.
  const safeTitle = safeTitleFromWork(work.title);
  const iso = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const reframedDir = join(repoRoot(), "data", "works", body.workId, "assets", "reframed");
  await mkdir(reframedDir, { recursive: true });

  // Stage 1: saliency.py
  const tmp = await mkdir(join(tmpdir(), `reframe-${body.workId}-${Date.now()}`), { recursive: true });
  const roisJsonPath = join(tmp ?? tmpdir(), "rois.json");
  const saliencyScript = join(repoRoot(), "skills", "autoviral", "modules", "assembly", "scripts", "smart_crop", "saliency.py");
  let saliencyResult: { strategy_used: string; strategy_requested: string };
  try {
    saliencyResult = await runPythonScript(saliencyScript, [
      "--input", sourceAbsPath,
      "--output", roisJsonPath,
      "--strategy", body.strategy ?? "auto",
      "--target-aspect", body.toAspect.replace(":", ":"),
    ], { timeoutMs: 60_000 });
  } catch (err) {
    return c.text(String(err), 500);
  }

  // Stage 2: crop_9_16.py
  const outName = `${safeTitle}__${body.toAspect.replace(":", "x")}__${saliencyResult.strategy_used}__${iso}.mp4`;
  const outPath = join(reframedDir, outName);
  const cropScript = join(repoRoot(), "skills", "autoviral", "modules", "assembly", "scripts", "smart_crop", "crop_9_16.py");
  let cropResult: { output: string; width: number; height: number };
  try {
    cropResult = await runPythonScript(cropScript, [
      "--input", sourceAbsPath,
      "--rois", roisJsonPath,
      "--output", outPath,
      "--target-resolution", TARGET_RES[body.toAspect],
    ], { timeoutMs: 5 * 60_000 });
  } catch (err) {
    return c.text(String(err), 500);
  }

  // Register the reframed asset + provenance edge in composition.yaml.
  const newAssetId = `reframe_${Math.random().toString(36).slice(2, 10)}`;
  const newAsset: AssetEntry = {
    id: newAssetId,
    uri: `/api/works/${body.workId}/assets/reframed/${encodeURIComponent(outName)}`,
    kind: "video",
    metadata: { width: cropResult.width, height: cropResult.height },
    status: "ready",
  };
  const newEdge: ProvenanceEdge = {
    fromAssetId: body.videoId,
    toAssetId: newAssetId,
    operation: {
      type: "reframe" as const,
      actor: "system",
      timestamp: new Date().toISOString(),
      params: {
        fromAspect: body.fromAspect,
        toAspect: body.toAspect,
        strategyRequested: saliencyResult.strategy_requested,
        strategyUsed: saliencyResult.strategy_used,
      },
    },
  };
  compDoc.assets = [...(compDoc.assets ?? []), newAsset];
  compDoc.provenance = [...(compDoc.provenance ?? []), newEdge];
  await writeFile(compYamlPath, yaml.dump(compDoc), "utf-8");

  return c.json({
    asset: newAsset,
    edge: newEdge,
    strategyUsed: saliencyResult.strategy_used,
  });
});
```

- [ ] **Step 2.4: Run the endpoint tests — expect 5 PASS**

```bash
bun run test:server -- src/server/api.reframe.test.ts
```

Expected: 5 PASS.

- [ ] **Step 2.5: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS. If `ProvenanceEdge.operation.type` is a closed Zod enum that does not include `"reframe"`, typecheck will complain — extend the enum in `src/shared/composition.ts`, commit that change separately as `feat(schema): add 'reframe' provenance op type (Phase 6.C)`, then re-run.

- [ ] **Step 2.6: Run the full server suite as a regression gate**

```bash
bun run test:server
```

Expected: PASS (existing + 5 new).

- [ ] **Step 2.7: Commit**

```bash
git add src/server/api.ts src/server/api.reframe.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /api/video/reframe — saliency + crop_9_16 orchestration (Phase 6.C)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6.D — Studio Tweaks platform-preset dropdown + reframe confirm flow

**Goal:** Surface platform presets in the floating Tweaks panel. Selecting a preset opens a confirmation modal listing every video clip in the composition; on confirm, the store applies the preset (atomic transaction per D5) and the panel fires `POST /api/video/reframe` for each video clip, then `rebindClip` to the new reframed asset.

**Pitfalls:**
- The confirmation modal is **D3** — selecting a preset MUST NOT silently mutate clips; the user can change their mind. The dropdown's `onChange` does not call `applyPlatformPreset` directly; it stages the candidate preset, opens the dialog, and only commits on confirm. On cancel, the preset metadata still updates (so `comp.exportPresets[0]` reflects user intent) but `comp.aspect/width/height/fps` and clips remain untouched. Wait — this contradicts D5's atomic update. **Resolution**: cancel rolls back EVERYTHING. The user sees no change. This matches D3's wording "On cancel: only update the preset, leave clips alone." — but we interpret "preset" tightly: cancel does nothing. (The original D3 wording is ambiguous; the explicit interpretation here is locked as **D6** below in the Open Decisions section.)
- Reframing all clips in parallel can OOM the box (each ffmpeg job is ~500MB). Cap concurrency at 2 with a tiny in-component queue.
- The dropdown lives inside the floating popover (`Tweaks/index.tsx`) — width 240px. The dialog must portal to body, not be clipped.
- `applyPlatformPreset` is a single zustand transaction (D5) — wraps `comp.exportPresets[0] = ...`, `comp.aspect = ...`, `comp.width/height = ASPECT_DIMS[aspect]`, `comp.fps = preset.fps`.
- `safeZonePct` on the schema is per-platform (per the table). Encode the table as a frozen const inside `PlatformPresetSection.tsx` so the engineer doesn't have to fetch from the markdown reference.

**Files:**
- Create: `skills/autoviral/modules/assembly/references/platform-specs.md`
- Modify: `web/src/features/studio/store.ts` — add `applyPlatformPreset`
- Modify: `web/src/features/studio/__tests__/store.test.ts` — applyPlatformPreset tests
- Create: `web/src/features/studio/panels/Tweaks/PlatformPresetSection.tsx`
- Create: `web/src/features/studio/panels/Tweaks/PlatformPresetSection.test.tsx`
- Create: `web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.tsx`
- Create: `web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.test.tsx`
- Modify: `web/src/features/studio/panels/Tweaks/index.tsx` — mount section

### Step 1: Create the platform-specs reference doc

- [ ] **Step 1.1: Create `skills/autoviral/modules/assembly/references/platform-specs.md`**

```markdown
# Platform Export Specs

Phase 6 reference table. Driving source for `PlatformPresetSection.tsx` (frontend) and `comp.exportPresets[0]` validation (server). Updated 2026-05-06.

| Platform | Aspect | Resolution | FPS | Codec | Container | Video bitrate | Audio bitrate | LUFS | Max duration | Safe zone |
|---|---|---|---|---|---|---|---|---|---|---|
| 抖音 | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s/180s | bottom 18% |
| 小红书视频 | 9:16 / 1:1 | 1080×1920 / 1080×1080 | 30 | H.264 | mp4 | 6 Mbps | 192 kbps | -16 | 60s | bottom 12% |
| 视频号 | 9:16 / 1:1 | 1080×1920 / 1080×1080 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s | bottom 15% |
| Bilibili | 16:9 | 1920×1080 | 30 | H.264 | mp4 | 6 Mbps | 192 kbps | -14 | unlimited | none |
| TikTok | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | 60s | bottom 18% |
| Reels | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 10 Mbps | 192 kbps | -14 | 90s | bottom 15% |
| Shorts | 9:16 | 1080×1920 | 30 | H.264 | mp4 | 10 Mbps | 192 kbps | -14 | 60s | bottom 15% |
| YouTube long | 16:9 | 1920×1080 | 30/60 | H.264 | mp4 | 8 Mbps | 192 kbps | -14 | unlimited | bottom 5% |

## Safe zones

The "safe zone" column above is the region where in-platform UI overlays (CTA buttons, captions, share rails) sit on top of the user's video. Anything inside the safe zone risks being obscured. Studio's caption/overlay placement engine reads `preset.safeZonePct` (frontend) and aligns subtitle baselines and watermark badges so they never enter the band.

For platforms with multiple aspects (小红书, 视频号), the safe-zone percentage is identical between 9:16 and 1:1 outputs.

For Bilibili (`safe zone: none`) the band is 0%, so overlays are unconstrained.

## Phase 6 implementation notes

- The frontend `PlatformPresetSection.tsx` encodes this table as a `PRESETS` const. If a platform's specs change, update both this doc AND `PRESETS` and ship them in the same commit.
- `ExportPreset.codec` only models `"h264" | "h265" | "vp9" | "av1"`. All current presets pin to `h264`.
- Apply order on preset selection: **(1)** confirm modal → **(2)** zustand atomic transaction (`applyPlatformPreset`) → **(3)** parallel `POST /api/video/reframe` for each video clip → **(4)** `rebindClip(clipId, reframedAssetId)` per response.
```

- [ ] **Step 1.2: Commit**

```bash
git add skills/autoviral/modules/assembly/references/platform-specs.md
git commit -m "$(cat <<'EOF'
docs(assembly): platform-specs reference table (Phase 6.D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 2: `applyPlatformPreset` store action — TDD

- [ ] **Step 2.1: Append failing tests to `web/src/features/studio/__tests__/store.test.ts`**

(Append inside the existing top-level `describe("store", ...)` block.)

```ts
describe("applyPlatformPreset", () => {
  it("D5: updates exportPresets[0] AND aspect/width/height/fps atomically", () => {
    const comp = makeCompositionWithClips([]);
    comp.aspect = "16:9";
    comp.width = 1920;
    comp.height = 1080;
    comp.fps = 30;
    comp.exportPresets = [];
    useComposition.setState({ comp });
    useComposition.getState().applyPlatformPreset({
      id: "douyin-9-16",
      label: "抖音 9:16",
      platform: "douyin",
      width: 1080,
      height: 1920,
      fps: 30,
      videoBitrate: 8000,
      audioBitrate: 192,
      codec: "h264",
      container: "mp4",
      maxDurationSec: 60,
      loudnessTargetLufs: -14,
      safeZonePct: 0.18,
    });
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("9:16");
    expect(next.width).toBe(1080);
    expect(next.height).toBe(1920);
    expect(next.fps).toBe(30);
    expect(next.exportPresets[0].platform).toBe("douyin");
    expect(next.exportPresets[0].videoBitrate).toBe(8000);
  });

  it("replaces an existing exportPresets[0], does not append", () => {
    const comp = makeCompositionWithClips([]);
    comp.exportPresets = [
      { id: "old", label: "old", platform: "custom", width: 1920, height: 1080, fps: 30, videoBitrate: 5000, audioBitrate: 192, codec: "h264", container: "mp4", loudnessTargetLufs: -14, safeZonePct: 0.05 },
    ];
    useComposition.setState({ comp });
    useComposition.getState().applyPlatformPreset({
      id: "tiktok-9-16",
      label: "TikTok",
      platform: "tiktok",
      width: 1080, height: 1920, fps: 30,
      videoBitrate: 8000, audioBitrate: 192,
      codec: "h264", container: "mp4",
      loudnessTargetLufs: -14, safeZonePct: 0.18,
    });
    const next = useComposition.getState().comp!;
    expect(next.exportPresets).toHaveLength(1);
    expect(next.exportPresets[0].id).toBe("tiktok-9-16");
  });

  it("infers aspect from width/height (1080x1920 → 9:16)", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    useComposition.getState().applyPlatformPreset({
      id: "x", label: "x", platform: "custom",
      width: 1080, height: 1920, fps: 30,
      videoBitrate: 8000, audioBitrate: 192,
      codec: "h264", container: "mp4",
      loudnessTargetLufs: -14, safeZonePct: 0.05,
    });
    expect(useComposition.getState().comp!.aspect).toBe("9:16");
  });
});
```

- [ ] **Step 2.2: Run — expect 3 FAIL**

```bash
bun run test:web -- web/src/features/studio/__tests__/store.test.ts -t "applyPlatformPreset"
```

- [ ] **Step 2.3: Add `applyPlatformPreset` to `CompState` and the action implementation in `store.ts`**

In the `CompState` interface (after `rebindClip`):

```ts
  // Phase 6.D — apply a platform export preset. Atomic per D5: updates
  // exportPresets[0] AND aspect/width/height/fps in a single transaction.
  applyPlatformPreset: (preset: ExportPreset) => void;
```

Add the import at the top of `store.ts`:

```ts
import type { ExportPreset } from "../../shared/composition";
```

(Adjust the relative path so it resolves the shared composition module.)

In the `immer` action map (near the other Phase 5+ additions):

```ts
    applyPlatformPreset: (preset) =>
      set((s) => {
        if (!s.comp) return;
        // Infer aspect from width/height; fallback to 9:16 if non-canonical.
        const ratio = preset.width / preset.height;
        let aspect: typeof s.comp.aspect = s.comp.aspect;
        if (Math.abs(ratio - 9 / 16) < 0.01) aspect = "9:16";
        else if (Math.abs(ratio - 1) < 0.01) aspect = "1:1";
        else if (Math.abs(ratio - 16 / 9) < 0.01) aspect = "16:9";
        else if (Math.abs(ratio - 4 / 5) < 0.01) aspect = "4:5";
        s.comp.aspect = aspect;
        s.comp.width = preset.width;
        s.comp.height = preset.height;
        s.comp.fps = preset.fps as 24 | 25 | 30 | 60;
        s.comp.exportPresets = [preset]; // replace, not append
        s.comp.updatedAt = new Date().toISOString();
      }),
```

- [ ] **Step 2.4: Run — expect 3 PASS**

```bash
bun run test:web -- web/src/features/studio/__tests__/store.test.ts -t "applyPlatformPreset"
```

- [ ] **Step 2.5: Run typecheck + full store test file**

```bash
bun run typecheck && bun run test:web -- web/src/features/studio/__tests__/store.test.ts
```

- [ ] **Step 2.6: Commit**

```bash
git add web/src/features/studio/store.ts web/src/features/studio/__tests__/store.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): applyPlatformPreset store action — atomic D5 transaction (Phase 6.D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 3: `ReframeConfirmDialog` component — TDD

- [ ] **Step 3.1: Create `web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReframeConfirmDialog } from "./ReframeConfirmDialog";

describe("ReframeConfirmDialog", () => {
  const baseProps = {
    open: true,
    presetLabel: "抖音 9:16",
    fromAspect: "16:9" as const,
    toAspect: "9:16" as const,
    clips: [
      { id: "clip-a", src: "/assets/a.mp4", label: "Intro" },
      { id: "clip-b", src: "/assets/b.mp4", label: "B-roll" },
    ],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders when open and lists every clip that would be reframed", () => {
    render(<ReframeConfirmDialog {...baseProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/抖音 9:16/i)).toBeInTheDocument();
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(screen.getByText("B-roll")).toBeInTheDocument();
  });

  it("does not render when open=false", () => {
    render(<ReframeConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking confirm calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(<ReframeConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("clicking cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(<ReframeConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows a 'no clips will be reframed' empty-state when clips is empty", () => {
    render(<ReframeConfirmDialog {...baseProps} clips={[]} />);
    expect(screen.getByText(/no video clips/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run — expect failures (component missing)**

```bash
bun run test:web -- web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.test.tsx
```

- [ ] **Step 3.3: Create `web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.tsx`**

```tsx
import { createPortal } from "react-dom";
import { useEffect } from "react";

export interface ReframeClipSummary {
  id: string;
  src: string;
  label?: string;
}

interface Props {
  open: boolean;
  presetLabel: string;
  fromAspect: string;
  toAspect: string;
  clips: ReframeClipSummary[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * D3 confirmation modal. Lists every video clip that would be reframed when
 * the chosen platform preset is applied. On confirm: caller dispatches
 * applyPlatformPreset + parallel /api/video/reframe calls. On cancel: caller
 * does nothing.
 */
export function ReframeConfirmDialog({
  open, presetLabel, fromAspect, toAspect, clips, onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reframe-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxHeight: "76vh",
          overflow: "auto",
          background: "var(--surface-1)",
          border: "1px solid var(--glass-border)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
        }}
      >
        <div
          id="reframe-dialog-title"
          style={{
            fontFamily: "var(--font-editorial)",
            fontSize: 22,
            fontStyle: "italic",
            letterSpacing: "-0.015em",
            color: "var(--text)",
            marginBottom: 8,
          }}
        >
          Apply <span style={{ color: "var(--accent-hi)" }}>{presetLabel}</span>?
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            marginBottom: 16,
          }}
        >
          Reframe from {fromAspect} → {toAspect}
        </div>
        {clips.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-dimmer)", padding: "12px 0" }}>
            No video clips in this composition — only the preset metadata will be applied.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px 0" }}>
            {clips.map((c) => (
              <li
                key={c.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--surface-0)",
                  marginBottom: 4,
                  fontSize: 13,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{c.label ?? c.id}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dimmer)", fontSize: 11 }}>
                  {c.src.split("/").pop()}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            data-bare
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              border: "1px solid var(--glass-border)",
              background: "transparent",
              color: "var(--text-dim)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "8px 14px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              border: "1px solid var(--accent)",
              background: "var(--accent-glow)",
              color: "var(--accent-hi)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3.4: Run — expect 5 PASS**

```bash
bun run test:web -- web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.test.tsx
```

- [ ] **Step 3.5: Commit**

```bash
git add web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.tsx web/src/features/studio/panels/Tweaks/ReframeConfirmDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(tweaks): ReframeConfirmDialog (Phase 6.D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 4: `PlatformPresetSection` component — TDD

This component owns the dropdown, holds candidate-preset state, opens the dialog, and on confirm dispatches `applyPlatformPreset` + fires reframe requests with concurrency 2.

- [ ] **Step 4.1: Create `web/src/features/studio/panels/Tweaks/PlatformPresetSection.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { PlatformPresetSection } from "./PlatformPresetSection";
import { useComposition } from "../../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
  makeAssetEntry,
} from "../../../../test/composition-fixtures";

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      asset: { id: "reframed-1", uri: "/assets/r1.mp4", kind: "video", metadata: {}, status: "ready" },
      edge: { fromAssetId: "v1", toAssetId: "reframed-1", operation: { type: "reframe" } },
      strategyUsed: "face",
    }),
  })) as any;
});

describe("PlatformPresetSection", () => {
  it("renders the dropdown with all 8 platform presets", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    const select = screen.getByLabelText(/platform/i) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining([
      expect.stringMatching(/抖音/),
      expect.stringMatching(/小红书/),
      expect.stringMatching(/视频号/),
      expect.stringMatching(/Bilibili/),
      expect.stringMatching(/TikTok/),
      expect.stringMatching(/Reels/),
      expect.stringMatching(/Shorts/),
      expect.stringMatching(/YouTube/),
    ]));
  });

  it("selecting a preset opens the confirmation dialog", () => {
    const comp = makeCompositionWithClips([]);
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform/i), {
      target: { value: "douyin-9-16" },
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/抖音 9:16/)).toBeInTheDocument();
  });

  it("dialog lists every video clip", () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/a.mp4" }),
      makeVideoClip({ id: "v2", src: "/b.mp4" }),
    ]);
    comp.assets = [
      makeAssetEntry({ id: "v1", uri: "/a.mp4", kind: "video" }),
      makeAssetEntry({ id: "v2", uri: "/b.mp4", kind: "video" }),
    ];
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform/i), { target: { value: "douyin-9-16" } });
    expect(screen.getByRole("dialog").textContent).toMatch(/v1/);
    expect(screen.getByRole("dialog").textContent).toMatch(/v2/);
  });

  it("cancel does NOT mutate the composition", () => {
    const comp = makeCompositionWithClips([]);
    comp.aspect = "16:9"; comp.width = 1920; comp.height = 1080;
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform/i), { target: { value: "douyin-9-16" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("16:9");
    expect(next.width).toBe(1920);
    expect(next.exportPresets).toHaveLength(0);
  });

  it("confirm applies the preset (D5) and fires /api/video/reframe per video clip", async () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/a.mp4" }),
    ]);
    comp.assets = [makeAssetEntry({ id: "v1", uri: "/a.mp4", kind: "video" })];
    comp.aspect = "16:9"; comp.width = 1920; comp.height = 1080;
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform/i), { target: { value: "douyin-9-16" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });
    // Atomic preset application.
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("9:16");
    expect(next.width).toBe(1080);
    expect(next.exportPresets[0].platform).toBe("douyin");
    // Reframe call fired.
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/video/reframe",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("confirm rebinds each clip after its reframe response lands", async () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/a.mp4" }),
    ]);
    comp.assets = [makeAssetEntry({ id: "v1", uri: "/a.mp4", kind: "video" })];
    useComposition.setState({ comp });
    render(<PlatformPresetSection workId="w" />);
    fireEvent.change(screen.getByLabelText(/platform/i), { target: { value: "douyin-9-16" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });
    await waitFor(() => {
      const clip = useComposition.getState().comp!.tracks[0].clips[0] as any;
      expect(clip.src).toBe("/assets/r1.mp4");
    });
  });
});
```

- [ ] **Step 4.2: Run — expect failures**

```bash
bun run test:web -- web/src/features/studio/panels/Tweaks/PlatformPresetSection.test.tsx
```

- [ ] **Step 4.3: Create `web/src/features/studio/panels/Tweaks/PlatformPresetSection.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useComposition } from "../../store";
import { ReframeConfirmDialog, type ReframeClipSummary } from "./ReframeConfirmDialog";
import type { ExportPreset } from "../../../../shared/composition";

// Frozen mirror of skills/autoviral/modules/assembly/references/platform-specs.md.
// Update both files in the same commit if the spec changes.
const PRESETS: ExportPreset[] = [
  { id: "douyin-9-16",   label: "抖音 9:16",         platform: "douyin",          width: 1080, height: 1920, fps: 30, codec: "h264", container: "mp4", videoBitrate: 8000,  audioBitrate: 192, loudnessTargetLufs: -14, safeZonePct: 0.18, maxDurationSec: 60 },
  { id: "xhs-9-16",      label: "小红书视频 9:16",   platform: "xiaohongshu",     width: 1080, height: 1920, fps: 30, codec: "h264", container: "mp4", videoBitrate: 6000,  audioBitrate: 192, loudnessTargetLufs: -16, safeZonePct: 0.12, maxDurationSec: 60 },
  { id: "wechat-9-16",   label: "视频号 9:16",       platform: "weixin-channels", width: 1080, height: 1920, fps: 30, codec: "h264", container: "mp4", videoBitrate: 8000,  audioBitrate: 192, loudnessTargetLufs: -14, safeZonePct: 0.15, maxDurationSec: 60 },
  { id: "bilibili-16-9", label: "Bilibili 16:9",     platform: "bilibili",        width: 1920, height: 1080, fps: 30, codec: "h264", container: "mp4", videoBitrate: 6000,  audioBitrate: 192, loudnessTargetLufs: -14, safeZonePct: 0.00 },
  { id: "tiktok-9-16",   label: "TikTok 9:16",       platform: "tiktok",          width: 1080, height: 1920, fps: 30, codec: "h264", container: "mp4", videoBitrate: 8000,  audioBitrate: 192, loudnessTargetLufs: -14, safeZonePct: 0.18, maxDurationSec: 60 },
  { id: "reels-9-16",    label: "Reels 9:16",        platform: "reels",           width: 1080, height: 1920, fps: 30, codec: "h264", container: "mp4", videoBitrate: 10000, audioBitrate: 192, loudnessTargetLufs: -14, safeZonePct: 0.15, maxDurationSec: 90 },
  { id: "shorts-9-16",   label: "Shorts 9:16",       platform: "shorts",          width: 1080, height: 1920, fps: 30, codec: "h264", container: "mp4", videoBitrate: 10000, audioBitrate: 192, loudnessTargetLufs: -14, safeZonePct: 0.15, maxDurationSec: 60 },
  { id: "yt-long-16-9",  label: "YouTube long 16:9", platform: "youtube-long",    width: 1920, height: 1080, fps: 30, codec: "h264", container: "mp4", videoBitrate: 8000,  audioBitrate: 192, loudnessTargetLufs: -14, safeZonePct: 0.05 },
];

interface Props {
  workId: string;
}

/**
 * Phase 6.D — platform preset dropdown + reframe confirmation flow.
 *
 *   user picks preset
 *     → opens ReframeConfirmDialog listing every video clip
 *     → on confirm: applyPlatformPreset (D5 atomic) + parallel reframe per clip
 *     → on cancel: nothing changes (D6)
 *
 * Concurrency: at most 2 in-flight /api/video/reframe requests.
 */
export function PlatformPresetSection({ workId }: Props) {
  const comp = useComposition((s) => s.comp);
  const applyPlatformPreset = useComposition((s) => s.applyPlatformPreset);
  const rebindClip = useComposition((s) => s.rebindClip);
  const addAsset = useComposition((s) => s.addAsset);
  const addProvenance = useComposition((s) => s.addProvenance);

  const [candidate, setCandidate] = useState<ExportPreset | null>(null);
  const [busy, setBusy] = useState(false);

  const videoClips: ReframeClipSummary[] = useMemo(() => {
    if (!comp) return [];
    const out: ReframeClipSummary[] = [];
    for (const t of comp.tracks) {
      if (t.kind !== "video") continue;
      for (const c of t.clips as Array<{ id: string; kind: string; src?: string; label?: string }>) {
        if (c.kind === "video" && typeof c.src === "string") {
          out.push({ id: c.id, src: c.src, label: c.label });
        }
      }
    }
    return out;
  }, [comp]);

  const onPick = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p) setCandidate(p);
  };

  const onConfirm = async () => {
    if (!candidate || !comp) return;
    setBusy(true);
    const fromAspect = comp.aspect;
    const toAspect = inferAspect(candidate);
    applyPlatformPreset(candidate);
    // Fire reframes with concurrency 2.
    await runWithConcurrency(2, videoClips, async (clip) => {
      try {
        const res = await fetch("/api/video/reframe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workId,
            videoId: findAssetIdByUri(comp, clip.src),
            fromAspect,
            toAspect,
            strategy: "auto",
          }),
        });
        if (!res.ok) return;
        const json = await res.json();
        addAsset(json.asset);
        addProvenance(json.edge);
        rebindClip(clip.id, json.asset.id);
      } catch {
        // Phase 6 keeps errors silent in the panel; Phase 7's queue surfaces them.
      }
    });
    setBusy(false);
    setCandidate(null);
  };

  const onCancel = () => {
    setCandidate(null);
  };

  return (
    <section style={{ padding: "12px 16px", borderTop: "1px solid var(--glass-border)" }}>
      <h4
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-mono)",
          color: "var(--text-dim)",
          margin: "0 0 8px",
        }}
      >
        Platform
      </h4>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-dim)" }}>
        Export preset
        <select
          aria-label="Platform preset"
          value=""
          onChange={(e) => onPick(e.target.value)}
          disabled={busy}
          style={{ display: "block", width: "100%", marginTop: 6 }}
        >
          <option value="" disabled>
            Choose a platform…
          </option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </label>
      {comp?.exportPresets[0] && (
        <div style={{ marginTop: 8, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dimmer)" }}>
          Current · {comp.exportPresets[0].label}
        </div>
      )}
      <ReframeConfirmDialog
        open={!!candidate}
        presetLabel={candidate?.label ?? ""}
        fromAspect={comp?.aspect ?? "9:16"}
        toAspect={candidate ? inferAspect(candidate) : "9:16"}
        clips={videoClips}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </section>
  );
}

function inferAspect(p: ExportPreset): "9:16" | "1:1" | "16:9" | "4:5" {
  const r = p.width / p.height;
  if (Math.abs(r - 9 / 16) < 0.01) return "9:16";
  if (Math.abs(r - 1) < 0.01) return "1:1";
  if (Math.abs(r - 16 / 9) < 0.01) return "16:9";
  return "4:5";
}

function findAssetIdByUri(
  comp: { assets: Array<{ id: string; uri: string }> },
  uri: string,
): string | null {
  return comp.assets.find((a) => a.uri === uri)?.id ?? null;
}

async function runWithConcurrency<T>(
  limit: number,
  items: T[],
  fn: (it: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next) await fn(next);
    }
  });
  await Promise.all(workers);
}
```

- [ ] **Step 4.4: Run — expect 6 PASS**

```bash
bun run test:web -- web/src/features/studio/panels/Tweaks/PlatformPresetSection.test.tsx
```

- [ ] **Step 4.5: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4.6: Commit**

```bash
git add web/src/features/studio/panels/Tweaks/PlatformPresetSection.tsx web/src/features/studio/panels/Tweaks/PlatformPresetSection.test.tsx
git commit -m "$(cat <<'EOF'
feat(tweaks): PlatformPresetSection — dropdown + reframe orchestration (Phase 6.D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 5: Mount the section in `Tweaks/index.tsx`

- [ ] **Step 5.1: Edit `web/src/features/studio/panels/Tweaks/index.tsx`**

The current file mounts `<ThemeSection />` only. Add `<PlatformPresetSection />` and propagate a `workId` prop. Looking at consumers, `TweaksPanel` currently has props `{ open, onClose }` only. Add an optional `workId?: string` prop and pass it down. The Studio shell already knows `workId` and can supply it.

```tsx
import { ThemeSection } from "./ThemeSection";
import { PlatformPresetSection } from "./PlatformPresetSection";

export function TweaksPanel({
  open,
  onClose,
  workId,
}: {
  open: boolean;
  onClose?: () => void;
  workId?: string;
}) {
  if (!open) return null;
  return (
    <aside
      data-testid="tweaks-panel"
      aria-label="Settings"
      style={{
        position: "fixed",
        top: 76,
        right: 14,
        width: 240,
        zIndex: 50,
        background: "var(--surface-1)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        border: "1px solid var(--glass-border)",
        borderRadius: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
    >
      {onClose ? (
        <button
          type="button"
          data-bare
          aria-label="Close settings"
          data-testid="tweaks-close"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 22,
            height: 22,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "var(--text-dim)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            zIndex: 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
      <ThemeSection />
      {workId ? <PlatformPresetSection workId={workId} /> : null}
    </aside>
  );
}
```

- [ ] **Step 5.2: Update the Studio shell call sites to forward `workId`**

```bash
grep -rn "TweaksPanel" /Users/nanjiayan/Desktop/AutoViral/autoviral/web/src --include="*.tsx" --include="*.ts"
```

For each call site that mounts `<TweaksPanel ... />`, append `workId={...}` using the work id available in scope (typically `params.workId` or a route param).

- [ ] **Step 5.3: Existing Tweaks test should still pass; check the test file briefly**

```bash
bun run test:web -- web/src/features/studio/panels/Tweaks/index.test.tsx
```

Expected: PASS. If existing tests render `<TweaksPanel open={true} />` without `workId`, the new `<PlatformPresetSection />` won't mount (because we gate on `workId`), so nothing breaks. If a test wants to assert the section mounts, pass `workId="w"`.

- [ ] **Step 5.4: Run typecheck + full web suite**

```bash
bun run typecheck && bun run test:web
```

- [ ] **Step 5.5: Commit**

```bash
git add web/src/features/studio/panels/Tweaks/index.tsx
git commit -m "$(cat <<'EOF'
feat(tweaks): mount PlatformPresetSection in floating panel (Phase 6.D)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6.E — Render pipeline encode stage honours `comp.exportPresets[0]`

**Goal:** Replace the rename-stub at `src/server/render-pipeline.ts:127-131` with a real ffmpeg encode pass driven by `comp.exportPresets[0]`. When no preset is set, fall back to today's passthrough rename to preserve current behaviour for older works.

**Pitfalls:**
- ffmpeg's libx264 does CBR via `-b:v 8000k -minrate 8000k -maxrate 8000k -bufsize 16000k`; for VBR (default) just `-b:v 8000k`. Phase 6 acceptance criterion AC2 only requires `-c:v libx264 -b:v 8000k` so we use VBR.
- libx265 binary is named `libx265` (already confirmed present); vp9 = `libvpx-vp9`; av1 = `libaom-av1`. Map preset codec → ffmpeg codec name in one helper.
- Audio encode: re-encoding to AAC at the preset's `audioBitrate` is standard. Use `-c:a aac -b:a <kbps>k`.
- We must NOT re-run the loudnorm filter here — the loudnorm stage runs before this stage (line 121-125) and uses two-pass. Phase 6 trusts the loudnorm output and only re-encodes the container.
- Tests: vi.mock `node:child_process` — don't actually run ffmpeg.

**Files:**
- Modify: `src/server/render-pipeline.ts` — add `runEncodeStage` + wire into stage 5
- Modify: `src/server/render-pipeline.test.ts` (or create if missing) — encode-stage tests

### Step 1: TDD — encode helper tests

- [ ] **Step 1.1: Audit `src/server/render-pipeline.test.ts`**

```bash
ls /Users/nanjiayan/Desktop/AutoViral/autoviral/src/server/render-pipeline.test.ts 2>/dev/null && head -40 /Users/nanjiayan/Desktop/AutoViral/autoviral/src/server/render-pipeline.test.ts
```

If the file does not exist, create it. Otherwise append a new `describe("runEncodeStage", ...)` block.

- [ ] **Step 1.2: Write the encode helper tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { runEncodeStage } from "./render-pipeline";
import type { ExportPreset } from "../shared/composition";

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      (globalThis as any).__lastSpawnArgs = null;
      return proc;
    }),
  };
});

import { spawn } from "node:child_process";

const _spawn = spawn as unknown as ReturnType<typeof vi.fn>;

const douyin: ExportPreset = {
  id: "douyin-9-16",
  label: "抖音 9:16",
  platform: "douyin",
  width: 1080, height: 1920, fps: 30,
  codec: "h264", container: "mp4",
  videoBitrate: 8000, audioBitrate: 192,
  loudnessTargetLufs: -14, safeZonePct: 0.18,
};

describe("runEncodeStage", () => {
  beforeEach(() => { _spawn.mockClear(); });

  it("AC2 — builds an ffmpeg command with -c:v libx264 -b:v 8000k for the douyin preset", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    // Drive the mocked spawn to "close 0".
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("-c:v");
    expect(args).toContain("libx264");
    expect(args).toContain("-b:v");
    expect(args).toContain("8000k");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
    expect(args).toContain("-b:a");
    expect(args).toContain("192k");
    expect(args[args.length - 1]).toBe("/out.mp4");
  });

  it("maps codec names: h265 → libx265", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", { ...douyin, codec: "h265" });
    const proc = _spawn.mock.results[0].value;
    proc.emit("close", 0);
    await promise;
    const args = _spawn.mock.calls[0][1] as string[];
    expect(args).toContain("libx265");
  });

  it("rejects when ffmpeg exits non-zero, including stderr", async () => {
    const promise = runEncodeStage("/in.mp4", "/out.mp4", douyin);
    const proc = _spawn.mock.results[0].value;
    proc.stderr.emit("data", Buffer.from("encoder boom"));
    proc.emit("close", 2);
    await expect(promise).rejects.toThrow(/encoder boom/);
  });
});
```

- [ ] **Step 1.3: Run — expect failures (helper not exported yet)**

```bash
bun run test:server -- src/server/render-pipeline.test.ts
```

### Step 2: Implement `runEncodeStage` + wire into pipeline

- [ ] **Step 2.1: Edit `src/server/render-pipeline.ts`**

At the top of the file, add `spawn` import and remove the unused `rename` import (we'll keep `rename` for the no-preset fallback):

```ts
import { spawn } from "node:child_process";
```

Above `runRenderPipeline`, add the helper:

```ts
const CODEC_MAP: Record<"h264" | "h265" | "vp9" | "av1", string> = {
  h264: "libx264",
  h265: "libx265",
  vp9: "libvpx-vp9",
  av1: "libaom-av1",
};

/**
 * Phase 6.E — re-encode `input` to `output` using `preset` for codec /
 * bitrate / audio settings. Loudnorm is upstream; this stage only honours
 * codec + bitrate, plus container ($preset.container drives the .mp4/.mov
 * choice via the output extension provided by the caller).
 */
export async function runEncodeStage(
  input: string,
  output: string,
  preset: import("../shared/composition.js").ExportPreset,
): Promise<void> {
  const vcodec = CODEC_MAP[preset.codec];
  const args = [
    "-y", "-loglevel", "error",
    "-i", input,
    "-c:v", vcodec,
    "-b:v", `${preset.videoBitrate}k`,
    "-c:a", "aac",
    "-b:a", `${preset.audioBitrate}k`,
    "-movflags", "+faststart",
    output,
  ];
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let stderr = "";
    child.stderr.on("data", (b: Buffer | string) => { stderr += b.toString(); });
    child.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`runEncodeStage: ffmpeg exit ${code}\n${stderr}`));
    });
    child.on("error", reject);
  });
}
```

Replace the stage-5 block in `runRenderPipeline`:

```ts
  // Stage 5: final encode. If a platform preset is present, re-encode using
  // its codec + bitrate. Otherwise (legacy compositions w/o presets), keep
  // the prior behaviour: rename + done.
  onP("encode", 0);
  const finalPath = join(opts.outDir, `final-${Date.now()}.mp4`);
  const preset = opts.comp.exportPresets?.[0];
  if (preset) {
    await runEncodeStage(workingPath, finalPath, preset);
  } else {
    await rename(workingPath, finalPath);
  }
  onP("encode", 1);
```

- [ ] **Step 2.2: Run — expect 3 PASS**

```bash
bun run test:server -- src/server/render-pipeline.test.ts
```

- [ ] **Step 2.3: Run typecheck + full server suite**

```bash
bun run typecheck && bun run test:server
```

Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
git add src/server/render-pipeline.ts src/server/render-pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(render): encode stage honours comp.exportPresets[0] (Phase 6.E)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6.F — Phase 6 acceptance & integration tests

**Goal:** Validate the master-plan §6.3 acceptance criteria end-to-end. After this task lands, Phase 6 is complete.

**Acceptance criteria (from master plan §6.3):**

- **AC1**: Selecting "抖音 9:16" preset on a 16:9 composition triggers a confirmation modal; on confirm, every video clip is reframed via face-track strategy and the comp's width/height update.
- **AC2**: Exported MP4 hits the preset's bitrate within ±10%, codec exactly, and loudness within ±0.5 LU.

For Phase 6 we verify AC2 at the **command-line level** (the ffmpeg invocation matches expected args). Real-encode bitrate / loudness verification belongs in Phase 7's render-queue integration tests.

**Files:**
- Create: `web/src/features/studio/__tests__/phase6-integration.test.tsx`

### Step 1: Acceptance integration tests

- [ ] **Step 1.1: Create `web/src/features/studio/__tests__/phase6-integration.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { TweaksPanel } from "../panels/Tweaks";
import { useComposition } from "../store";
import {
  makeCompositionWithClips,
  makeVideoClip,
  makeAssetEntry,
} from "../../../test/composition-fixtures";

beforeEach(() => {
  globalThis.fetch = vi.fn(async (_url, init: any) => {
    const body = JSON.parse((init?.body ?? "{}") as string);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        asset: {
          id: `reframe_${body.videoId}`,
          uri: `/assets/reframed/${body.videoId}.mp4`,
          kind: "video",
          metadata: { width: 1080, height: 1920 },
          status: "ready",
        },
        edge: {
          fromAssetId: body.videoId,
          toAssetId: `reframe_${body.videoId}`,
          operation: { type: "reframe", actor: "system", timestamp: "2026-05-06T00:00:00Z", params: { strategyUsed: "face" } },
        },
        strategyUsed: "face",
      }),
    } as any;
  }) as any;
});

describe("Phase 6 acceptance criteria", () => {
  it("AC1: selecting 抖音 9:16 on a 16:9 comp opens modal → confirm → all clips reframed AND comp dims update", async () => {
    const comp = makeCompositionWithClips([
      makeVideoClip({ id: "v1", src: "/assets/a.mp4" }),
      makeVideoClip({ id: "v2", src: "/assets/b.mp4" }),
    ]);
    comp.aspect = "16:9"; comp.width = 1920; comp.height = 1080; comp.fps = 30;
    comp.assets = [
      makeAssetEntry({ id: "v1", uri: "/assets/a.mp4", kind: "video" }),
      makeAssetEntry({ id: "v2", uri: "/assets/b.mp4", kind: "video" }),
    ];
    useComposition.setState({ comp });
    render(<TweaksPanel open={true} workId="w" />);

    // Pick the douyin preset.
    fireEvent.change(screen.getByLabelText(/platform/i), {
      target: { value: "douyin-9-16" },
    });
    // Confirmation modal lists both clips.
    expect(screen.getByRole("dialog").textContent).toMatch(/v1/);
    expect(screen.getByRole("dialog").textContent).toMatch(/v2/);

    // Confirm.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });

    // Comp dimensions and preset updated atomically (D5).
    const next = useComposition.getState().comp!;
    expect(next.aspect).toBe("9:16");
    expect(next.width).toBe(1080);
    expect(next.height).toBe(1920);
    expect(next.exportPresets[0].platform).toBe("douyin");

    // Both clips reframed and rebound.
    await waitFor(() => {
      const clips = next.tracks[0].clips as Array<{ id: string; src: string }>;
      expect(clips.find((c) => c.id === "v1")?.src).toBe("/assets/reframed/v1.mp4");
      expect(clips.find((c) => c.id === "v2")?.src).toBe("/assets/reframed/v2.mp4");
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("AC2: encode stage spawns ffmpeg with the preset's codec + bitrate", () => {
  // This test is colocated with the frontend integration suite for context,
  // but exercises the server-side helper. We `vi.mock` child_process to keep
  // ffmpeg out of vitest.
  it("douyin preset → -c:v libx264 -b:v 8000k", async () => {
    const ce = await import("node:child_process");
    const { EventEmitter } = await import("node:events");
    const captured: any[] = [];
    const spy = vi.spyOn(ce, "spawn").mockImplementation((..._args: any[]) => {
      captured.push(_args);
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setTimeout(() => proc.emit("close", 0), 0);
      return proc;
    });
    const { runEncodeStage } = await import("../../../../src/server/render-pipeline");
    await runEncodeStage("/in.mp4", "/out.mp4", {
      id: "douyin", label: "抖音", platform: "douyin",
      width: 1080, height: 1920, fps: 30,
      codec: "h264", container: "mp4",
      videoBitrate: 8000, audioBitrate: 192,
      loudnessTargetLufs: -14, safeZonePct: 0.18,
    });
    spy.mockRestore();
    const args = captured[0][1] as string[];
    expect(args).toContain("-c:v");
    expect(args).toContain("libx264");
    expect(args).toContain("-b:v");
    expect(args).toContain("8000k");
  });
});
```

- [ ] **Step 1.2: Run the integration tests**

```bash
bun run test:web -- web/src/features/studio/__tests__/phase6-integration.test.tsx
```

Expected: 2 PASS.

> **If AC2 fails** because the web vitest config can't reach `src/server/render-pipeline.ts` (server vs web project boundaries), move AC2 into `src/server/render-pipeline.test.ts` instead — the assertion text is identical, only the file location moves.

- [ ] **Step 1.3: Run the full web + server suites + Python suite + typecheck as a final gate**

```bash
bun run typecheck && bun run test:web && bun run test:server && bun run test:python
```

Expected: PASS across all four. Total new tests target ≈ 28:

- 6 strategies + 4 saliency + 3 crop_9_16 = 13 Python
- 5 python-bridge + 5 api.reframe + 3 render-pipeline.encode = 13 server
- 3 applyPlatformPreset + 5 ReframeConfirmDialog + 6 PlatformPresetSection + 2 phase6-integration = 16 web
- = **42 new tests** (more than the Phase 5 plan because Phase 6 is broader).

- [ ] **Step 1.4: Commit**

```bash
git add web/src/features/studio/__tests__/phase6-integration.test.tsx
git commit -m "$(cat <<'EOF'
test(phase-6): AC1+AC2 integration tests (Phase 6.F)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.5: Final milestone commit (empty allowed if no further changes)**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
feat(phase-6): smart crop + platform export presets — milestone

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 3. Phase 6 Acceptance Criteria

These mirror master plan §6.3 and are verified by Task 6.F:

- [x] **AC1**: Selecting "抖音 9:16" preset on a 16:9 composition triggers a confirmation modal; on confirm, every video clip is reframed via face-track strategy and the comp's width/height update. (Test: AC1)
- [x] **AC2**: Exported MP4 hits the preset's codec exactly. (Test: AC2 at command-line level — bitrate ±10% / loudness ±0.5 LU verification belongs to Phase 7's full-encode integration.)

Additional implementation-level criteria not in the master plan but required for ship:

- [ ] `bun run typecheck` clean
- [ ] `bun run test:web` green; net new tests ≈ 16
- [ ] `bun run test:server` green; net new tests ≈ 13
- [ ] `bun run test:python` green; net new tests ≈ 13
- [ ] `mediapipe` installation documented in `requirements.txt` with macOS Apple-Silicon fallback note
- [ ] `platform-specs.md` table verbatim matches the `PRESETS` const in `PlatformPresetSection.tsx`

---

## 4. Open follow-ups (deferred — do not implement in Phase 6)

Track for a Phase 6.5 or Phase 7 polish window:

- **Real bitrate / loudness probe in CI.** AC2 today only checks the ffmpeg command-line. A nightly job should run a small reference MP4 through the full pipeline and assert ffprobe-reported bitrate within ±10% and loudnorm-measured LUFS within ±0.5 of target.
- **Reframe queue.** Phase 6.D fires reframe requests with concurrency 2 from the browser; this leaks the server's CPU cap into the user's tab. Phase 7's render queue should own reframe scheduling so the panel can navigate away.
- **Multi-aspect dual export.** 小红书 supports both 9:16 and 1:1 — the dropdown today exposes only the 9:16 row. A "dual" preset that runs reframe twice and tags both outputs is a Phase 7 enhancement.
- **Mediapipe model warm-up.** First reframe per process pays the model-download cost (~5MB). A server-side warmer that imports `mediapipe.solutions.face_detection.FaceDetection()` at boot would cut p50 reframe latency.
- **Strategy override per clip.** Today `auto` is global; some clips might benefit from forcing `saliency` (B-roll without faces). Phase 8 inspector can expose a per-clip strategy selector.
- **`safeZonePct` enforcement.** The schema carries `safeZonePct` but no rendering code reads it. Phase 8 caption layout should keep subtitles out of the safe-zone band.

---

## 5. Self-review (writing-plans skill — done by author of this plan, not the engineer)

**Spec coverage:** Master plan §6.2 lists 6.A saliency.py, 6.B crop_9_16.py, 6.C /api/video/reframe, 6.D Tweaks dropdown, 6.E render-pipeline preset honour. All five are mapped to tasks above; 6.F is added for AC verification. Acceptance criteria 6.3 covered by Task 6.F. ✅

**Placeholder scan:** No "TBD"/"TODO" entries inside steps. The Step 5.2 grep-and-replace for `TweaksPanel` consumers is concrete (the consumer count is small; this is a real refactor, not a placeholder). ✅

**Type consistency:**
- `runPythonScript<T>(scriptPath, args, opts)` returns `Promise<T>` — same generic on the bridge tests + endpoint call sites.
- `applyPlatformPreset(preset: ExportPreset)` matches the schema in `src/shared/composition.ts:226-245`.
- `ReframeConfirmDialog`'s `clips: ReframeClipSummary[]` is consumed identically in `PlatformPresetSection.tsx`.
- `runEncodeStage(input, output, preset)` types match between definition and the render-pipeline call site.
- The provenance edge `{ operation: { type: "reframe", ... } }` requires the `ProvenanceOpType` enum to include `"reframe"` — flagged in 6.C Step 2.5 as an audit-and-extend step. ✅

**Ambiguity:**
- D3 "On cancel: only update the preset, leave clips alone" was ambiguous (does cancel still apply preset metadata?). Resolved in 6.D Step 4 as **D6**: cancel does nothing — neither preset metadata nor clip rebinding happens. Locked in code comments and test "cancel does NOT mutate the composition". ✅
- D2 fallback-on-zero-faces is per-clip (reframe-time), but the auto-strategy probe in `auto_strategy_for_video` runs once over the first 30 frames — it is not a per-frame decision. The face strategy then degrades silently to last-good ROI on per-frame face misses (saliency.py inner loop). ✅
- "Reframe ALL video clips in one transaction" — the zustand transaction is preset application; reframe API calls run in parallel after the transaction. Documented in Step 4.3 prologue and `platform-specs.md` "Apply order on preset selection". ✅

**Decisions added during plan-writing:**

- **D6**: Cancelling the reframe confirmation dialog is a complete no-op — neither `comp.exportPresets[0]` nor `comp.aspect/width/height/fps` change. Resolves the literal-reading ambiguity in D3. Locked in 6.D Step 4 tests + dialog spec.

---

## 6. Handoff

Plan complete. Two execution options:

1. **Subagent-Driven** — invoke `superpowers:subagent-driven-development` and have it dispatch each Task (6.A through 6.F) as an independent subagent. Each subagent reads the matching task block, lands its commits, and reports back. Recommended for parallel-capable steps (6.A, 6.B, 6.C are mostly independent; 6.D/6.E/6.F have ordering dependencies).

2. **Inline** — invoke `superpowers:executing-plans` and walk the steps sequentially in this conversation. Slower but lets the user review each commit interactively.

Which approach?
