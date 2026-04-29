#!/usr/bin/env python3
"""
AutoViral TTS Generation Script (Phase 3.F)

Wraps POST /api/audio/tts on the local backend, which delegates to the TTS
provider registry (Phase 3.E). The agent receives [autoviral:create-asset]
audio/tts envelopes and runs this script with --text/--voice/--output args.

This script is the user-facing CLI. The actual provider selection and
synthesis happens server-side.

Usage:
    python3 tts_generate.py \\
        --text "你好，欢迎来到 AutoViral" \\
        --voice zh-CN-XiaoxiaoNeural \\
        --output assets/audio/intro.mp3 \\
        [--style "warm conversational"]

Environment:
    AUTOVIRAL_BACKEND_URL — default http://localhost:3271
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from typing import Optional


def build_payload(
    text: str,
    voice: str,
    output: str,
    style: Optional[str] = None,
) -> dict:
    """Pure helper — produce the request body for POST /api/audio/tts."""
    p: dict = {"text": text, "voice": voice, "output_path": output}
    if style:
        p["style"] = style
    return p


def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        prog="tts_generate.py",
        description="Generate TTS audio via the AutoViral backend (edge-tts MVP).",
    )
    ap.add_argument("--text", required=True, help="Text to synthesize. SSML-style tags ([sigh]/[laughing]/[whisper]...[/whisper]) are mapped to SSML server-side.")
    ap.add_argument("--voice", required=True, help="Voice id (e.g. zh-CN-XiaoxiaoNeural, en-US-AriaNeural).")
    ap.add_argument("--output", required=True, help="Output file path (.mp3 recommended).")
    ap.add_argument("--style", help="Optional style instruction (currently used by ElevenLabs only — edge-tts ignores).")
    return ap.parse_args(argv)


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


def main(argv=None) -> int:
    args = parse_args(argv)
    payload = build_payload(args.text, args.voice, args.output, args.style)
    backend = os.environ.get("AUTOVIRAL_BACKEND_URL", "http://localhost:3271")
    req = urllib.request.Request(
        f"{backend}/api/audio/tts",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        die(f"TTS request failed: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:500]}")
    except urllib.error.URLError as e:
        die(f"TTS request failed: {e.reason}. Is the backend running at {backend}?")

    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        die(f"Backend returned non-JSON: {body[:200]}")

    if "outputPath" not in result:
        die(f"Backend response missing outputPath: {body[:200]}")

    print(result["outputPath"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
