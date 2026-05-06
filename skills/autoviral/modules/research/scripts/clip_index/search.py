#!/usr/bin/env python3
"""Query a previously-built CLIP semantic-search index.

Usage:
    python3 search.py \\
        --work-id <id> \\
        --query <text> \\
        --top-k <n> \\
        --index-dir <dir> \\
        [--model ViT-B-32]

Reads embeddings.npy + asset-uris.json + meta.json from `--index-dir`,
encodes `--query` with the SAME model recorded in meta.json, runs a
faiss IndexFlatIP cosine search, and emits the top-K asset URIs as JSON.

Stdout contract (last non-empty line is the JSON payload):
    {
      "stub": false,
      "results": [{"uri": "...", "kind": "...", "score": 0.78, "frameSrc"?: "..."}, ...],
      "searchMs": <int>
    }

Stub fall-throughs (per D4/D11, all exit 0):
    - open_clip not installed         → {stub:true, reason:"open_clip_torch not installed"}
    - index files missing             → {stub:true, reason:"no_index"}
    - meta.json model != --model      → {stub:true, reason:"model_mismatch", indexedWith, queriedWith}
    - empty query                     → {stub:true, reason:"empty_query"}
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import time
from typing import Any

# --- Python version guard --------------------------------------------------

if sys.version_info < (3, 10):
    print(json.dumps({"stub": True, "reason": "python_version"}))
    sys.exit(0)

import numpy as np

_FORCE_NO_OPEN_CLIP = bool(os.environ.get("AUTOVIRAL_FORCE_NO_OPEN_CLIP"))
_TEST_STUB = bool(os.environ.get("AUTOVIRAL_TEST_STUB"))

OPEN_CLIP_AVAILABLE = False
FAISS_AVAILABLE = False
if not _FORCE_NO_OPEN_CLIP and not _TEST_STUB:
    try:
        import open_clip  # type: ignore[import]
        import torch  # type: ignore[import]

        OPEN_CLIP_AVAILABLE = True
    except ImportError:
        OPEN_CLIP_AVAILABLE = False

try:
    import faiss  # type: ignore[import]

    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

MODEL_REGISTRY: dict[str, tuple[str, str, int]] = {
    "ViT-B-32": ("ViT-B-32", "laion2b_s34b_b79k", 512),
    "ViT-L-14": ("ViT-L-14", "laion2b_s32b_b82k", 768),
}


def _stub_vector(seed: str, dim: int = 512) -> np.ndarray:
    """Same hash function as build_index.py — text query maps to the same
    space as image filenames so query "panda" matches asset "panda.jpg"."""
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    rng = np.random.default_rng(int.from_bytes(digest[:8], "little"))
    v = rng.standard_normal(dim).astype(np.float32)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _encode_query_real(model, tokenizer, query: str) -> np.ndarray:
    tokens = tokenizer([query])
    with torch.no_grad():  # type: ignore[name-defined]
        emb = model.encode_text(tokens).cpu().numpy().squeeze(0)
    return emb.astype(np.float32)


def _cosine_search(embeddings: np.ndarray, query_vec: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (scores, idxs) for the top-K nearest neighbors.

    Uses faiss IndexFlatIP when faiss is available; falls back to a plain
    numpy dot product (still accurate, slightly slower) when not. Both inputs
    must be L2-normalized so inner product == cosine similarity.
    """
    k = max(1, min(k, embeddings.shape[0]))
    if FAISS_AVAILABLE:
        index = faiss.IndexFlatIP(embeddings.shape[1])
        index.add(embeddings.astype(np.float32))
        scores, idxs = index.search(query_vec.reshape(1, -1).astype(np.float32), k)
        return scores[0], idxs[0]
    sims = embeddings @ query_vec
    order = np.argsort(-sims)[:k]
    return sims[order], order


def main() -> int:
    ap = argparse.ArgumentParser(description="Query a CLIP semantic-search index.")
    ap.add_argument("--work-id", required=True)
    ap.add_argument("--query", required=True)
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--index-dir", required=True)
    ap.add_argument("--model", default=os.environ.get("AUTOVIRAL_CLIP_MODEL", "ViT-B-32"))
    args = ap.parse_args()

    if not args.query.strip():
        _emit({"stub": True, "reason": "empty_query"})
        return 0

    if not OPEN_CLIP_AVAILABLE and not _TEST_STUB:
        _emit({"stub": True, "reason": "open_clip_torch not installed"})
        return 0

    if args.model not in MODEL_REGISTRY:
        _emit({"stub": True, "reason": "unknown_model", "model": args.model})
        return 0
    model_name, pretrain, dim = MODEL_REGISTRY[args.model]

    index_dir = pathlib.Path(args.index_dir)
    embeddings_path = index_dir / "embeddings.npy"
    uris_path = index_dir / "asset-uris.json"
    meta_path = index_dir / "meta.json"

    if not embeddings_path.exists() or not uris_path.exists() or not meta_path.exists():
        _emit({"stub": True, "reason": "no_index"})
        return 0

    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        _emit({"stub": True, "reason": "invalid_meta", "error": str(exc)})
        return 0

    indexed_with = meta.get("model")
    if indexed_with != args.model:
        _emit(
            {
                "stub": True,
                "reason": "model_mismatch",
                "indexedWith": indexed_with,
                "queriedWith": args.model,
            }
        )
        return 0

    started = time.time()

    try:
        embeddings = np.load(embeddings_path)
        uris = json.loads(uris_path.read_text())
    except (OSError, ValueError) as exc:
        _emit({"stub": True, "reason": "index_load_failed", "error": str(exc)})
        return 0

    if embeddings.shape[0] == 0 or not uris:
        _emit({"stub": False, "results": [], "searchMs": 0})
        return 0

    if _TEST_STUB:
        # Use the deterministic stub-vector for the query (same hash space as
        # build_index.py's image stub, keyed by query text).
        q = _stub_vector(args.query.strip(), embeddings.shape[1])
    else:
        try:
            model, _, _ = open_clip.create_model_and_transforms(  # type: ignore[name-defined]
                model_name, pretrained=pretrain
            )
            model.eval()
            tokenizer = open_clip.get_tokenizer(model_name)  # type: ignore[name-defined]
            q = _encode_query_real(model, tokenizer, args.query)
        except Exception as exc:  # noqa: BLE001
            _emit({"stub": True, "reason": "model_load_failed", "error": str(exc)})
            return 0

    n = float(np.linalg.norm(q))
    if n == 0.0:
        _emit({"stub": True, "reason": "zero_query_vector"})
        return 0
    q = (q / n).astype(np.float32)

    scores, idxs = _cosine_search(embeddings.astype(np.float32), q, args.top_k)

    results: list[dict[str, Any]] = []
    for rank, idx in enumerate(idxs):
        i = int(idx)
        if i < 0 or i >= len(uris):
            continue
        record = uris[i]
        out: dict[str, Any] = {
            "uri": record.get("path"),
            "kind": record.get("kind"),
            "score": float(scores[rank]),
        }
        if record.get("frameSrc"):
            out["frameSrc"] = record["frameSrc"]
        results.append(out)

    elapsed_ms = int((time.time() - started) * 1000)
    _emit({"stub": False, "results": results, "searchMs": elapsed_ms})
    return 0


if __name__ == "__main__":
    sys.exit(main())
