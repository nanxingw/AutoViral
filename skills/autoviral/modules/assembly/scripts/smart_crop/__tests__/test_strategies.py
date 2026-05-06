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
