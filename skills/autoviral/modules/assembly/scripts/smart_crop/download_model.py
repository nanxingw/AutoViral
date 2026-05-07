"""Fetch the BlazeFace short-range .tflite model used by smart_crop's face strategy.

mediapipe >=0.10 dropped the legacy `mp.solutions.face_detection` API. The new
`mp.tasks.vision.FaceDetector` requires an explicit `.tflite` model on disk. We
keep that file out of the repo (~230 KB binary) and fetch it on demand into
``~/.autoviral/models/blaze_face_short_range.tflite``.

Usage:
    python3 skills/autoviral/modules/assembly/scripts/smart_crop/download_model.py

Idempotent: skips download when the file already exists. Exits non-zero on
network failure so callers (CI, smart_crop bootstrap) can surface the problem.
"""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.request
from pathlib import Path

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
)
MODEL_DIR = Path(os.path.expanduser("~/.autoviral/models"))
MODEL_PATH = MODEL_DIR / "blaze_face_short_range.tflite"


def model_path() -> Path:
    """Default on-disk location of the BlazeFace model."""
    return MODEL_PATH


def ensure_model(*, force: bool = False) -> Path:
    """Download the model if missing. Returns the absolute path.

    Raises urllib.error.URLError / OSError on network or filesystem failure —
    callers should surface that as BLOCKED rather than retrying.
    """
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.exists() and not force:
        return MODEL_PATH
    tmp = MODEL_PATH.with_suffix(".tflite.partial")
    with urllib.request.urlopen(MODEL_URL, timeout=60) as resp:
        data = resp.read()
    tmp.write_bytes(data)
    tmp.replace(MODEL_PATH)
    return MODEL_PATH


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    try:
        path = ensure_model()
    except Exception as exc:  # pragma: no cover — network-dependent
        print(f"[download_model] FAILED: {exc}", file=sys.stderr)
        return 1
    size = path.stat().st_size
    print(f"[download_model] OK: {path}")
    print(f"[download_model]   size: {size} bytes")
    print(f"[download_model]   sha256: {_sha256(path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
