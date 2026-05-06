#!/usr/bin/env python3
"""Crop a video to a target aspect using a per-second ROI list.

Usage:
    python3 crop_9_16.py --input <video> --rois <rois.json> \\
        --output <out.mp4> --target-resolution 1080x1920 [--smooth-window 15]

Algorithm:
    1. Read ROI samples from --rois.
    2. Smooth ROIs with a rolling-mean window (default 15, centered).
    3. Build an ffmpeg `crop` filter expression with sendcmd-style segments —
       for each consecutive pair of ROI samples, emit a `between(t, t0, t1)*expr`
       term that linearly interpolates x/y/w/h.
    4. Append `scale=W:H` to land on the canonical target resolution.
    5. Pass audio through with -c:a copy.

Output JSON to stdout (python-bridge contract):
    {"output": "/abs/path", "width": <int>, "height": <int>, "strategy_used": <str>}
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
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
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
