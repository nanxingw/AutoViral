#!/usr/bin/env python3
"""
Video Understanding Script for AutoViral.

Extracts metadata, keyframes, scene boundaries, and audio analysis from a video file.
Outputs structured JSON to stdout for the agent to consume.

Usage:
    python3 analyze_video.py <video_path> [--frames-dir /tmp/frames] [--max-frames 30] [--audio-analysis]

Outputs JSON:
{
  "metadata": { "duration", "width", "height", "fps", "codec" },
  "scenes": [ { "start", "end", "duration" } ],
  "frames": [ { "path", "timestamp", "scene_index" } ],
  "audio": { "has_speech", "bpm", "beat_times", "energy_profile" }  // if --audio-analysis
}
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile


def get_metadata(video_path: str) -> dict:
    """Extract video metadata using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,codec_name,duration",
        "-show_entries", "format=duration",
        "-of", "json", video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)

    stream = data.get("streams", [{}])[0]
    fmt = data.get("format", {})

    # Parse frame rate fraction
    fps_str = stream.get("r_frame_rate", "30/1")
    if "/" in fps_str:
        num, den = fps_str.split("/")
        fps = float(num) / float(den) if float(den) != 0 else 30.0
    else:
        fps = float(fps_str)

    duration = float(stream.get("duration") or fmt.get("duration") or 0)

    return {
        "duration": round(duration, 2),
        "width": int(stream.get("width", 0)),
        "height": int(stream.get("height", 0)),
        "fps": round(fps, 2),
        "codec": stream.get("codec_name", "unknown"),
    }


def detect_scenes(video_path: str) -> list:
    """Detect scene boundaries using PySceneDetect."""
    try:
        from scenedetect import detect, ContentDetector
        scenes = detect(video_path, ContentDetector(threshold=30.0))
        return [
            {
                "start": round(s[0].get_seconds(), 2),
                "end": round(s[1].get_seconds(), 2),
                "duration": round(s[1].get_seconds() - s[0].get_seconds(), 2),
            }
            for s in scenes
        ]
    except ImportError:
        print("[warn] scenedetect not installed, using interval-based extraction", file=sys.stderr)
        return []
    except Exception as e:
        print(f"[warn] Scene detection failed: {e}", file=sys.stderr)
        return []


def extract_frames(video_path: str, frames_dir: str, max_frames: int, scenes: list, duration: float) -> list:
    """Extract representative frames using ffmpeg."""
    os.makedirs(frames_dir, exist_ok=True)
    frames = []

    if scenes and len(scenes) >= 3:
        # Extract one frame per scene (at 30% into the scene)
        for i, scene in enumerate(scenes[:max_frames]):
            ts = scene["start"] + scene["duration"] * 0.3
            out_path = os.path.join(frames_dir, f"frame_{i:03d}.jpg")
            subprocess.run([
                "ffmpeg", "-v", "error", "-ss", str(ts),
                "-i", video_path, "-frames:v", "1",
                "-q:v", "2", "-y", out_path
            ], capture_output=True)
            if os.path.exists(out_path):
                frames.append({"path": out_path, "timestamp": round(ts, 2), "scene_index": i})
    else:
        # Interval-based: extract evenly spaced frames
        if duration <= 0:
            return frames
        interval = max(duration / max_frames, 0.5)
        ts = 0.5  # skip very first frame
        i = 0
        while ts < duration and i < max_frames:
            out_path = os.path.join(frames_dir, f"frame_{i:03d}.jpg")
            subprocess.run([
                "ffmpeg", "-v", "error", "-ss", str(ts),
                "-i", video_path, "-frames:v", "1",
                "-q:v", "2", "-y", out_path
            ], capture_output=True)
            if os.path.exists(out_path):
                frames.append({"path": out_path, "timestamp": round(ts, 2), "scene_index": -1})
            ts += interval
            i += 1

    # Also extract scene-change frames via ffmpeg filter
    if not scenes:
        scene_frames_dir = os.path.join(frames_dir, "scene_changes")
        os.makedirs(scene_frames_dir, exist_ok=True)
        subprocess.run([
            "ffmpeg", "-v", "error", "-i", video_path,
            "-vf", f"select='gt(scene,0.35)',scale=640:-1",
            "-vsync", "vfr", "-q:v", "3",
            "-frame_pts", "1",
            os.path.join(scene_frames_dir, "sc_%04d.jpg")
        ], capture_output=True)

    return frames


