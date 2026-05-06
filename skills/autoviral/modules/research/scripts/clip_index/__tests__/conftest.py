"""Pytest fixtures for clip_index tests.

Provides:
- `script_dir`: filesystem path to the build_index.py / search.py scripts.
- `run_script`: subprocess helper that invokes a script and captures stdout JSON.
- `make_image`: synthesize a small PNG fixture and return its absolute path.
- `make_video`: synthesize a small mp4 fixture via ffmpeg lavfi (skipped if no ffmpeg).
- `stub_open_clip`: pytest-internal fixture to monkeypatch a deterministic
  open_clip stub into the import path so tests can run real-mode without the
  150MB weight download.

Determinism strategy: the stub `encode_image` / `encode_text` derive a 512-d
vector from a stable hash of an identifier (image filename / query string).
That keeps rankings predictable across test runs.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
from typing import Any

import numpy as np
import pytest
from PIL import Image

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent.parent


def _hash_to_vector(seed: str, dim: int = 512) -> np.ndarray:
    """Return a deterministic unit-norm float32 vector seeded by `seed`.

    Same seed → same vector. Different seeds → uncorrelated vectors with
    extremely high probability. Used by both image and text stubs so that
    image filename "panda.jpg" and query "panda" both map to similar vectors
    when seeded identically.
    """
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    rng = np.random.default_rng(int.from_bytes(digest[:8], "little"))
    v = rng.standard_normal(dim).astype(np.float32)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


@pytest.fixture
def script_dir() -> pathlib.Path:
    return SCRIPT_DIR


@pytest.fixture
def run_script():
    """Run a clip_index script as a subprocess and return (returncode, stdout_json, stderr)."""

    def _run(
        script_name: str,
        args: list[str],
        env_overrides: dict[str, str] | None = None,
        stub_mode: str | None = None,
    ) -> tuple[int, dict[str, Any] | None, str]:
        import os

        env = os.environ.copy()
        if env_overrides:
            env.update(env_overrides)
        if stub_mode == "force_no_open_clip":
            env["AUTOVIRAL_FORCE_NO_OPEN_CLIP"] = "1"
        elif stub_mode == "deterministic":
            # Tells the script to use the deterministic in-process stub
            # encoder (defined in build_index.py / search.py under
            # `_AUTOVIRAL_TEST_STUB`).
            env["AUTOVIRAL_TEST_STUB"] = "1"

        result = subprocess.run(
            [sys.executable, str(SCRIPT_DIR / script_name), *args],
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
        )
        # Last non-empty stdout line is the JSON payload (python-bridge contract).
        payload: dict[str, Any] | None = None
        for line in reversed(result.stdout.splitlines()):
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            break
        return result.returncode, payload, result.stderr

    return _run


@pytest.fixture
def make_image(tmp_path: pathlib.Path):
    def _make(name: str, color: tuple[int, int, int] = (200, 100, 50)) -> pathlib.Path:
        p = tmp_path / name
        Image.new("RGB", (64, 64), color=color).save(p)
        return p

    return _make


@pytest.fixture
def make_video(tmp_path: pathlib.Path):
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not available in PATH")

    def _make(name: str = "clip.mp4", duration: float = 2.0) -> pathlib.Path:
        out = tmp_path / name
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"testsrc=size=64x64:duration={duration}:rate=10",
                "-pix_fmt",
                "yuv420p",
                str(out),
            ],
            capture_output=True,
            check=True,
            timeout=30,
        )
        return out

    return _make


@pytest.fixture
def write_asset_list(tmp_path: pathlib.Path):
    def _write(assets: list[dict], name: str = "assets.json") -> pathlib.Path:
        p = tmp_path / name
        p.write_text(json.dumps(assets))
        return p

    return _write
