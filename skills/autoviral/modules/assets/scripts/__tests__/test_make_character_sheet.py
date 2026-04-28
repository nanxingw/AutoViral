"""Unit tests for make_character_sheet.py pure helpers.

Mocks HTTP entirely — never hits OpenRouter. Covers:
  - mime_from_path extension mapping (jpg/jpeg/png/webp + default)
  - resolve_source_url passthrough for http(s) and base64 inlining for local
  - build_prompt 4-panel structure + outfit/traits substitution + fallback
  - csv_to_list trimming + empty-segment dropping
  - call_openrouter_edit request shape (mocked requests.post)
"""
from __future__ import annotations

import base64
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Make the script importable as a module without installing.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from make_character_sheet import (  # noqa: E402
    build_prompt,
    call_openrouter_edit,
    csv_to_list,
    mime_from_path,
    resolve_source_url,
)


# ── mime_from_path ────────────────────────────────────────────────────


def test_mime_from_path_jpg():
    assert mime_from_path("/foo/bar.jpg") == "image/jpeg"


def test_mime_from_path_jpeg_uppercase():
    assert mime_from_path("/foo/bar.JPEG") == "image/jpeg"


def test_mime_from_path_png():
    assert mime_from_path("/foo/bar.png") == "image/png"


def test_mime_from_path_webp():
    assert mime_from_path("/foo/bar.webp") == "image/webp"


def test_mime_from_path_unknown_falls_back_to_jpeg():
    assert mime_from_path("/foo/bar.xyz") == "image/jpeg"


# ── resolve_source_url ────────────────────────────────────────────────


def test_resolve_source_url_passthrough_for_https():
    url = "https://example.com/foo.jpg"
    assert resolve_source_url(url) == url


def test_resolve_source_url_passthrough_for_http():
    url = "http://example.com/foo.jpg"
    assert resolve_source_url(url) == url


def test_resolve_source_url_inlines_local_file_as_data_uri(tmp_path):
    p = tmp_path / "test.png"
    # Smallest valid 1x1 PNG.
    raw = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c63000100000005000180b40c130000000049454e44ae426082"
    )
    p.write_bytes(raw)
    r = resolve_source_url(str(p))
    assert r.startswith("data:image/png;base64,")
    # Base64 portion decodes back to the original bytes.
    decoded = base64.b64decode(r.split(",", 1)[1])
    assert decoded == raw


def test_resolve_source_url_missing_file_exits(tmp_path):
    missing = tmp_path / "does-not-exist.jpg"
    with pytest.raises(SystemExit):
        resolve_source_url(str(missing))


# ── csv_to_list ───────────────────────────────────────────────────────


def test_csv_to_list_trims_and_joins():
    assert csv_to_list("a, b ,  c", "fallback") == "a, b, c"


def test_csv_to_list_empty_uses_fallback():
    assert csv_to_list(None, "the source image") == "the source image"
    assert csv_to_list("", "fallback") == "fallback"


def test_csv_to_list_drops_empty_segments():
    assert csv_to_list("a, , ,b", "fallback") == "a, b"


# ── build_prompt ──────────────────────────────────────────────────────


def test_build_prompt_includes_4_panels():
    p = build_prompt(outfit="black jacket, white shirt", traits="age 30, calm")
    assert "Panel 1" in p
    assert "Panel 2" in p
    assert "Panel 3" in p
    assert "Panel 4" in p


def test_build_prompt_substitutes_outfit_and_traits():
    p = build_prompt(outfit="black jacket, white shirt", traits="age 30, calm")
    assert "black jacket, white shirt" in p
    assert "age 30, calm" in p


def test_build_prompt_has_pencil_sketch_and_section_headers():
    p = build_prompt(outfit="x", traits="y")
    assert "pencil sketch" in p.lower()
    assert "OUTFIT" in p
    assert "CHARACTER" in p


def test_build_prompt_falls_back_when_outfit_omitted():
    p = build_prompt(outfit=None, traits=None)
    assert "outfit visible in the source image" in p.lower()
    assert "character appearance from the source image" in p.lower()


def test_build_prompt_16_9_layout_marker():
    p = build_prompt(outfit=None, traits=None)
    assert "16:9" in p
    # Sheet must explicitly preserve identity (load-bearing per pneuma).
    assert "Do not invent a different character." in p


# ── call_openrouter_edit (mocked HTTP) ────────────────────────────────


def _fake_response(status: int, payload: dict, ok: bool = True) -> MagicMock:
    resp = MagicMock()
    resp.ok = ok
    resp.status_code = status
    resp.json.return_value = payload
    resp.text = "(mocked)"
    return resp


def test_call_openrouter_edit_request_shape():
    """Verify the POST body matches what OpenRouter gpt-5.4-image-2 edit expects:
      - URL is the chat/completions endpoint
      - Bearer auth header
      - modalities = ['text','image']
      - message content has image_url part FIRST then text part
    """
    # Tiny valid PNG inlined as data URI.
    raw = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c63000100000005000180b40c130000000049454e44ae426082"
    )
    img_b64 = base64.b64encode(raw).decode("ascii")
    response_payload = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "images": [
                        {"image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                    ],
                }
            }
        ]
    }

    with patch("make_character_sheet.requests.post") as mock_post:
        mock_post.return_value = _fake_response(200, response_payload, ok=True)
        out = call_openrouter_edit(
            prompt="THE PROMPT",
            image_url="data:image/png;base64,AAAA",
            api_key="sk-fake",
        )

    assert out == raw

    # Inspect the request that went out.
    assert mock_post.call_count == 1
    call = mock_post.call_args
    url = call.args[0] if call.args else call.kwargs.get("url")
    assert "openrouter.ai" in url and "chat/completions" in url

    headers = call.kwargs["headers"]
    assert headers["Authorization"] == "Bearer sk-fake"

    body = call.kwargs["json"]
    assert body["model"] == "openai/gpt-5.4-image-2"
    assert body["modalities"] == ["text", "image"]
    parts = body["messages"][0]["content"]
    # image first, prompt text second
    assert parts[0]["type"] == "image_url"
    assert parts[0]["image_url"]["url"] == "data:image/png;base64,AAAA"
    assert parts[1]["type"] == "text"
    assert parts[1]["text"] == "THE PROMPT"
    # 16:9 must be requested explicitly so the sheet matches reference layout.
    assert body.get("image_config", {}).get("aspect_ratio") == "16:9"


def test_call_openrouter_edit_raises_on_http_error():
    with patch("make_character_sheet.requests.post") as mock_post:
        mock_post.return_value = _fake_response(403, {}, ok=False)
        with pytest.raises(RuntimeError):
            call_openrouter_edit(
                prompt="p", image_url="https://x", api_key="sk-fake",
            )


def test_call_openrouter_edit_raises_when_no_image_in_response():
    with patch("make_character_sheet.requests.post") as mock_post:
        mock_post.return_value = _fake_response(
            200, {"choices": [{"message": {"content": "no image here"}}]}, ok=True,
        )
        with pytest.raises(RuntimeError):
            call_openrouter_edit(
                prompt="p", image_url="https://x", api_key="sk-fake",
            )
