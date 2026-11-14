"""Encode recorded PNG frames into a looping animated WebP.

    python tools/encode.py <framesDir> <out.webp> [fps] [quality] [alpha]
"""
import sys
from pathlib import Path

from PIL import Image

src, out = Path(sys.argv[1]), sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 24
quality = int(sys.argv[4]) if len(sys.argv) > 4 else 70
alpha = len(sys.argv) > 5 and sys.argv[5] == "alpha"  # keep transparency (for the embed recording)
frames = [Image.open(p).convert("RGBA" if alpha else "RGB") for p in sorted(src.glob("f*.png"))]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=round(1000 / fps),
               loop=0, quality=quality, method=4, alpha_quality=90)
print(f"{len(frames)} frames -> {out} ({Path(out).stat().st_size / 1e6:.2f} MB)")
