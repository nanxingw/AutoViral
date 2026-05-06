"""Tests for search.py.

Strategy: each test first runs build_index.py (deterministic-stub mode) to
materialize an index, then runs search.py (also deterministic-stub) and
asserts on the JSON payload. The deterministic stub keys both image and
text encodings off a sha256 of the seed, so an asset named "panda.jpg"
and a query "panda" project to the same unit vector — top-1 hit by
construction. This lets us test the full ingest→search ranking pipeline
without the 150MB CLIP weight download.

Stub-mode (open_clip not installed) is exercised via the
`AUTOVIRAL_FORCE_NO_OPEN_CLIP=1` env var, which the script honors at
import-time to simulate the ImportError branch. This avoids the
hard-to-test "monkeypatch a subprocess" scenario.
"""

from __future__ import annotations

import json
import pathlib

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


def _search_args(
    index_dir: pathlib.Path, query: str, top_k: int = 10, work_id: str = "w1"
) -> list[str]:
    return [
        "--work-id",
        work_id,
        "--query",
        query,
        "--top-k",
        str(top_k),
        "--index-dir",
        str(index_dir),
    ]


def _build_then_search(
    run_script,
    write_asset_list,
    make_image,
    tmp_path: pathlib.Path,
    asset_names: list[str],
    query: str,
    top_k: int = 10,
    kinds: list[str] | None = None,
):
    """Helper: build index over `asset_names` images, then run a query.

    Returns the (returncode, payload, stderr) from the search subprocess.
    """
    images = [make_image(name) for name in asset_names]
    kinds = kinds or ["image"] * len(asset_names)
    asset_list = write_asset_list(
        [
            {"workId": "w1", "relPath": p.name, "absPath": str(p), "kind": k}
            for p, k in zip(images, kinds)
        ]
    )
    index_dir = tmp_path / "index"
    rc, _, stderr = run_script(
        "build_index.py",
        _build_args(asset_list, index_dir),
        stub_mode="deterministic",
    )
    assert rc == 0, f"build failed: {stderr}"
    return run_script(
        "search.py",
        _search_args(index_dir, query, top_k=top_k),
        stub_mode="deterministic",
    )


def test_search_results_ordered_by_similarity(
    tmp_path, run_script, make_image, write_asset_list
):
    """Top hit must be the asset whose stem matches the query (deterministic-stub
    hash of identical seeds produces identical vectors → cosine sim = 1.0)."""
    rc, payload, stderr = _build_then_search(
        run_script,
        write_asset_list,
        make_image,
        tmp_path,
        ["panda.png", "city.png", "sunset.png", "robot.png"],
        query="panda",
        top_k=4,
    )
    assert rc == 0, stderr
    assert payload is not None
    assert payload.get("stub") is False
    results = payload["results"]
    assert len(results) == 4
    assert results[0]["uri"] == "panda.png"
    # Scores must be monotonically non-increasing.
    scores = [r["score"] for r in results]
    assert scores == sorted(scores, reverse=True)


def test_search_top_k_respected(tmp_path, run_script, make_image, write_asset_list):
    """k=3 returns 3 even when the index holds 10 assets."""
    rc, payload, stderr = _build_then_search(
        run_script,
        write_asset_list,
        make_image,
        tmp_path,
        [f"img{i}.png" for i in range(10)],
        query="img5",
        top_k=3,
    )
    assert rc == 0, stderr
    assert payload["stub"] is False
    assert len(payload["results"]) == 3
    assert payload["results"][0]["uri"] == "img5.png"


def test_search_empty_query_returns_stub(
    tmp_path, run_script, make_image, write_asset_list
):
    """Empty query short-circuits to a stub payload (D11: still exit 0)."""
    img = make_image("a.png")
    asset_list = write_asset_list(
        [{"workId": "w1", "relPath": "a.png", "absPath": str(img), "kind": "image"}]
    )
    index_dir = tmp_path / "index"
    rc, _, _ = run_script(
        "build_index.py",
        _build_args(asset_list, index_dir),
        stub_mode="deterministic",
    )
    assert rc == 0
    rc, payload, _ = run_script(
        "search.py",
        _search_args(index_dir, query="   ", top_k=5),
        stub_mode="deterministic",
    )
    assert rc == 0
    assert payload["stub"] is True
    assert payload["reason"] == "empty_query"


def test_search_missing_index_dir_returns_stub(tmp_path, run_script):
    """No index files present → {stub:true, reason:"no_index"}, exit 0."""
    empty_dir = tmp_path / "no_index"
    empty_dir.mkdir()
    rc, payload, _ = run_script(
        "search.py",
        _search_args(empty_dir, query="anything", top_k=5),
        stub_mode="deterministic",
    )
    assert rc == 0
    assert payload["stub"] is True
    assert payload["reason"] == "no_index"


def test_search_response_contains_search_ms(
    tmp_path, run_script, make_image, write_asset_list
):
    """Successful real-mode search must include a `searchMs` integer field."""
    rc, payload, stderr = _build_then_search(
        run_script,
        write_asset_list,
        make_image,
        tmp_path,
        ["a.png", "b.png"],
        query="a",
        top_k=2,
    )
    assert rc == 0, stderr
    assert payload["stub"] is False
    assert "searchMs" in payload
    assert isinstance(payload["searchMs"], int)
    assert payload["searchMs"] >= 0


def test_search_video_result_has_frame_src(
    tmp_path, run_script, make_video, write_asset_list
):
    """Video assets in the index must propagate `frameSrc` into search results."""
    video = make_video("clip.mp4", duration=2.0)
    asset_list = write_asset_list(
        [
            {
                "workId": "w1",
                "relPath": "clip.mp4",
                "absPath": str(video),
                "kind": "video",
            }
        ]
    )
    index_dir = tmp_path / "index"
    rc, _, stderr = run_script(
        "build_index.py",
        _build_args(asset_list, index_dir),
        stub_mode="deterministic",
    )
    assert rc == 0, stderr
    rc, payload, stderr = run_script(
        "search.py",
        _search_args(index_dir, query="clip", top_k=1),
        stub_mode="deterministic",
    )
    assert rc == 0, stderr
    assert payload["stub"] is False
    assert len(payload["results"]) == 1
    result = payload["results"][0]
    assert result["uri"] == "clip.mp4"
    assert result["kind"] == "video"
    assert "frameSrc" in result
    assert pathlib.Path(result["frameSrc"]).exists()


# --- Stub-mode coverage (D4 / D11) ----------------------------------------


def test_search_stub_mode_when_open_clip_missing(
    tmp_path, run_script, make_image, write_asset_list
):
    """When open_clip import fails, search.py emits {stub:true} and exits 0."""
    # Build a real index first so we can prove the stub branch trips on the
    # open_clip check rather than on missing index files.
    img = make_image("a.png")
    asset_list = write_asset_list(
        [{"workId": "w1", "relPath": "a.png", "absPath": str(img), "kind": "image"}]
    )
    index_dir = tmp_path / "index"
    rc, _, _ = run_script(
        "build_index.py",
        _build_args(asset_list, index_dir),
        stub_mode="deterministic",
    )
    assert rc == 0
    rc, payload, stderr = run_script(
        "search.py",
        _search_args(index_dir, query="a", top_k=1),
        stub_mode="force_no_open_clip",
    )
    assert rc == 0, stderr
    assert payload is not None
    assert payload["stub"] is True
    assert "open_clip" in payload["reason"].lower()
    assert "results" not in payload or payload.get("results") == []
