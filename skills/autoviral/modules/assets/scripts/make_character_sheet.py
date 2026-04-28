#!/usr/bin/env python3
"""AutoViral Character Sheet Generator (Phase 2.9).

Produces a 16:9 "photo-body, sketch-head" character reference sheet from a
single source image. The sheet shape is a verified workaround for the image-
side content classifier in dreamina/seedance reference-to-video and similar
generation APIs (see ``capabilities/filter-retries.md`` Signature A).

This is a manual recovery tool the agent calls when reference-mode generation
rejects an image with a content_policy_violation involving a photorealistic
human face. It is NOT invoked automatically.

Port of pneuma's ``make-character-sheet.mjs`` (Node + fal.ai nano-banana-2)
to Python + OpenRouter ``openai/gpt-5.4-image-2`` edit mode. The 4-panel
prompt is preserved verbatim — it is the load-bearing artifact.

Usage::

    python3 make_character_sheet.py \\
        --source-url assets/image/hero.jpg \\
        --outfit "Dark gray wool blazer, black crewneck, charcoal trousers" \\
        --traits "Age ~30, East Asian, calm professional" \\
        --output assets/image/character-sheet-hero.jpg

Flags:
    --source-url  required. Local path or http(s) URL. Local files are
                  inlined as base64 data URI.
    --outfit      optional, comma-separated. If omitted, the outfit is
                  read from the source image.
    --traits      optional, comma-separated. If omitted, defaults to the
                  character appearance from the source image.
    --output      required. Workspace-relative path for the sheet.

Environment:
    OPENROUTER_API_KEY  required; loaded via the same .env discovery as
                        ``openrouter_generate.py``.
"""

from __future__ import annotations

import argparse
import base64
import os
import re
import sys
from pathlib import Path

import requests

# ── Configuration ─────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL_ID = "openai/gpt-5.4-image-2"

MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Verbatim port of pneuma's buildPrompt() — DO NOT edit lightly. The exact
# wording is what defeats dreamina/seedance image-side content filters on
# photorealistic AI characters. Any drift weakens the recovery flow.
PROMPT_TEMPLATE = "\n".join([
    "Create a 16:9 character reference design sheet of the character shown in the source image. Layout: 4 tall vertical panels of equal width arranged side by side with no gaps, pure black background throughout.",
    "",
    "Panel 1 (far left): photographic front view full body of the same character, wearing {outfit_list}, neutral standing pose with arms at sides and empty hands, soft studio lighting, standing on solid black floor. Replace the head (shoulders up) with a clean white-line pencil sketch of the frontal head on the black background, showing eyes, nose, mouth, hairline.",
    "",
    "Panel 2: photographic left-profile side view full body of the same character, same outfit, same lighting, facing left. Replace the head with a clean white-line pencil sketch of a left-profile head on the black background.",
    "",
    "Panel 3: photographic back view full body of the same character, same outfit, same lighting. Replace the head with a clean white-line pencil sketch of the back of the head showing hair only.",
    "",
    "Panel 4 (far right): TOP HALF = detailed pencil graphite portrait on off-white sketch paper showing the character's face in frontal head-and-shoulders framing, preserving the facial identity from the source image, fine pencil shading, visible pencil strokes and cross-hatching, all features (eyes, nose, lips, jaw, hairline) clearly readable — this is a hand-drawn portrait study, NOT a photograph. BOTTOM HALF = clean white typewriter-style English text on the black background, formatted as a character design document. First section header 'OUTFIT' followed by bullet points listing: {outfit_list}. Second section header 'CHARACTER' followed by bullet points listing: {trait_list}. Thin horizontal divider lines between the sections. Professional game / animation character design reference-sheet aesthetic.",
    "",
    "All four panels must show the SAME character. Preserve the face, hair, skin tone, build, and proportions from the source image. Do not invent a different character.",
])


# ── Error handling ────────────────────────────────────────────────────


def die(msg: str) -> None:
    """Single chokepoint for fatal errors. Print to stderr, exit non-zero."""
    print(msg, file=sys.stderr)
    sys.exit(1)


# ── Pure helpers ──────────────────────────────────────────────────────


def mime_from_path(path: str) -> str:
    """Map file extension → MIME, defaulting to image/jpeg."""
    return MIME_BY_EXT.get(Path(path).suffix.lower(), "image/jpeg")


def resolve_source_url(src: str) -> str:
    """Pass http(s) URLs through; inline local files as base64 data URIs."""
    if src.startswith("http://") or src.startswith("https://"):
        return src
    p = Path(src)
    if not p.exists():
        die(f"Source file not found: {src}")
    data = p.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime_from_path(src)};base64,{b64}"


def csv_to_list(csv: str | None, fallback: str) -> str:
    """Trim and rejoin a comma-separated string; fall back if empty."""
    if not csv:
        return fallback
    parts = [p.strip() for p in csv.split(",") if p.strip()]
    return ", ".join(parts) if parts else fallback


def build_prompt(outfit: str | None, traits: str | None) -> str:
    """Substitute outfit + traits into the verbatim 4-panel prompt template."""
    outfit_list = csv_to_list(outfit, "the outfit visible in the source image")
    trait_list = csv_to_list(
        traits, "the character appearance from the source image",
    )
    return PROMPT_TEMPLATE.format(
        outfit_list=outfit_list,
        trait_list=trait_list,
    )


# ── .env discovery (ported verbatim from openrouter_generate.py) ──────


