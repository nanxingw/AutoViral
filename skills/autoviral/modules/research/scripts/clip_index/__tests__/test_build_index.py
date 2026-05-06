"""Tests for build_index.py.

Strategy: invoke the script as a subprocess via the `run_script` fixture so the
real CLI surface is under test (matches the python-bridge contract). All
real-mode tests set AUTOVIRAL_TEST_STUB=1 to use the deterministic in-process
encoder, avoiding the 150MB CLIP weight download. Stub-mode tests set
AUTOVIRAL_FORCE_NO_OPEN_CLIP=1 to assert the import-failure code path.
"""

from __future__ import annotations

import json
import pathlib

import numpy as np
import pytest


def _build_args(asset_list: pathlib.Path, out_dir: pathlib.Path, work_id: str = "w1") -> list[str]:
    return [
        "--work-id",
        work_id,
        "--asset-list",
        str(asset_list),
        "--out-dir",
        str(out_dir),
    ]


def test_build_writes_three_files_for_image_assets(
    tmp_path, run_script, make_image, write_asset_list
):
    img_a = make_image("a.png", color=(255, 0, 0))
    img_b = make_image("b.png", color=(0, 255, 0))
    img_c = make_image("c.png", color=(0, 0, 255))
    asset_list = write_asset_list(
        [
            {"workId": "w1", "relPath": "a.png", "absPath": str(img_a), "kind": "image"},
            {"workId": "w1", "relPath": "b.png", "absPath": str(img_b), "kind": "image"},
            {"workId": "w1", "relPath": "c.png", "absPath": str(img_c), "kind": "image"},
        ]
    )
    out_dir = tmp_path / "out"
    rc, payload, stderr = run_script(
        "build_index.py", _build_args(asset_list, out_dir), stub_mode="deterministic"
    )
    assert rc == 0, stderr
    assert payload is not None
    assert payload["ok"] is True
    assert payload["assetCount"] == 3
    assert (out_dir / "embeddings.npy").exists()
    assert (out_dir / "asset-uris.json").exists()
    assert (out_dir / "meta.json").exists()


def test_build_embeddings_shape_and_dtype(tmp_path, run_script, make_image, write_asset_list):
    imgs = [make_image(f"img{i}.png", color=(i * 30, 0, 0)) for i in range(3)]
    asset_list = write_asset_list(
        [
            {"workId": "w1", "relPath": p.name, "absPath": str(p), "kind": "image"}
            for p in imgs
        ]
    )
    out_dir = tmp_path / "out"
    rc, _, stderr = run_script(
        "build_index.py", _build_args(asset_list, out_dir), stub_mode="deterministic"
    )
    assert rc == 0, stderr
    arr = np.load(out_dir / "embeddings.npy")
    assert arr.shape == (3, 512)
    assert arr.dtype == np.float32


def test_build_embeddings_l2_normalized(tmp_path, run_script, make_image, write_asset_list):
    imgs = [make_image(f"img{i}.png") for i in range(2)]
    asset_list = write_asset_list(
        [{"workId": "w1", "relPath": p.name, "absPath": str(p), "kind": "image"} for p in imgs]
    )
    out_dir = tmp_path / "out"
    rc, _, _ = run_script(
        "build_index.py", _build_args(asset_list, out_dir), stub_mode="deterministic"
    )
    assert rc == 0
    arr = np.load(out_dir / "embeddings.npy")
    norms = np.linalg.norm(arr, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-5)


def test_build_meta_records_model(tmp_path, run_script, make_image, write_asset_list):
    img = make_image("a.png")
    asset_list = write_asset_list(
        [{"workId": "wA", "relPath": "a.png", "absPath": str(img), "kind": "image"}]
    )
    out_dir = tmp_path / "out"
    rc, _, _ = run_script(
        "build_index.py", _build_args(asset_list, out_dir, work_id="wA"), stub_mode="deterministic"
    )
    assert rc == 0
    meta = json.loads((out_dir / "meta.json").read_text())
    assert meta["model"] == "ViT-B-32"
    assert meta["sourceWorkId"] == "wA"
    assert meta["assetCount"] == 1
    assert meta["embeddingDim"] == 512
    assert "builtAt" in meta


