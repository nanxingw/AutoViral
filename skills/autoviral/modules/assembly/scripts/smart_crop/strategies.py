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
    # mediapipe ≥0.10.x dropped the legacy `mp.solutions.face_detection` API
    # in some builds. Try the legacy path first, then fall back to None on any
    # API/runtime failure so the caller can degrade to saliency/center per D2.
    try:
        face_detection = mp.solutions.face_detection  # type: ignore[attr-defined]
        with face_detection.FaceDetection(
            model_selection=0, min_detection_confidence=0.5
        ) as fd:
            result = fd.process(rgb)
    except Exception:  # pragma: no cover — environment-dependent
        return None
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