def load_env() -> dict[str, str]:
    """Same .env discovery order as openrouter_generate.py:

    1. ``AUTOVIRAL_PROJECT_DIR`` env-var-pointed directory
    2. ``~/.autoviral/``
    3. Script directory, walking up
    4. cwd, walking up
    """
    search_roots: list[Path] = []

    if project_dir := os.environ.get("AUTOVIRAL_PROJECT_DIR"):
        search_roots.append(Path(project_dir))

    search_roots.append(Path.home() / ".autoviral")
    search_roots.append(Path(__file__).resolve().parent)
    search_roots.append(Path.cwd())

    merged: dict[str, str] = {}
    seen_files: set[Path] = set()

    for root in search_roots:
        current = root
        for _ in range(10):
            candidate = current / ".env"
            if candidate.exists():
                resolved = candidate.resolve()
                if resolved not in seen_files:
                    seen_files.add(resolved)
                    with open(candidate) as f:
                        for line in f:
                            line = line.strip()
                            if not line or line.startswith("#"):
                                continue
                            if "=" in line:
                                key, _, value = line.partition("=")
                                merged.setdefault(key.strip(), value.strip())
                break
            current = current.parent
    return merged


def load_env_api_key() -> str:
    """Read OPENROUTER_API_KEY from environment or a discovered .env."""
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        env_vars = load_env()
        key = env_vars.get("OPENROUTER_API_KEY", "")
    if not key:
        die("OPENROUTER_API_KEY is not set (export it or add it to .env)")
    return key


# ── OpenRouter edit-mode call ─────────────────────────────────────────


_DATA_URI_RE = re.compile(r"data:(image/[^;]+);base64,(.+)", re.DOTALL)


def _extract_image_bytes(data: dict) -> bytes | None:
    """Pull the first image's bytes from a chat/completions response.

    Mirrors the multi-shape extraction in openrouter_generate.py
    (message.images[], string content with embedded data URI, list content
    with image_url / image parts).
    """
    message = data.get("choices", [{}])[0].get("message", {}) or {}
    content = message.get("content")
    images = message.get("images")

    if isinstance(images, list):
        for img in images:
            url = (img.get("image_url") or {}).get("url") or img.get("url", "")
            if url:
                m = _DATA_URI_RE.match(url)
                if m:
                    return base64.b64decode(m.group(2))
            source = img.get("source", {})
            if source.get("data"):
                return base64.b64decode(source["data"])

    if isinstance(content, str):
        m = _DATA_URI_RE.search(content)
        if m:
            return base64.b64decode(m.group(2))

    if isinstance(content, list):
        for part in content:
            if part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url", "")
                m = _DATA_URI_RE.match(url)
                if m:
                    return base64.b64decode(m.group(2))
            elif part.get("type") == "image":
                source = part.get("source", {}) or {}
                if source.get("data"):
                    return base64.b64decode(source["data"])
            elif part.get("type") == "text" and isinstance(part.get("text"), str):
                m = _DATA_URI_RE.search(part["text"])
                if m:
                    return base64.b64decode(m.group(2))

    return None


def call_openrouter_edit(prompt: str, image_url: str, api_key: str) -> bytes:
    """Call gpt-5.4-image-2 in edit mode, return generated image bytes.

    Edit mode = chat/completions with a user message whose content array
    contains an ``image_url`` part (the source) followed by a ``text``
    part (the prompt). modalities=['text','image'] and aspect_ratio=16:9
    enforce the sheet layout.
    """
    payload = {
        "model": MODEL_ID,
        "modalities": ["text", "image"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "image_config": {
            "aspect_ratio": "16:9",
            "image_size": "2K",
        },
    }

    resp = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3271",
        },
        json=payload,
        timeout=180,
    )
    if not resp.ok:
        raise RuntimeError(
            f"OpenRouter edit failed ({resp.status_code}): {resp.text[:500]}"
        )

    data = resp.json()
    if data.get("error"):
        err = data["error"]
        raise RuntimeError(
            f"OpenRouter API error: {err.get('message') or err}"
        )

    image_bytes = _extract_image_bytes(data)
    if not image_bytes:
        raise RuntimeError("OpenRouter response contained no image data")
    return image_bytes


# ── Main ──────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="make_character_sheet.py",
        description=(
            "Generate a 16:9 4-panel character reference sheet to bypass "
            "photorealistic-face content filters in reference-to-video APIs."
        ),
    )
    ap.add_argument(
        "--source-url", required=True,
        help="Local path or http(s) URL of the source character image.",
    )
    ap.add_argument(
        "--outfit",
        help="Comma-separated outfit items. If omitted, read from source image.",
    )
    ap.add_argument(
        "--traits",
        help="Comma-separated character traits. If omitted, read from source image.",
    )
    ap.add_argument(
        "--output", required=True,
        help="Workspace-relative output path for the generated sheet.",
    )

    args = ap.parse_args(argv)

    api_key = load_env_api_key()
    image_url = resolve_source_url(args.source_url)
    prompt = build_prompt(outfit=args.outfit, traits=args.traits)

    try:
        image_bytes = call_openrouter_edit(prompt, image_url, api_key)
    except requests.RequestException as e:
        die(f"OpenRouter request failed: {e}")
    except RuntimeError as e:
        die(str(e))
    except (KeyError, IndexError, ValueError) as e:
        die(f"OpenRouter response parse failed: {e}")

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(image_bytes)
    print(str(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
