#!/usr/bin/env python3
"""Build a CLIP semantic-search index for a per-work asset library.

Usage:
    python3 build_index.py \\
        --work-id <id> \\
        --asset-list <path-to-json> \\
        --out-dir <dir> \\
        [--model ViT-B-32]

The asset list is a length-N JSON array of records:
    {
      "workId": "<id>",
      "relPath": "assets/clips/foo.mp4",
      "absPath": "/abs/.../foo.mp4",
      "kind": "image" | "video" | "audio" | "text"
    }
Only `image` and `video` records are indexed (D10). Audio/text are silently
skipped. For video assets, ffmpeg extracts a representative mid-point jpg into
`<out-dir>/frames/<sha1(relPath)>.jpg` (D6); the jpg's CLIP embedding is what
gets indexed and `asset-uris.json` records both `path` and `frameSrc`.

Outputs (atomic via tmp+os.replace per D14):
    <out-dir>/embeddings.npy        float32 (N, dim) L2-normalized
    <out-dir>/asset-uris.json       length-N array of {path, kind, frameSrc?}
    <out-dir>/meta.json             {model, pretrain, embeddingDim, builtAt,
                                     assetCount, sourceWorkId}

Stdout contract (python-bridge expects last non-empty line to be JSON):
    {"ok": true, "assetCount": N, "model": "...", "indexedAt": "...", "durationMs": M}
or stub:
    {"stub": true, "reason": "..."}

Per D11, all operational failures (missing open_clip, malformed asset list,
zero indexable assets) emit a `stub` JSON and exit 0. Only catastrophic
runtime errors exit non-zero.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
from typing import Any

# --- Python version guard --------------------------------------------------

if sys.version_info < (3, 10):
    print(json.dumps({"stub": True, "reason": "python_version"}))
    sys.exit(0)

# --- numpy is a hard requirement (already provisioned via other modules) ---

import numpy as np

# --- open_clip / torch are conditional (D4 stub mode) ----------------------

_FORCE_NO_OPEN_CLIP = bool(os.environ.get("AUTOVIRAL_FORCE_NO_OPEN_CLIP"))
_TEST_STUB = bool(os.environ.get("AUTOVIRAL_TEST_STUB"))

OPEN_CLIP_AVAILABLE = False
if not _FORCE_NO_OPEN_CLIP and not _TEST_STUB:
    try:
        import open_clip  # type: ignore[import]
        import torch  # type: ignore[import]

        OPEN_CLIP_AVAILABLE = True
    except ImportError:
        OPEN_CLIP_AVAILABLE = False

# --- Model registry (D1) ---------------------------------------------------

MODEL_REGISTRY: dict[str, tuple[str, str, int]] = {
    "ViT-B-32": ("ViT-B-32", "laion2b_s34b_b79k", 512),
    "ViT-L-14": ("ViT-L-14", "laion2b_s32b_b82k", 768),
}

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".mkv"}

# --- Deterministic test-stub encoder ---------------------------------------
# When AUTOVIRAL_TEST_STUB=1 is set, the script bypasses real CLIP weights and
# uses a sha256-derived unit-norm vector keyed by the asset's basename. The
# matching text-stub in search.py uses the same hash function, so a query and
# an asset with the same stem produce the same vector → top-1 hit. This lets
# us validate the full ingest+search code path without 150MB of model weights.


def _stub_vector(seed: str, dim: int = 512) -> np.ndarray:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    rng = np.random.default_rng(int.from_bytes(digest[:8], "little"))
    v = rng.standard_normal(dim).astype(np.float32)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


# --- Frame extraction (D6) -------------------------------------------------


def _probe_duration(path: str) -> float | None:
    """Return video duration in seconds, or None if unprobeable."""
    if shutil.which("ffprobe") is None:
        return None
    for entries in ("format=duration", "stream=duration"):
        try:
            out = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    entries,
                    "-of",
                    "default=nw=1:nk=1",
                    path,
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (subprocess.SubprocessError, OSError):
            return None
        line = out.stdout.strip().splitlines()
        if not line:
            continue
        try:
            v = float(line[0].strip())
            if v > 0:
                return v
        except ValueError:
            continue
    return None


def _extract_mid_frame(video_path: str, out_jpg: pathlib.Path) -> bool:
    """Extract the mid-point frame to `out_jpg`. Returns True on success."""
    if shutil.which("ffmpeg") is None:
        return False
    dur = _probe_duration(video_path)
    t = max(0.0, (dur or 0.0) / 2.0)
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-ss",
                str(t),
                "-i",
                video_path,
                "-frames:v",
                "1",
                "-q:v",
                "2",
                "-y",
                str(out_jpg),
            ],
            capture_output=True,
            timeout=60,
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    return out_jpg.exists() and out_jpg.stat().st_size > 0


# --- Atomic write helper (D14) ---------------------------------------------


def _atomic_write_bytes(path: pathlib.Path, payload: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(payload)
    os.replace(tmp, path)


def _atomic_save_npy(path: pathlib.Path, arr: np.ndarray) -> None:
    # `np.save` appends `.npy` if the target doesn't already end with `.npy`,
    # so we explicitly use a sibling `.npy` tmp path to avoid the rename
    # destination drifting (`embeddings.npy.tmp` → `embeddings.npy.tmp.npy`).
    tmp = path.with_name(path.stem + ".tmp.npy")
    np.save(tmp, arr)
    os.replace(tmp, path)


# --- Encoding --------------------------------------------------------------


def _encode_image_real(model, preprocess, img_path: str) -> np.ndarray:
    from PIL import Image

    image = Image.open(img_path).convert("RGB")
    tensor = preprocess(image).unsqueeze(0)
    with torch.no_grad():  # type: ignore[name-defined]
        emb = model.encode_image(tensor).cpu().numpy().squeeze(0)
    return emb.astype(np.float32)


def _encode_image_stub(img_path: str, dim: int) -> np.ndarray:
    # Seed by basename stem (without extension) so a query "panda" matches
    # an asset "panda.jpg" deterministically.
    stem = pathlib.Path(img_path).stem
    return _stub_vector(stem, dim)


# --- main() ---------------------------------------------------------------


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main() -> int:
    ap = argparse.ArgumentParser(description="Build CLIP semantic-search index.")
    ap.add_argument("--work-id", required=True)
    ap.add_argument("--asset-list", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--model", default=os.environ.get("AUTOVIRAL_CLIP_MODEL", "ViT-B-32"))
    args = ap.parse_args()

    # Stub: open_clip missing (only relevant when not in test-stub mode).
    if not OPEN_CLIP_AVAILABLE and not _TEST_STUB:
        _emit({"stub": True, "reason": "open_clip_torch not installed"})
        return 0

    # Validate model name.
    if args.model not in MODEL_REGISTRY:
        _emit({"stub": True, "reason": "unknown_model", "model": args.model})
        return 0
    model_name, pretrain, dim = MODEL_REGISTRY[args.model]

    # Parse asset list.
    asset_list_path = pathlib.Path(args.asset_list)
    try:
        assets = json.loads(asset_list_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        _emit({"stub": True, "reason": "invalid_asset_list", "error": str(exc)})
        return 0
    if not isinstance(assets, list):
        _emit({"stub": True, "reason": "invalid_asset_list", "error": "not a list"})
        return 0

    # Filter to indexable kinds (D10).
    indexable = [a for a in assets if isinstance(a, dict) and a.get("kind") in ("image", "video")]
    if not indexable:
        _emit({"stub": True, "reason": "no_indexable_assets", "assetCount": 0})
        return 0

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = out_dir / "frames"

    # Load model (real or stub).
    model = preprocess = None
    if not _TEST_STUB:
        try:
            model, _, preprocess = open_clip.create_model_and_transforms(  # type: ignore[name-defined]
                model_name, pretrained=pretrain
            )
            model.eval()
        except Exception as exc:  # noqa: BLE001
            _emit({"stub": True, "reason": "model_load_failed", "error": str(exc)})
            return 0

    started = time.time()
    embeddings: list[np.ndarray] = []
    uris: list[dict[str, Any]] = []

    for asset in indexable:
        rel = str(asset.get("relPath") or "")
        abs_path = str(asset.get("absPath") or "")
        kind = asset.get("kind")
        if not abs_path or not pathlib.Path(abs_path).exists():
            print(f"build_index: missing absPath for {rel!r}; skipping", file=sys.stderr)
            continue
        frame_src: str | None = None
        embed_target = abs_path

        if kind == "video":
            frame_jpg = frames_dir / (hashlib.sha1(rel.encode()).hexdigest() + ".jpg")
            if not _extract_mid_frame(abs_path, frame_jpg):
                print(f"build_index: frame extraction failed for {rel!r}; skipping", file=sys.stderr)
                continue
            frame_src = str(frame_jpg)
            embed_target = str(frame_jpg)

        try:
            if _TEST_STUB:
                emb = _encode_image_stub(embed_target, dim)
            else:
                emb = _encode_image_real(model, preprocess, embed_target)
        except Exception as exc:  # noqa: BLE001
            print(f"build_index: encode failed for {rel!r}: {exc}; skipping", file=sys.stderr)
            continue

        # L2 normalize.
        norm = float(np.linalg.norm(emb))
        if norm == 0.0:
            print(f"build_index: zero-norm embedding for {rel!r}; skipping", file=sys.stderr)
            continue
        emb = (emb / norm).astype(np.float32)
        embeddings.append(emb)
        record: dict[str, Any] = {"path": rel, "kind": kind}
        if frame_src is not None:
            record["frameSrc"] = frame_src
        uris.append(record)

    if not embeddings:
        _emit({"stub": True, "reason": "no_indexable_assets", "assetCount": 0})
        return 0

    arr = np.stack(embeddings).astype(np.float32)
    _atomic_save_npy(out_dir / "embeddings.npy", arr)
    _atomic_write_bytes(
        out_dir / "asset-uris.json",
        json.dumps(uris, indent=2).encode("utf-8"),
    )

    meta = {
        "model": args.model,
        "pretrain": pretrain,
        "embeddingDim": int(arr.shape[1]),
        "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "assetCount": int(arr.shape[0]),
        "sourceWorkId": args.work_id,
    }
    _atomic_write_bytes(out_dir / "meta.json", json.dumps(meta, indent=2).encode("utf-8"))

    elapsed_ms = int((time.time() - started) * 1000)
    _emit(
        {
            "ok": True,
            "stub": False,
            "assetCount": int(arr.shape[0]),
            "model": args.model,
            "indexedAt": meta["builtAt"],
            "durationMs": elapsed_ms,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
