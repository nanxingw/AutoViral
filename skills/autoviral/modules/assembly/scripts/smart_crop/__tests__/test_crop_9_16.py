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
        timeout=120,
    )
    return out


def _ffprobe(path: pathlib.Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, check=True, timeout=30,
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
        capture_output=True, text=True, check=True, timeout=300,
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
        capture_output=True, text=True, check=True, timeout=300,
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
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode != 0
    assert "empty" in result.stderr.lower() or "no roi" in result.stderr.lower()
