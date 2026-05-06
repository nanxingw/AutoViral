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
