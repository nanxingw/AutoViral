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
