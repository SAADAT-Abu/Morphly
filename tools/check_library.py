#!/usr/bin/env python3
"""
Check a folder of hand-drawn SVGs before it becomes an Art Pack.

Written for `Morphly_library`, the drawings made for Morphly itself rather than
fetched from somewhere, where nobody else has already enforced a house style.
Every rule here comes from something that actually went wrong:

  installer      Morphly's own validateSvg decides whether a drawing survives
                 installing. A file it calls blank is deleted on the way in, so
                 it is better to hear that here than after publishing.
  fonts          `Arial` alone is absent from most Linux machines, so labels
                 reflowed. The stack below is metric compatible throughout, so
                 a label occupies the same width everywhere.
  dashes         The project writes no em or en dashes, and these drawings are
                 part of the product.
  raster         An embedded PNG cannot be recoloured and goes soft when
                 scaled, which is most of what an illustration is for.
  plot           A rendering of invented numbers has no business being dropped
                 into a figure as artwork: a reader cannot tell it from data.
  framing        Artwork that fills a third of its canvas arrives in a figure
                 inside a wide empty margin. Needs --render, which rasterises
                 each file with Inkscape to measure where the ink actually is.

Nothing is rewritten. This reports, and says what to do.

    python tools/check_library.py Morphly_library
    python tools/check_library.py Morphly_library --render
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# Metric compatible the whole way along: Helvetica on macOS, Arial on Windows,
# Liberation or Nimbus Sans on Linux.
FONT_STACK = "Helvetica,Arial,Liberation Sans,Nimbus Sans,sans-serif"
SAFE_FAMILIES = {"helvetica", "arial", "liberation sans", "nimbus sans", "sans-serif",
                 "serif", "monospace", "times", "times new roman", "courier"}

FONT_DECL = re.compile(r"font-family\s*[:=]\s*[\"']?([^;\"'}>]+)|font\s*:\s*[^;}]*?\d[\d.]*p[xt]\s+([^;}]+)", re.I)
RASTER = re.compile(r"data:image/(png|jpe?g|gif|webp)", re.I)
TITLE = re.compile(r"<title[^>]*>([^<]+)</title>", re.I)


def app_validate(paths: list[Path]) -> dict:
    """Ask Morphly's own validator, so this agrees with the installer by construction."""
    script = (
        "const {validateSvg}=require(process.argv[1]);"
        "const fs=require('fs');"
        "const out={};"
        "for (const f of process.argv.slice(2)) out[f]=validateSvg(fs.readFileSync(f,'utf8')).status;"
        "console.log(JSON.stringify(out));"
    )
    svg_safety = REPO / "app" / "src" / "main" / "svgSafety.js"
    try:
        done = subprocess.run(["node", "-e", script, str(svg_safety), *map(str, paths)],
                              capture_output=True, text=True, timeout=300)
        return json.loads(done.stdout)
    except Exception as err:
        print(f"  ! could not run Morphly's validator ({err}); skipping that check", file=sys.stderr)
        return {}


def ink_fraction(path: Path) -> float | None:
    """How much of the canvas the drawing actually covers, 0 to 1."""
    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "x.png"
        subprocess.run(["inkscape", str(path), "--export-type=png", f"--export-filename={png}",
                        "--export-width=500", "--export-background=white"],
                       capture_output=True, timeout=180)
        if not png.exists():
            return None
        pixels = np.array(Image.open(png).convert("L"))
    ink = pixels < 245
    if not ink.any():
        return 0.0
    ys, xs = ink.nonzero()
    return ((xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)) / pixels.size


def families(text: str) -> set:
    found = set()
    for attr, shorthand in FONT_DECL.findall(text):
        for name in (attr or shorthand).split(","):
            cleaned = name.strip().strip("\"'").lower()
            if cleaned and not re.fullmatch(r"\d+|bold|italic|normal|lighter|bolder", cleaned):
                found.add(cleaned)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", type=Path)
    parser.add_argument("--render", action="store_true",
                        help="also measure how much of each canvas the drawing covers")
    args = parser.parse_args()

    files = sorted(args.library.glob("*.svg"))
    if not files:
        sys.exit(f"No SVGs in {args.library}")

    statuses = app_validate(files)
    titles = {}
    problems = {}

    def note(name, message):
        problems.setdefault(name, []).append(message)

    for f in files:
        text = f.read_text(errors="replace")
        status = statuses.get(str(f))

        if status and status != "ok":
            note(f.name, f"installer: {status}" + (", would be dropped" if status in {"blank", "malformed", "empty"} else ""))

        unsafe = families(text) - SAFE_FAMILIES
        if unsafe:
            note(f.name, f"fonts: {', '.join(sorted(unsafe))}; use {FONT_STACK}")
        if re.search(r"font-family\s*[:=]\s*[\"']?Arial(?![,\w])", text, re.I):
            note(f.name, f"fonts: bare Arial; use {FONT_STACK}")

        for dash, label in (("—", "em dash"), ("–", "en dash")):
            if dash in text:
                note(f.name, f"text: {label}, which the project does not use")

        if RASTER.search(text):
            note(f.name, "raster: embedded bitmap, so it cannot be recoloured or scaled cleanly")
        if "matplotlib" in text.lower():
            note(f.name, "plot: made by matplotlib; artwork should not look like data")
        if not re.search(r"<svg[^>]*\bviewBox=", text, re.I):
            note(f.name, "size: no viewBox, so it has no intrinsic proportions")

        title = TITLE.search(text)
        if title:
            titles.setdefault(title.group(1).strip().lower(), []).append(f.name)

        if args.render:
            fill = ink_fraction(f)
            if fill is not None and fill < 0.75:
                note(f.name, f"framing: the drawing covers {fill * 100:.0f}% of its canvas; "
                             "crop the viewBox so it does not arrive inside a margin")

    for title, names in titles.items():
        if len(names) > 1:
            for name in names:
                note(name, f"title: shared with {', '.join(n for n in names if n != name)}")

    print(f"{len(files)} drawings in {args.library}\n")
    for name in sorted(problems):
        print(f"  {name}")
        for message in problems[name]:
            print(f"      {message}")
    if not problems:
        print("  nothing to fix")
    print(f"\n{len(files) - len(problems)} clean, {len(problems)} with something to look at")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
