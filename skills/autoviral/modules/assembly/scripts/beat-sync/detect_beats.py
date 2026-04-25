#!/usr/bin/env python3
"""
Beat detection and analysis script for AutoViral.

Analyzes a music file and outputs beat timestamps, BPM, energy profile,
and suggested cut points for beat-synced video editing.

Usage:
    python3 detect_beats.py <audio_path> [--strong-ratio 0.3] [--output beats.json]

Outputs JSON:
{
  "bpm": 128.0,
  "beat_times": [0.5, 1.0, 1.5, ...],
  "strong_beats": [1.0, 3.0, 5.0, ...],
  "downbeats": [0.5, 2.5, 4.5, ...],
  "energy_curve": [{"time": 0.0, "energy": 0.5}, ...],
  "suggested_cuts": [{"time": 1.0, "type": "strong_beat", "energy": 0.8}, ...]
}
"""

import argparse
import json
import os
import sys


def analyze_beats(audio_path: str, strong_ratio: float = 0.3) -> dict:
    """Full beat analysis of an audio file."""
    import librosa
    import numpy as np

    y, sr = librosa.load(audio_path, sr=22050)
    duration = librosa.get_duration(y=y, sr=sr)

    # Beat tracking
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    bpm = float(np.asarray(tempo).flat[0])

    # Onset strength envelope
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)

    # Strong beats: top N% of onset energy at beat positions
    if len(beat_frames) > 0:
        beat_energies = onset_env[np.clip(beat_frames, 0, len(onset_env) - 1)]
        threshold = np.percentile(beat_energies, (1 - strong_ratio) * 100)
        strong_mask = beat_energies >= threshold
        strong_beats = beat_times[strong_mask].tolist()
        strong_energies = beat_energies[strong_mask].tolist()
    else:
        strong_beats = []
        strong_energies = []

    # Downbeats (every 4th beat for 4/4 time, or use beat_track's built-in)
    downbeats = beat_times[::4].tolist() if len(beat_times) >= 4 else beat_times.tolist()

    # Energy curve (sampled every ~0.25s)
    hop_length = 512
    times = librosa.frames_to_time(range(len(onset_env)), sr=sr, hop_length=hop_length)
    step = max(1, int(0.25 * sr / hop_length))
    energy_curve = []
    for i in range(0, len(onset_env), step):
        chunk = onset_env[i:i + step]
        energy_curve.append({
            "time": round(float(times[min(i, len(times) - 1)]), 3),
            "energy": round(float(chunk.mean()), 4)
        })

    # Suggested cut points: strong beats + onset peaks
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, onset_envelope=onset_env)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)

    suggested_cuts = []
    # Add strong beats as primary cut points
    for t, e in zip(strong_beats, strong_energies):
        suggested_cuts.append({
            "time": round(float(t), 3),
            "type": "strong_beat",
            "energy": round(float(e), 4)
        })

    # Add onset peaks that aren't near existing strong beats
    for ot in onset_times:
        if all(abs(float(ot) - sc["time"]) > 0.15 for sc in suggested_cuts):
            idx = min(int(ot * sr / hop_length), len(onset_env) - 1)
            suggested_cuts.append({
                "time": round(float(ot), 3),
                "type": "onset",
                "energy": round(float(onset_env[idx]), 4)
            })

    # Sort by time
    suggested_cuts.sort(key=lambda x: x["time"])

    return {
        "duration": round(duration, 2),
        "bpm": round(bpm, 1),
        "beat_times": [round(float(t), 3) for t in beat_times],
        "strong_beats": [round(float(t), 3) for t in strong_beats],
        "downbeats": [round(float(t), 3) for t in downbeats],
        "energy_curve": energy_curve,
        "suggested_cuts": suggested_cuts,
        "total_beats": len(beat_times),
        "total_strong_beats": len(strong_beats),
    }


def main():
    parser = argparse.ArgumentParser(description="Detect beats in audio for beat-synced editing")
    parser.add_argument("audio_path", help="Path to audio/music file")
    parser.add_argument("--strong-ratio", type=float, default=0.3, help="Ratio of beats considered 'strong' (default: 0.3)")
    parser.add_argument("--output", "-o", default=None, help="Output JSON file path (default: stdout)")
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"File not found: {args.audio_path}"}), file=sys.stdout)
        sys.exit(1)

    try:
        result = analyze_beats(args.audio_path, args.strong_ratio)
    except ImportError:
        print(json.dumps({"error": "librosa not installed. Run: pip3 install librosa"}), file=sys.stdout)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)

    output_json = json.dumps(result, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output_json)
        print(f"[info] Beats written to {args.output}", file=sys.stderr)
        print(f"[info] BPM: {result['bpm']}, Beats: {result['total_beats']}, Strong: {result['total_strong_beats']}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