def analyze_audio(video_path: str) -> dict:
    """Analyze audio: BPM, beats, energy profile."""
    result = {"has_speech": False, "bpm": 0, "beat_times": [], "energy_profile": []}

    # Extract audio to temp wav
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name

    try:
        subprocess.run([
            "ffmpeg", "-v", "error", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "22050", "-ac", "1",
            "-y", wav_path
        ], capture_output=True)

        if not os.path.exists(wav_path) or os.path.getsize(wav_path) < 1000:
            return result

        import librosa
        import numpy as np

        y, sr = librosa.load(wav_path, sr=22050)

        # BPM and beats
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        result["bpm"] = round(float(np.asarray(tempo).flat[0]), 1)
        result["beat_times"] = [round(float(t), 3) for t in beat_times]

        # Onset strength for energy profile (sampled every 0.5s)
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        hop_length = 512
        times = librosa.frames_to_time(range(len(onset_env)), sr=sr, hop_length=hop_length)
        # Downsample to ~2 values per second
        step = max(1, int(0.5 * sr / hop_length))
        energy = []
        for i in range(0, len(onset_env), step):
            chunk = onset_env[i:i + step]
            energy.append({
                "time": round(float(times[i]), 2),
                "energy": round(float(chunk.mean()), 3)
            })
        result["energy_profile"] = energy

        # Simple speech detection: check if there are voiced segments
        rms = librosa.feature.rms(y=y)[0]
        zcr = librosa.feature.zero_crossing_rate(y)[0]
        # Speech tends to have moderate RMS and lower ZCR than music
        voiced_ratio = np.mean((rms > 0.02) & (zcr < 0.1))
        result["has_speech"] = bool(voiced_ratio > 0.15)

    except ImportError:
        print("[warn] librosa not installed, skipping audio analysis", file=sys.stderr)
    except Exception as e:
        print(f"[warn] Audio analysis error: {e}", file=sys.stderr)
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)

    return result


def main():
    parser = argparse.ArgumentParser(description="Analyze video for AutoViral")
    parser.add_argument("video_path", help="Path to video file")
    parser.add_argument("--frames-dir", default=None, help="Directory to save frames (default: /tmp/av-frames-<pid>)")
    parser.add_argument("--max-frames", type=int, default=20, help="Max frames to extract (default: 20)")
    parser.add_argument("--audio-analysis", action="store_true", help="Include audio analysis (BPM, beats)")
    parser.add_argument("--json", action="store_true", help="Output as JSON only (no stderr messages)")
    args = parser.parse_args()

    if not os.path.exists(args.video_path):
        print(json.dumps({"error": f"File not found: {args.video_path}"}))
        sys.exit(1)

    frames_dir = args.frames_dir or os.path.join(tempfile.gettempdir(), f"av-frames-{os.getpid()}")

    # Step 1: Metadata
    metadata = get_metadata(args.video_path)
    if not args.json:
        print(f"[info] Video: {metadata['width']}x{metadata['height']}, {metadata['duration']}s, {metadata['fps']}fps", file=sys.stderr)

    # Step 2: Scene detection
    scenes = detect_scenes(args.video_path)
    if not args.json:
        print(f"[info] Detected {len(scenes)} scenes", file=sys.stderr)

    # Step 3: Frame extraction
    frames = extract_frames(args.video_path, frames_dir, args.max_frames, scenes, metadata["duration"])
    if not args.json:
        print(f"[info] Extracted {len(frames)} frames to {frames_dir}", file=sys.stderr)

    # Step 4: Audio analysis (optional)
    audio = {}
    if args.audio_analysis:
        audio = analyze_audio(args.video_path)
        if not args.json:
            print(f"[info] BPM: {audio.get('bpm', 'N/A')}, Beats: {len(audio.get('beat_times', []))}, Speech: {audio.get('has_speech', False)}", file=sys.stderr)

    # Output
    output = {
        "metadata": metadata,
        "scenes": scenes,
        "frames": frames,
    }
    if audio:
        output["audio"] = audio

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
