#!/usr/bin/env python3
"""
SadTalker wrapper — generates lip-sync talking-head video from a face image + audio.

Usage:
  python3 sadtalker_generate.py \
    --image face.png \
    --audio narration.mp3 \
    --output output/talking.mp4 \
    [--still] [--enhancer gfpgan] [--size 256|512] [--device cpu|cuda|mps]

Requirements:
  - SadTalker cloned at ~/SadTalker (or set SADTALKER_DIR env var)
  - pip install -r ~/SadTalker/requirements.txt
  - Checkpoints downloaded: cd ~/SadTalker && bash scripts/download_models.sh
"""

import argparse
import subprocess
import sys
import os
import shutil
import glob


def find_sadtalker_dir():
    """Locate SadTalker installation."""
    env_dir = os.environ.get("SADTALKER_DIR")
    if env_dir and os.path.isdir(env_dir):
        return env_dir
    candidates = [
        os.path.expanduser("~/SadTalker"),
        os.path.expanduser("~/sadtalker"),
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "SadTalker"),
    ]
    for c in candidates:
        if os.path.isdir(c) and os.path.isfile(os.path.join(c, "inference.py")):
            return os.path.abspath(c)
    return None


def main():
    parser = argparse.ArgumentParser(description="Generate lip-sync video with SadTalker")
    parser.add_argument("--image", required=True, help="Source face image (png/jpg)")
    parser.add_argument("--audio", required=True, help="Driven audio file (mp3/wav)")
    parser.add_argument("--output", required=True, help="Output video path (mp4)")
    parser.add_argument("--still", action="store_true", default=True,
                        help="Reduce head motion (default: on)")
    parser.add_argument("--no-still", dest="still", action="store_false",
                        help="Allow natural head motion")
    parser.add_argument("--enhancer", default="gfpgan", choices=["gfpgan", "none"],
                        help="Face enhancer (default: gfpgan)")
    parser.add_argument("--size", type=int, default=256, choices=[256, 512],
                        help="Face crop size (default: 256)")
    parser.add_argument("--expression-scale", type=float, default=1.0,
                        help="Expression intensity (default: 1.0)")
    parser.add_argument("--pose-style", type=int, default=0,
                        help="Head pose template 0-45 (default: 0)")
    parser.add_argument("--device", default=None,
                        help="Device: cpu/cuda/mps (auto-detect if omitted)")
    args = parser.parse_args()

    # Find SadTalker
    sd_dir = find_sadtalker_dir()
    if not sd_dir:
        print("ERROR: SadTalker not found. Install it first:", file=sys.stderr)
        print("  git clone https://github.com/OpenTalker/SadTalker.git ~/SadTalker", file=sys.stderr)
        print("  cd ~/SadTalker && pip install -r requirements.txt", file=sys.stderr)
        print("  bash scripts/download_models.sh", file=sys.stderr)
        sys.exit(1)

    # Resolve paths
    image_path = os.path.abspath(args.image)
    audio_path = os.path.abspath(args.audio)
    output_path = os.path.abspath(args.output)
    tmp_dir = os.path.join(os.path.dirname(output_path), "_sadtalker_tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Validate inputs
    if not os.path.isfile(image_path):
        print(f"ERROR: Image not found: {image_path}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(audio_path):
        print(f"ERROR: Audio not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    # Auto-detect device
    device = args.device
    if not device:
        import platform
        if platform.system() == "Darwin":
            device = "cpu"  # MPS is unreliable for SadTalker
        else:
            device = "cuda"

    # Use SadTalker's own venv Python if available
    venv_python = os.path.join(sd_dir, ".venv", "bin", "python")
    python_exe = venv_python if os.path.isfile(venv_python) else sys.executable

    # Build command
    cmd = [
        python_exe, "inference.py",
        "--driven_audio", audio_path,
        "--source_image", image_path,
        "--result_dir", tmp_dir,
        "--preprocess", "crop",
        "--size", str(args.size),
        "--expression_scale", str(args.expression_scale),
        "--pose_style", str(args.pose_style),
    ]
    if device == "cpu":
        cmd.append("--cpu")
    if args.still:
        cmd.append("--still")
    if args.enhancer != "none":
        cmd.extend(["--enhancer", args.enhancer])

    print(f"Running SadTalker...")
    print(f"  Image:  {image_path}")
    print(f"  Audio:  {audio_path}")
    print(f"  Device: {device}")
    print(f"  Still:  {args.still}")
    print(f"  Size:   {args.size}")

    # Run SadTalker
    result = subprocess.run(cmd, cwd=sd_dir, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"SadTalker failed (exit {result.returncode}):", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    # Find output video (SadTalker auto-names it)
    mp4_files = sorted(glob.glob(os.path.join(tmp_dir, "**", "*.mp4"), recursive=True),
                       key=os.path.getmtime, reverse=True)
    if not mp4_files:
        print("ERROR: SadTalker produced no output video", file=sys.stderr)
        print("stdout:", result.stdout, file=sys.stderr)
        sys.exit(1)

    # Move to desired output path
    shutil.move(mp4_files[0], output_path)

    # Cleanup temp
    shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"Done: {output_path}")
    # Print JSON for pipeline consumption
    import json
    print(json.dumps({"success": True, "output": output_path}))


if __name__ == "__main__":
    main()
