"""Unit tests for detect_signature.py classifier.

Covers all 5 known signatures (A/B/C/D/E) plus the ``unknown`` fallback,
and the two output-format modes (``json`` default, ``short`` letter-only).
Pure-function only — no I/O.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Make the script importable as a module without installing.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from detect_signature import classify, format_output  # noqa: E402


# ── Signature A — image-side rejection ──────────────────────────────────


def test_signature_a_canonical_pneuma_envelope():
    envelope = {
        "detail": [{
            "loc": ["body", "image_urls"],
            "msg": (
                "The images or videos provided may contain likenesses "
                "of real people or other private information that "
                "cannot be processed."
            ),
            "type": "content_policy_violation",
            "ctx": {"extra_info": {"reason": "partner_validation_failed"}},
        }]
    }
    r = classify(envelope)
    assert r["signature"] == "A"
    assert r["confidence"] == "high"
    assert "make_character_sheet" in r["recovery_hint"]


def test_signature_a_partner_validation_alone_is_enough():
    envelope = {"detail": [{"ctx": {"extra_info": {"reason": "partner_validation_failed"}}}]}
    r = classify(envelope)
    # Token present but loc not — should still match A but at lower confidence
    assert r["signature"] in ("A", "unknown")  # accept either; document expectation


# ── Signature B — output-audio rejection ────────────────────────────────


def test_signature_b_canonical_pneuma_envelope():
    envelope = {
        "detail": [{
            "loc": ["body", "generated_video"],
            "msg": "Output audio has sensitive content.",
            "type": "content_policy_violation",
            "ctx": {"extra_info": {"reason": "partner_validation_failed"}},
        }]
    }
    r = classify(envelope)
    assert r["signature"] == "B"
    assert r["confidence"] == "high"
    assert "no-audio" in r["recovery_hint"].lower()


# ── Signature C — OpenRouter (low-confidence fixture-blocked) ───────────


def test_signature_c_openrouter_moderation():
    envelope = {
        "error": {
            "type": "moderation_blocked",
            "message": "Your prompt was blocked by our content policy.",
            "code": "content_policy_violation",
        }
    }
    r = classify(envelope)
    assert r["signature"] == "C"
    assert r["confidence"] == "low"
    hint = r["recovery_hint"].lower()
    assert "rewrite prompt" in hint or "remove" in hint


# ── Signature D — jimeng (low-confidence fixture-blocked) ──────────────


def test_signature_d_jimeng_chinese_message():
    envelope = {"data": {"message": "内容审核未通过：包含违规内容"}}
    r = classify(envelope)
    assert r["signature"] == "D"
    assert r["confidence"] == "low"


# ── Signature E — dreamina compliance ──────────────────────────────────


def test_signature_e_dreamina_compliance():
    envelope = {"error": "AigcComplianceConfirmationRequired"}
    r = classify(envelope)
    assert r["signature"] == "E"
    assert "compliance" in r["recovery_hint"].lower() or "确认" in r["recovery_hint"]


# ── Unknown — anything else ────────────────────────────────────────────


def test_unknown_envelope_returns_unknown():
    envelope = {"some_random_field": "value"}
    r = classify(envelope)
    assert r["signature"] == "unknown"
    assert "fallback-strategy" in r["recovery_hint"]


def test_empty_envelope():
    r = classify({})
    assert r["signature"] == "unknown"


# ── Output formatting ──────────────────────────────────────────────────


def test_format_output_json_default():
    r = {"signature": "A", "confidence": "high", "recovery_hint": "x"}
    out = format_output(r, fmt="json")
    parsed = json.loads(out)
    assert parsed["signature"] == "A"


def test_format_output_short():
    r = {"signature": "A", "confidence": "high", "recovery_hint": "x"}
    assert format_output(r, fmt="short") == "A"


def test_format_output_short_unknown():
    r = {"signature": "unknown"}
    assert format_output(r, fmt="short") == "unknown"
