import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tts_generate import build_payload, parse_args


def test_build_payload_minimal():
    p = build_payload(
        text="Hello world",
        voice="en-US-AriaNeural",
        output="/tmp/test.mp3",
        style=None,
    )
    assert p["text"] == "Hello world"
    assert p["voice"] == "en-US-AriaNeural"
    assert p["output_path"] == "/tmp/test.mp3"
    assert "style" not in p or p["style"] is None


def test_build_payload_with_style():
    p = build_payload(
        text="Hi",
        voice="en-US-GuyNeural",
        output="/tmp/x.mp3",
        style="warm conversational",
    )
    assert p["style"] == "warm conversational"


def test_parse_args_defaults():
    args = parse_args(["--text", "Hi", "--voice", "Aria", "--output", "/x.mp3"])
    assert args.text == "Hi"
    assert args.voice == "Aria"
    assert args.output == "/x.mp3"
    assert args.style is None


def test_parse_args_with_style():
    args = parse_args([
        "--text", "Hi", "--voice", "Aria", "--output", "/x.mp3",
        "--style", "newscast",
    ])
    assert args.style == "newscast"
