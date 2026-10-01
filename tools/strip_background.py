#!/usr/bin/env python3
"""
Remove the white page rectangle from hand-drawn SVGs.

A drawing made on a page usually starts with a rectangle covering the whole
canvas, painted white, because that is what paper looks like. In an Art Pack it
is a defect: Morphly places the drawing on the figure's own background, and a
baked-in white rectangle shows as a white box over it. It also blinds anything
that measures a drawing's real extent, which is why the viewBox cropper has to
rasterise rather than ask Inkscape for a bounding box.

Only a rectangle that is BOTH white and covering essentially the whole view is
removed, and only when it is drawn before any artwork, so a white panel behind
a label survives. Everything else in the file is left byte for byte as it was,
and the script refuses to write if more than the matched rectangles differ.

Originals are copied beside the library first.

    python tools/strip_background.py Morphly_library --dry-run
    python tools/strip_background.py Morphly_library
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

ROOT = re.compile(r"<svg\b[^>]*>", re.I)
VIEWBOX = re.compile(r'\bviewBox\s*=\s*"([^"]+)"', re.I)
RECT = re.compile(r"<rect\b[^>]*?/>|<rect\b[^>]*?>\s*</rect\s*>", re.I)
ATTR = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')
WHITE = {"#fff", "#ffffff", "white", "rgb(255,255,255)"}
# A rectangle drawn after this much artwork is part of the drawing, not its page.
LOOKAHEAD_ELEMENTS = 3


def covers_view(attrs: dict, view: tuple) -> bool:
    """True when the rectangle covers essentially the whole visible area."""
    vx, vy, vw, vh = view

    def length(value, full):
        value = (value or "").strip()
        if value.endswith("%"):
            try:
                return float(value[:-1]) / 100 * full
            except ValueError:
                return 0.0
        try:
            return float(re.sub(r"px$", "", value))
        except ValueError:
            return 0.0

    w = length(attrs.get("width"), vw)
    h = length(attrs.get("height"), vh)
    x = length(attrs.get("x", "0"), vw)
    y = length(attrs.get("y", "0"), vh)
    return (w >= vw * 0.98 and h >= vh * 0.98 and x <= vx + vw * 0.02 and y <= vy + vh * 0.02)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--backup", type=Path, default=None)
    args = parser.parse_args()

    files = sorted(args.library.glob("*.svg"))
    if not files:
        sys.exit(f"No SVGs in {args.library}")
    backup = args.backup or args.library.with_name(args.library.name + "_before_bg")
    if not args.dry_run:
        backup.mkdir(parents=True, exist_ok=True)

    changed = 0
    for f in files:
        text = f.read_text()
        root = ROOT.search(text)
        vb = VIEWBOX.search(root.group(0)) if root else None
        if not vb:
            print(f"  - {f.name}: no viewBox, skipping"); continue
        view = tuple(float(n) for n in vb.group(1).replace(",", " ").split())

        # Count drawable elements before each rectangle: a page rectangle comes first.
        drawn = 0
        removals = []
        position = root.end()
        for element in re.finditer(r"<(rect|path|circle|ellipse|polygon|polyline|line|text|image|use|g)\b[^>]*>",
                                   text[position:], re.I):
            kind = element.group(1).lower()
            if kind == "rect":
                whole = RECT.match(text, position + element.start())
                attrs = dict(ATTR.findall(element.group(0)))
                fill = (attrs.get("fill") or "").strip().lower()
                if whole and fill in WHITE and covers_view(attrs, view) and drawn <= LOOKAHEAD_ELEMENTS:
                    removals.append((whole.start(), whole.end(), whole.group(0)))
                    continue
            if kind != "g":
                drawn += 1
            if drawn > LOOKAHEAD_ELEMENTS and removals:
                break

        if not removals:
            print(f"  = {f.name}: no page rectangle"); continue

        updated = text
        for start, end, _ in reversed(removals):
            updated = updated[:start] + updated[end:]

        # Guarantee: only the matched rectangles are gone. Putting them back
        # must reproduce the original byte for byte.
        rebuilt = updated
        for start, end, markup in removals:
            rebuilt = rebuilt[:start] + markup + rebuilt[start:]
        if rebuilt != text:
            print(f"  ! {f.name}: refusing to write, more than the rectangle changed"); continue

        for _, _, markup in removals:
            print(f"  {'would strip' if args.dry_run else 'stripped'} {f.name}: {markup.strip()[:70]}")
        if not args.dry_run:
            shutil.copy2(f, backup / f.name)
            f.write_text(updated)
        changed += 1

    print(f"\n{changed} of {len(files)} changed" + ("" if args.dry_run else f", originals in {backup}"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
