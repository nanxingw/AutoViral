#!/usr/bin/env python3
"""AutoViral Filter-Retry Signature Detector (Phase 2.10).

Reads a generation-API error envelope from stdin (or a file via
``--input``) and classifies it into one of the known failure
signatures from ``capabilities/filter-retries.md`` (A through E or
``unknown``). Returns a structured recovery hint pointing the agent at
the right tactical recovery action.

This script does NOT execute recovery itself — it only classifies. The
classification logic mirrors ``capabilities/filter-retries.md``; when
that doc evolves, the signature table in this module MUST evolve in
lockstep.

Usage::

    # default: read from stdin, output JSON
    cat error.json | python3 detect_signature.py

    # read from file
    python3 detect_signature.py --input error.json

    # short form (just the letter)
    python3 detect_signature.py --input error.json --format short

Exit code: always 0 (matching success). ``unknown`` is a legitimate
classification result, not a failure. JSON parse failures are also
non-fatal — the raw text is wrapped and run through the classifiers,
which will land on ``unknown``.

Match strategy: substring search (recursive over nested dict/list).
First-match-wins — signatures are intended to be mutually exclusive in
practice, and ``CLASSIFIERS`` is ordered by descending specificity.

Skill cross-reference: ``capabilities/filter-retries.md``.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Callable, Optional


# ── Recursive token / loc helpers ────────────────────────────────────


def _has_token(envelope: Any, token: str) -> bool:
    """Return True if any string anywhere in ``envelope`` contains ``token``.

    Recurses into dict values, dict keys, and list elements. Non-string
    leaves (ints, bools, None) are ignored.
    """
    if isinstance(envelope, str):
        return token in envelope
    if isinstance(envelope, dict):
        for k, v in envelope.items():
            if isinstance(k, str) and token in k:
                return True
            if _has_token(v, token):
                return True
        return False
    if isinstance(envelope, list):
        return any(_has_token(item, token) for item in envelope)
    return False


def _has_loc(envelope: Any, *fragments: str) -> bool:
    """Return True if any ``loc`` array contains one of the given fragments.

    The pneuma/fal error shape uses ``loc: ["body", "image_urls"]`` (or
    ``["body", "generated_video"]``) to point at the offending field.
    This helper recurses to find any such ``loc`` array and tests for
    membership.
    """
    if isinstance(envelope, dict):
        loc = envelope.get("loc")
        if isinstance(loc, list) and any(
            isinstance(item, str) and item in fragments for item in loc
        ):
            return True
        return any(_has_loc(v, *fragments) for v in envelope.values())
    if isinstance(envelope, list):
        return any(_has_loc(item, *fragments) for item in envelope)
    return False


# ── Per-signature classifiers ────────────────────────────────────────
# Each takes the parsed envelope and returns either a directive dict
# ``{ "signature", "confidence", "recovery_hint", "see_also" }`` or
# ``None`` to defer to the next classifier.


def classify_a(envelope: Any) -> Optional[dict]:
    """Signature A — dreamina/seedance image-side rejection.

    Trigger: ByteDance image classifier flags a ``--image-url`` ref as
    photorealistic-real-person. Prompt is not evaluated; only the image.
    Recovery: replace the ref with a 4-panel character sheet (see
    ``make_character_sheet.py``).
    """
    has_partner = _has_token(envelope, "partner_validation_failed")
    has_likenesses = _has_token(envelope, "may contain likenesses")
    has_loc_image = _has_loc(envelope, "image_urls")
    if (has_partner and has_loc_image) or has_likenesses:
        return {
            "signature": "A",
            "confidence": "high",
            "recovery_hint": (
                "Run make_character_sheet.py on the rejected --image-url "
                "to produce a 16:9 photo-body/sketch-head sheet, replace "
                "the original ref, then re-run the original generation "
                "command."
            ),
            "see_also": "capabilities/filter-retries.md#signature-a",
        }
    if has_partner:
        # Token present but no loc — could still be A, but we cannot rule
        # out B without more context. Mark medium and let the agent verify.
        return {
            "signature": "A",
            "confidence": "medium",
            "recovery_hint": (
                "Suspected image-side rejection (partner_validation_failed "
                "without explicit loc). Inspect refs for photorealistic "
                "faces; consider make_character_sheet.py."
            ),
            "see_also": "capabilities/filter-retries.md#signature-a",
        }
    return None


def classify_b(envelope: Any) -> Optional[dict]:
    """Signature B — dreamina/seedance output-audio rejection.

    Trigger: image passed, frames generated, but the auto-generated
    audio track was flagged. Prompt-independent. Recovery: re-run with
    audio disabled (``--no-audio`` if available, else inject silent
    audio via ``multimodal2video --audio <silent.wav>`` or use a
    no-audio default path).
    """
    has_audio_msg = _has_token(envelope, "Output audio has sensitive content")
    has_loc_video = _has_loc(envelope, "generated_video")
    if has_audio_msg or has_loc_video:
        return {
            "signature": "B",
            "confidence": "high" if has_audio_msg else "medium",
            "recovery_hint": (
                "Re-run with --no-audio (per Phase 2.7 dreamina CLI may "
                "not support the flag — fall back to multimodal2video "
                "with a silent audio track or post-mix in ffmpeg)."
            ),
            "see_also": "capabilities/filter-retries.md#signature-b",
        }
    return None


def classify_c(envelope: Any) -> Optional[dict]:
    """Signature C — OpenRouter content-policy (fixture-blocked, low-conf).

    Best-guess token set per Phase 2.8: ``moderation_blocked`` /
    ``content_policy_violation`` / ``safety_filter`` paired with a
    "policy / blocked / violates" word. Confidence is ``low`` until a
    real OpenRouter envelope is captured.
    """
    moderation_tokens = (
        "moderation_blocked",
        "content_policy_violation",
        "safety_filter",
    )
    rewording_tokens = ("violates", "policy", "blocked", "not allowed", "cannot generate")
    has_moderation = any(_has_token(envelope, t) for t in moderation_tokens)
    has_rewording = any(_has_token(envelope, t) for t in rewording_tokens)
    if has_moderation and has_rewording:
        return {
            "signature": "C",
            "confidence": "low",
            "recovery_hint": (
                "Rewrite prompt to remove sensitive content (named real "
                "people, brand names, explicit/violent terms, political "
                "symbols); retry once. Fixture-blocked: exact OpenRouter "
                "error shape unverified."
            ),
            "see_also": "capabilities/filter-retries.md#signature-c",
        }
    return None


def classify_d(envelope: Any) -> Optional[dict]:
    """Signature D — jimeng (火山) video task rejection (fixture-blocked).

    jimeng_generate.py only surfaces ``data['message']`` (a Chinese
    string). Heuristic: any of the known审核/违规 token fragments
    appearing anywhere in the envelope. Confidence is ``low`` until a
    real jimeng envelope is captured.
    """
    chinese_tokens = ("内容审核", "审核未通过", "违规", "不合规", "敏感", "违反")
    if any(_has_token(envelope, t) for t in chinese_tokens):
        return {
            "signature": "D",
            "confidence": "low",
            "recovery_hint": (
                "jimeng 内容审核拒绝。Rewrite prompt to remove flagged "
                "terms; if --first-frame was used, inspect it for real "
                "faces and run make_character_sheet.py. If persistent, "
                "fall back to dreamina/seedance via the variant flow."
            ),
            "see_also": "capabilities/filter-retries.md#signature-d",
        }
    return None


def classify_e(envelope: Any) -> Optional[dict]:
    """Signature E — dreamina ``AigcComplianceConfirmationRequired``.

    Uniquely-tokened, high-confidence. The user must confirm AIGC
    compliance via the Dreamina account UI; programmatic re-run will
    keep failing.
    """
    if _has_token(envelope, "AigcComplianceConfirmationRequired"):
        return {
            "signature": "E",
            "confidence": "high",
            "recovery_hint": (
                "User must confirm AIGC compliance via Dreamina account "
                "UI (https://jimeng.jianying.com → 该模型 → 完成授权确认). "
                "Programmatic re-run will keep failing; surface to user."
            ),
            "see_also": "capabilities/filter-retries.md#signature-e",
        }
    return None


# ── Dispatcher ──────────────────────────────────────────────────────


# Order reflects descending specificity / confidence:
#   E first  — uniquely-tokened (``AigcComplianceConfirmationRequired``),
#              must not be shadowed by C's broader tokens.
#   B before A — both A and B carry the ``partner_validation_failed``
#              token, so A's medium-confidence fallback would otherwise
#              swallow a canonical B envelope. B's discriminator is the
#              audio-message token + ``loc=generated_video``; A's
#              high-confidence branch keys on ``loc=image_urls``, which
#              never matches a B envelope, so this ordering is safe.
#   A after B — A's high-conf still fires on A envelopes (B sees no
#              audio token there). A's medium fallback then handles the
#              partner_validation_failed-only case.
#   D before C — both fixture-blocked / low-confidence; D's Chinese
#              tokens are narrower than C's English token set, so check
#              D first to avoid C false-matching a jimeng envelope that
#              happens to also stringify to something containing "policy".
CLASSIFIERS: list[Callable[[Any], Optional[dict]]] = [
    classify_e,
    classify_b,
    classify_a,
    classify_d,
    classify_c,
]


def classify(envelope: Any) -> dict:
    """Return the first matching signature directive, or ``unknown`` fallback.

    First-match-wins semantics — signatures are intended to be mutually
    exclusive in practice, but if a future envelope matches more than
    one, the ``CLASSIFIERS`` ordering above governs.
    """
    for fn in CLASSIFIERS:
        r = fn(envelope)
        if r is not None:
            return r
    return {
        "signature": "unknown",
        "confidence": "n/a",
        "recovery_hint": (
            "No matching signature. Surface to user via "
            "capabilities/fallback-strategy.md §1 Level 3 flow; consider "
            "adding a new signature to capabilities/filter-retries.md."
        ),
        "see_also": "capabilities/fallback-strategy.md",
    }


# ── Output formatting ───────────────────────────────────────────────


def format_output(result: dict, fmt: str = "json") -> str:
    """Render a classification result for stdout.

    ``json`` (default) → pretty-printed JSON with ensure_ascii=False so
    Chinese tokens in recovery hints stay readable.
    ``short`` → just the letter (or ``unknown``), no trailing data.
    """
    if fmt == "short":
        return result.get("signature", "unknown")
    return json.dumps(result, ensure_ascii=False, indent=2)


# ── CLI entry ────────────────────────────────────────────────────────


def die(msg: str, code: int = 2) -> None:
    """Single error chokepoint — write to stderr, exit non-zero."""
    print(f"detect_signature.py: {msg}", file=sys.stderr)
    sys.exit(code)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        prog="detect_signature.py",
        description=(
            "Classify a generation-API error envelope into one of the known "
            "filter-retry signatures (A/B/C/D/E or unknown) and return a "
            "structured recovery hint. See capabilities/filter-retries.md."
        ),
    )
    ap.add_argument(
        "--input",
        help="Path to a JSON file (default: read envelope from stdin)",
    )
    ap.add_argument(
        "--format",
        choices=["json", "short"],
        default="json",
        help="Output format: 'json' (default, full directive) or 'short' (letter only)",
    )
    args = ap.parse_args(argv)

    if args.input:
        try:
            with open(args.input, "r", encoding="utf-8") as f:
                raw = f.read()
        except OSError as e:
            die(f"could not read --input {args.input!r}: {e}")
            return 2  # unreachable; satisfies type-checkers
    else:
        raw = sys.stdin.read()

    try:
        envelope: Any = json.loads(raw)
    except json.JSONDecodeError as e:
        # Even an unparseable envelope is data — wrap it so the
        # classifiers can still substring-match against the raw text
        # (jimeng's plain-string error surface, for instance).
        envelope = {"_raw_unparsed": raw, "_parse_error": str(e)}

    result = classify(envelope)
    print(format_output(result, fmt=args.format))
    return 0


if __name__ == "__main__":
    sys.exit(main())
