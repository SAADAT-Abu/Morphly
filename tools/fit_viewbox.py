#!/usr/bin/env python3
"""
Crop an SVG's viewBox to the drawing, touching nothing else.

Artwork drawn on a fixed page arrives in a figure inside whatever empty margin
the page had: the first Morphly drawings covered a median of 70 percent of
their canvas, one of them 41 percent. Morphly places an asset by its box, so
that margin is real, and the user has to compensate for it by hand.

**Only the root <svg> tag is rewritten**, and only its viewBox, width and
height. Every path, group, style and label is left byte for byte as it was,
which is the point: nothing can be "fixed" into a different drawing. The
script refuses to write if anything outside that tag has changed.

Where the bounds come from: the file is rasterised with Inkscape and the ink is
measured. That is slower than asking Inkscape for a bounding box, but these
drawings sit on a white background rectangle covering the whole page, so a
bounding box query answers "the whole page" every time. Ink on white does not
lie. A white-on-white background rectangle is invisible to it, so it is also
ignored, as it should be.

The old files are copied beside the library before anything is written.

    python tools/fit_viewbox.py Morphly_library
    python tools/fit_viewbox.py Morphly_library --dry-run
    python tools/fit_viewbox.py Morphly_library --pad 0.02
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = re.compile(r"<svg\b[^>]*>", re.I)
VIEWBOX = re.compile(r'\bviewBox\s*=\s*"([^"]+)"', re.I)
RENDER_WIDTH = 1200


def render_ink_box(path: Path, view_w: float, view_h: float):
    """Ink bounds in the file's own user units, or None if nothing is drawn."""
    from PIL import Image
    import numpy as np

    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "r.png"
        height = max(1, round(RENDER_WIDTH * view_h / view_w))
        done = subprocess.run(
            ["inkscape", str(path), "--export-type=png", f"--export-filename={png}",
             "--export-area-page", f"--export-width={RENDER_WIDTH}", f"--export-height={height}",
             "--export-background=white", "--export-background-opacity=1"],
            capture_output=True, text=True, timeout=300)
        if not png.exists():
            print(f"  ! could not render {path.name}: "
                  f"{(done.stderr or done.stdout).strip()[-120:]}", file=sys.stderr)
            return None
        grey = np.array(Image.open(png).convert("L"))

    ink = grey < 245
    if not ink.any():
        return None
    ys, xs = ink.nonzero()
    sx, sy = view_w / grey.shape[1], view_h / grey.shape[0]
    return (xs.min() * sx, ys.min() * sy, (xs.max() + 1) * sx, (ys.max() + 1) * sy)


def rewrite_root(root: str, box) -> str:
    """A new root tag with the cropped box, keeping every other attribute."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    out = re.sub(r'\bviewBox\s*=\s*"[^"]*"', f'viewBox="{x0:.2f} {y0:.2f} {w:.2f} {h:.2f}"', root, flags=re.I)
    if "viewBox" not in out:
        out = out.replace("<svg", f'<svg viewBox="{x0:.2f} {y0:.2f} {w:.2f} {h:.2f}"', 1)
    # Width and height, when present, describe the same box, so they follow it.
    out = re.sub(r'\bwidth\s*=\s*"[\d.]+(?:px)?"', f'width="{w:.2f}"', out, flags=re.I)
    out = re.sub(r'\bheight\s*=\s*"[\d.]+(?:px)?"', f'height="{h:.2f}"', out, flags=re.I)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", type=Path)
    parser.add_argument("--pad", type=float, default=0.015,
                        help="margin to leave, as a fraction of the longer side (default 1.5%%)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--backup", type=Path, default=None,
                        help="where the originals go (default: <library>_before_crop)")
    args = parser.parse_args()

    files = sorted(args.library.glob("*.svg"))
    if not files:
        sys.exit(f"No SVGs in {args.library}")

    backup = args.backup or args.library.with_name(args.library.name + "_before_crop")
    if not args.dry_run:
        backup.mkdir(parents=True, exist_ok=True)

    changed = 0
    for f in files:
        text = f.read_text()
        root_match = ROOT.search(text)
        if not root_match:
            print(f"  ! {f.name}: no <svg> tag"); continue
        root = root_match.group(0)
        vb = VIEWBOX.search(root)
        if not vb:
            print(f"  - {f.name}: no viewBox, leaving it to the pack builder"); continue
        vx, vy, vw, vh = (float(n) for n in vb.group(1).replace(",", " ").split())

        ink = render_ink_box(f, vw, vh)
        if ink is None:
            print(f"  - {f.name}: nothing drawn, or could not be measured"); continue

        pad = max(ink[2] - ink[0], ink[3] - ink[1]) * args.pad
        box = (max(vx, vx + ink[0] - pad), max(vy, vy + ink[1] - pad),
               min(vx + vw, vx + ink[2] + pad), min(vy + vh, vy + ink[3] + pad))
        fill = ((box[2] - box[0]) * (box[3] - box[1])) / (vw * vh)
        if fill > 0.98:
            print(f"  = {f.name}: already fits"); continue

        updated = text[:root_match.start()] + rewrite_root(root, box) + text[root_match.end():]

        # The guarantee: nothing outside the root tag may differ.
        if updated[root_match.end() - len(root_match.group(0)):].replace(rewrite_root(root, box), "", 1) != \
           text[root_match.start():].replace(root, "", 1):
            print(f"  ! {f.name}: refusing to write, something outside the root tag changed")
            continue

        print(f"  {'would crop' if args.dry_run else 'cropped'} {f.name}: "
              f"{vw:.0f}x{vh:.0f} -> {box[2]-box[0]:.0f}x{box[3]-box[1]:.0f} "
              f"({fill*100:.0f}% of the old page)")
        if not args.dry_run:
            shutil.copy2(f, backup / f.name)
            f.write_text(updated)
        changed += 1

    print(f"\n{changed} of {len(files)} cropped" + ("" if args.dry_run else f", originals in {backup}"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
