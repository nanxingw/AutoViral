#!/usr/bin/env python3
"""
Beat-synced video editing script for AutoViral.

Takes a video + music file, detects beats, and generates an ffmpeg command
to create a beat-synced edit where video cuts align with music beats.

Usage:
    python3 beat_sync_edit.py --video source.mp4 --music bgm.mp3 --output final.mp4 [--style fast|smooth|dramatic]

Styles:
    fast     - cuts on every strong beat (energetic, 搞笑/抽象类)
    smooth   - cuts on downbeats only (calm, 生活方式类)
    dramatic - alternating long/short cuts with emphasis on drops
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile


def detect_beats(audio_path: str, strong_ratio: float = 0.3) -> dict:
    """Detect beats using librosa."""
    import librosa
    import numpy as np

    y, sr = librosa.load(audio_path, sr=22050)
    duration = librosa.get_duration(y=y, sr=sr)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    bpm = float(np.asarray(tempo).flat[0])

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    if len(beat_frames) > 0:
        beat_energies = onset_env[np.clip(beat_frames, 0, len(onset_env) - 1)]
        threshold = np.percentile(beat_energies, (1 - strong_ratio) * 100)
        strong_mask = beat_energies >= threshold
        strong_beats = beat_times[strong_mask].tolist()
    else:
        strong_beats = []

    downbeats = beat_times[::4].tolist() if len(beat_times) >= 4 else beat_times.tolist()

    return {
        "duration": duration,
        "bpm": bpm,
        "beat_times": [float(t) for t in beat_times],
        "strong_beats": strong_beats,
        "downbeats": downbeats,
    }


def get_video_duration(video_path: str) -> float:
    """Get video duration using ffprobe."""
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return float(result.stdout.strip())


def generate_cuts(beats: dict, video_duration: float, music_duration: float, style: str) -> list:
    """Generate cut timestamps based on style."""
    if style == "fast":
        # Cut on every strong beat
        cut_times = beats["strong_beats"]
    elif style == "smooth":
        # Cut on downbeats only
        cut_times = beats["downbeats"]
    elif style == "dramatic":
        # Alternating: long segment (downbeat) then short (strong beat)
        all_times = sorted(set(beats["downbeats"] + beats["strong_beats"]))
        cut_times = []
        use_next = True
        for t in all_times:
            if use_next:
                cut_times.append(t)
            use_next = not use_next
    else:
        cut_times = beats["strong_beats"]

    # Ensure we have boundaries
    target_duration = min(video_duration, music_duration)
    cut_times = [0.0] + [t for t in cut_times if 0 < t < target_duration] + [target_duration]

    # Generate segments
    segments = []
    for i in range(len(cut_times) - 1):
        seg_start = cut_times[i]
        seg_duration = cut_times[i + 1] - cut_times[i]
        if seg_duration > 0.1:  # Skip very short segments
            # Map to video position (loop if video shorter than music)
            video_start = seg_start % video_duration if video_duration < target_duration else seg_start
            segments.append({
                "video_start": round(video_start, 3),
                "duration": round(seg_duration, 3),
                "music_time": round(seg_start, 3),
            })

    return segments


def build_ffmpeg_command(video_path: str, music_path: str, output_path: str,
                         segments: list, music_volume: float = 0.5) -> list:
    """Build ffmpeg command for beat-synced assembly."""
    tmpdir = tempfile.mkdtemp(prefix="beatsync-")

    # Step 1: Cut individual segments
    clip_paths = []
    for i, seg in enumerate(segments):
        clip_path = os.path.join(tmpdir, f"seg_{i:04d}.mp4")
        cmd = [
            "ffmpeg", "-v", "error",
            "-ss", str(seg["video_start"]),
            "-i", video_path,
            "-t", str(seg["duration"]),
            "-an",  # Remove original audio
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-r", "30",
            "-y", clip_path
        ]
        subprocess.run(cmd, capture_output=True)
        if os.path.exists(clip_path) and os.path.getsize(clip_path) > 0:
            clip_paths.append(clip_path)

    if not clip_paths:
        print("[error] No clips generated", file=sys.stderr)
        return []

    # Step 2: Concatenate clips
    concat_list = os.path.join(tmpdir, "concat.txt")
    with open(concat_list, "w") as f:
        for p in clip_paths:
            f.write(f"file '{p}'\n")

    concat_path = os.path.join(tmpdir, "concat.mp4")
    subprocess.run([
        "ffmpeg", "-v", "error",
        "-f", "concat", "-safe", "0", "-i", concat_list,
        "-c", "copy", "-y", concat_path
    ], capture_output=True)

    # Step 3: Get concat duration for music trimming
    concat_dur = get_video_duration(concat_path)

    # Step 4: Mix with music
    subprocess.run([
        "ffmpeg", "-v", "error",
        "-i", concat_path, "-i", music_path,
        "-filter_complex",
        f"[1:a]volume={music_volume},atrim=0:{concat_dur},afade=t=in:st=0:d=0.5,afade=t=out:st={max(0, concat_dur-1.5)}:d=1.5[bgm]",
        "-map", "0:v", "-map", "[bgm]",
        "-c:v", "copy", "-c:a", "aac",
        "-shortest", "-y", output_path
    ], capture_output=True)

    # Cleanup
    for p in clip_paths:
        os.unlink(p)
    os.unlink(concat_list)
    os.unlink(concat_path)
    os.rmdir(tmpdir)

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Beat-synced video editing")
    parser.add_argument("--video", required=True, help="Source video path")
    parser.add_argument("--music", required=True, help="Music/BGM path")
    parser.add_argument("--output", "-o", required=True, help="Output video path")
    parser.add_argument("--style", default="fast", choices=["fast", "smooth", "dramatic"],
                        help="Cut style (default: fast)")
    parser.add_argument("--music-volume", type=float, default=0.6, help="Music volume 0.0-1.0 (default: 0.6)")
    parser.add_argument("--strong-ratio", type=float, default=0.3, help="Ratio of strong beats (default: 0.3)")
    args = parser.parse_args()

    for path in [args.video, args.music]:
        if not os.path.exists(path):
            print(f"[error] File not found: {path}", file=sys.stderr)
            sys.exit(1)

    print(f"[info] Analyzing music beats...", file=sys.stderr)
    beats = detect_beats(args.music, args.strong_ratio)
    print(f"[info] BPM: {beats['bpm']:.1f}, Total beats: {len(beats['beat_times'])}, Strong: {len(beats['strong_beats'])}", file=sys.stderr)

    video_dur = get_video_duration(args.video)
    print(f"[info] Video: {video_dur:.1f}s, Music: {beats['duration']:.1f}s", file=sys.stderr)

    segments = generate_cuts(beats, video_dur, beats["duration"], args.style)
    print(f"[info] Generated {len(segments)} cut segments (style: {args.style})", file=sys.stderr)

    print(f"[info] Assembling beat-synced video...", file=sys.stderr)
    result = build_ffmpeg_command(args.video, args.music, args.output, segments, args.music_volume)

    if result and os.path.exists(args.output):
        final_dur = get_video_duration(args.output)
        size_mb = os.path.getsize(args.output) / (1024 * 1024)
        print(f"[done] Output: {args.output} ({final_dur:.1f}s, {size_mb:.1f}MB)", file=sys.stderr)

        # Output summary as JSON
        print(json.dumps({
            "output": args.output,
            "duration": round(final_dur, 2),
            "size_mb": round(size_mb, 2),
            "bpm": beats["bpm"],
            "segments": len(segments),
            "style": args.style,
        }, indent=2))
    else:
        print("[error] Failed to produce output", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