def test_build_skips_unindexable_kinds(tmp_path, run_script, make_image, write_asset_list):
    img = make_image("a.png")
    audio = tmp_path / "song.mp3"
    audio.write_bytes(b"fake-mp3")
    text = tmp_path / "note.txt"
    text.write_text("hello")
    asset_list = write_asset_list(
        [
            {"workId": "w1", "relPath": "a.png", "absPath": str(img), "kind": "image"},
            {"workId": "w1", "relPath": "song.mp3", "absPath": str(audio), "kind": "audio"},
            {"workId": "w1", "relPath": "note.txt", "absPath": str(text), "kind": "text"},
        ]
    )
    out_dir = tmp_path / "out"
    rc, payload, _ = run_script(
        "build_index.py", _build_args(asset_list, out_dir), stub_mode="deterministic"
    )
    assert rc == 0
    assert payload["assetCount"] == 1
    uris = json.loads((out_dir / "asset-uris.json").read_text())
    assert len(uris) == 1
    assert uris[0]["path"] == "a.png"


def test_build_emits_stub_when_no_indexable_assets(
    tmp_path, run_script, write_asset_list
):
    asset_list = write_asset_list([
        {"workId": "w1", "relPath": "x.mp3", "absPath": str(tmp_path / "x.mp3"), "kind": "audio"},
    ])
    out_dir = tmp_path / "out"
    rc, payload, _ = run_script(
        "build_index.py", _build_args(asset_list, out_dir), stub_mode="deterministic"
    )
    assert rc == 0
    assert payload["stub"] is True
    assert payload["reason"] == "no_indexable_assets"


def test_build_records_video_frame_src(
    tmp_path, run_script, make_video, make_image, write_asset_list
):
    """Video assets must have an extracted frameSrc recorded in asset-uris.json."""
    video = make_video("clip.mp4", duration=2.0)
    asset_list = write_asset_list(
        [
            {
                "workId": "w1",
                "relPath": "clips/clip.mp4",
                "absPath": str(video),
                "kind": "video",
            }
        ]
    )
    out_dir = tmp_path / "out"
    rc, payload, stderr = run_script(
        "build_index.py", _build_args(asset_list, out_dir), stub_mode="deterministic"
    )
    assert rc == 0, stderr
    assert payload["assetCount"] == 1
    uris = json.loads((out_dir / "asset-uris.json").read_text())
    assert uris[0]["kind"] == "video"
    assert "frameSrc" in uris[0]
    frame_path = pathlib.Path(uris[0]["frameSrc"])
    assert frame_path.exists()
    assert frame_path.stat().st_size > 0


def test_build_handles_invalid_asset_list_gracefully(tmp_path, run_script):
    bad = tmp_path / "bad.json"
    bad.write_text("not-valid-json{{{")
    out_dir = tmp_path / "out"
    rc, payload, _ = run_script(
        "build_index.py", _build_args(bad, out_dir), stub_mode="deterministic"
    )
    assert rc == 0
    assert payload["stub"] is True
    assert payload["reason"] == "invalid_asset_list"


def test_build_atomic_write_no_tmp_files_left(
    tmp_path, run_script, make_image, write_asset_list
):
    """After a successful build no `.tmp` files should remain in out_dir."""
    img = make_image("a.png")
    asset_list = write_asset_list(
        [{"workId": "w1", "relPath": "a.png", "absPath": str(img), "kind": "image"}]
    )
    out_dir = tmp_path / "out"
    rc, _, _ = run_script(
        "build_index.py", _build_args(asset_list, out_dir), stub_mode="deterministic"
    )
    assert rc == 0
    leftovers = [p.name for p in out_dir.iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []
