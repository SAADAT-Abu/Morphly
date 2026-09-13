#!/usr/bin/env python3
"""
Turn a Morphly library folder into an Art Pack.

An Art Pack is nothing exotic: it is the same folder Morphly already mounts,
zipped, with a `pack.json` describing it. That keeps the app's library loader
untouched, and means a pack stays useful even if someone unzips it by hand and
points Morphly at the folder.

The script also writes the catalogue entry the Art Store reads, including a
thumbnail montage and a sha256, so publishing a pack is: run this, upload the
zip to Zenodo, paste the record URL into the catalogue.

Usage:
    python tools/make_art_pack.py --library bioicons_library \
        --id bioicons --name "Bioicons" --version 1.0.0 \
        --summary "2,830 science icons ..." --out dist/art-packs
"""

import argparse
import hashlib
import json
import random
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

# Only these ever go into a pack. The installer enforces the same list, so a
# pack cannot smuggle in anything executable.
ALLOWED_SUFFIXES = {".svg", ".json", ".png"}

THUMB_TILE = 132          # px per icon in the montage
THUMB_COLS = 4
THUMB_ROWS = 2


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(library: Path) -> list:
    data = json.loads((library / "manifest.json").read_text())
    return data if isinstance(data, list) else data.get("assets", data)


def summarise(entries: list) -> dict:
    """Counts the Art Store shows on the card: what is in here, and what it obliges."""
    categories = Counter()
    licences = Counter()
    attribution = 0
    share_alike = 0

    for entry in entries:
        categories[entry.get("category") or "Uncategorised"] += 1
        licences[(entry.get("license") or "Unspecified").strip()] += 1
        # The scrapers write snake_case; the app maps to camelCase when it
        # loads a library. Accept either so a pack can be built from either.
        if entry.get("requires_attribution") or entry.get("requiresAttribution"):
            attribution += 1
        if entry.get("share_alike") or entry.get("shareAlike"):
            share_alike += 1

    return {
        "entries": len(entries),
        "categories": dict(categories.most_common()),
        "licences": dict(licences.most_common()),
        "requiresAttribution": attribution,
        "shareAlike": share_alike,
    }


def pick_thumbnail_sources(library: Path, entries: list, count: int) -> list:
    """
    Choose icons for the montage.

    Spread across categories rather than taking the first N, so the thumbnail
    shows the range of a pack instead of whatever sorts alphabetically first.
    """
    by_category: dict[str, list[Path]] = {}
    for entry in entries:
        for group in entry.get("local_files") or []:
            svg = (group.get("files") or {}).get("SVG")
            if not svg:
                continue
            path = library / svg
            if path.exists():
                by_category.setdefault(entry.get("category") or "?", []).append(path)
                break

    rng = random.Random(1)  # deterministic, so rebuilding a pack is reproducible
    chosen: list[Path] = []
    categories = sorted(by_category)
    rng.shuffle(categories)
    for category in categories:
        options = by_category[category]
        chosen.append(options[len(options) // 2])
        if len(chosen) == count:
            break
    return chosen


def render_montage(svgs: list, out_png: Path) -> bool:
    """Rasterise a handful of icons into one strip. Inkscape does the drawing."""
    try:
        from PIL import Image
    except ImportError:
        print("  ! Pillow not installed, skipping thumbnail", file=sys.stderr)
        return False

    montage = Image.new("RGBA", (THUMB_TILE * THUMB_COLS, THUMB_TILE * THUMB_ROWS), (0, 0, 0, 0))
    with tempfile.TemporaryDirectory() as tmp:
        for index, svg in enumerate(svgs[: THUMB_COLS * THUMB_ROWS]):
            png = Path(tmp) / f"{index}.png"
            try:
                subprocess.run(
                    ["inkscape", str(svg), "--export-type=png",
                     f"--export-filename={png}", "-w", str(THUMB_TILE), "-h", str(THUMB_TILE)],
                    check=True, capture_output=True, timeout=90,
                )
                tile = Image.open(png).convert("RGBA")
            except Exception as err:  # a single awkward file must not fail the pack
                print(f"  ! could not render {svg.name}: {err}", file=sys.stderr)
                continue
            x = (index % THUMB_COLS) * THUMB_TILE
            y = (index // THUMB_COLS) * THUMB_TILE
            montage.paste(tile, (x, y), tile)

    montage.save(out_png)
    return True


def build_zip(library: Path, pack_meta: dict, out_zip: Path) -> tuple[int, int]:
    """Zip the library, skipping anything outside the allowed extensions."""
    written = skipped = 0
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("pack.json", json.dumps(pack_meta, indent=2))
        for path in sorted(library.rglob("*")):
            if path.is_dir():
                continue
            if path.suffix.lower() not in ALLOWED_SUFFIXES:
                skipped += 1
                continue
            archive.write(path, path.relative_to(library).as_posix())
            written += 1
    return written, skipped


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------

import re
import xml.etree.ElementTree as ET

DRAWABLE = re.compile(r"<(?:[a-z]+:)?(?:path|circle|ellipse|polygon|polyline|line|text|image|use)\b", re.I)
RECT = re.compile(r"<(?:[a-z]+:)?rect\b[^>]*>", re.I)
WHITE_OR_NONE = re.compile(r"fill\s*[:=]\s*[\"']?\s*(?:#fff\b|#ffffff\b|white\b|none\b)", re.I)
ROOT = re.compile(r"<(?:[a-z]+:)?svg\b[^>]*>", re.I)


def fit_to_drawing(path: Path, page_w: float, page_h: float) -> str | None:
    """
    Give a size-less SVG a viewBox that hugs what is actually drawn.

    Some exports declare no size on <svg> and put a page size on a child group
    instead, so the file renders as nothing, or, given the page size, as a
    small figure lost in a corner of a big white page.

    The bounds come from pixels, not from Inkscape's object query: that query
    reports the page group, which is the size we are trying to get away from.
    So render the drawing on its page, find the non-white pixels, and map
    their box back into SVG units.
    """
    try:
        from PIL import Image
    except ImportError:
        return None

    scale = 2.0
    text = path.read_text(errors="replace")
    root = ROOT.search(text)
    if not root:
        return None
    paged = text.replace(
        root.group(0),
        re.sub(r"\s*/?>$", lambda m: f' viewBox="0 0 {page_w} {page_h}" width="{page_w}" height="{page_h}"{m.group(0)}',
               root.group(0)),
        1,
    )
    with tempfile.TemporaryDirectory() as tmp:
        svg = Path(tmp) / "paged.svg"
        png = Path(tmp) / "paged.png"
        svg.write_text(paged, encoding="utf-8")
        # Long options only: Inkscape rejects "-w=1224" ("Cannot parse integer
        # value") and exits without writing anything.
        result = subprocess.run(
            ["inkscape", str(svg), "--export-type=png", f"--export-filename={png}",
             "--export-area-page", f"--export-width={int(page_w * scale)}",
             f"--export-height={int(page_h * scale)}",
             "--export-background=white", "--export-background-opacity=1"],
            capture_output=True, text=True, timeout=180,
        )
        if not png.exists():
            print(f"  ! could not render {path.name} to measure it: "
                  f"{(result.stderr or result.stdout).strip()[-160:]}", file=sys.stderr)
            return None
        gray = Image.open(png).convert("L")
        box = gray.point(lambda v: 255 if v < 245 else 0).getbbox()
    if not box:
        return None

    x0, y0, x1, y1 = (v / scale for v in box)
    w, h = x1 - x0, y1 - y0
    pad = max(w, h) * 0.03  # a little margin so strokes and antialiasing are not clipped
    return f"{x0 - pad:.2f} {y0 - pad:.2f} {w + 2 * pad:.2f} {h + 2 * pad:.2f}"


def clean_library(source: Path, staging: Path) -> dict:
    """
    Copy a library, dropping files that cannot render and framing size-less
    ones, so the published pack is clean rather than relying on the app to
    work around it.
    """
    shutil.copytree(source, staging)
    manifest = json.loads((staging / "manifest.json").read_text())
    entries = manifest if isinstance(manifest, list) else manifest.get("assets", [])
    report = {"dropped": [], "fitted": []}
    kept = []

    for entry in entries:
        groups = []
        for group in entry.get("local_files") or []:
            rel = (group.get("files") or {}).get("SVG")
            if not rel:
                groups.append(group)
                continue
            path = staging / rel
            reason = None
            if not path.exists() or path.stat().st_size == 0:
                reason = "empty"
            else:
                text = path.read_text(errors="replace")
                try:
                    ET.fromstring(text.encode("utf-8", "replace"))
                except ET.ParseError:
                    reason = "malformed"
                else:
                    body = re.sub(r"<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>", "", text, flags=re.I)
                    rects = RECT.findall(body)
                    if not DRAWABLE.search(body) and all(WHITE_OR_NONE.search(r) for r in rects):
                        reason = "blank"
                    else:
                        root = ROOT.search(body)
                        if root and "viewBox" not in root.group(0) and not re.search(r"\b(?:width|height)\s*=", root.group(0)):
                            page = re.search(r"<(?:[a-z]+:)?g\b[^>]*\bwidth\s*=\s*[\"']([\d.]+)(?:px)?[\"'][^>]*\bheight\s*=\s*[\"']([\d.]+)(?:px)?[\"']", body, re.I)
                            box = fit_to_drawing(path, float(page.group(1)), float(page.group(2))) if page else None
                            if not box and page:
                                # Visible but loosely framed beats blank; say so loudly.
                                box = f"0 0 {page.group(1)} {page.group(2)}"
                                print(f"  ! {entry.get('title')!r}: bounds unmeasurable, using the page size", file=sys.stderr)
                            if box:
                                _, _, w, h = box.split()
                                fixed = re.sub(r"\s*/?>$", lambda m: f' viewBox="{box}" width="{w}" height="{h}"{m.group(0)}', root.group(0))
                                path.write_text(text.replace(root.group(0), fixed, 1), encoding="utf-8")
                                report["fitted"].append((entry.get("title"), box))
            if reason:
                path.unlink(missing_ok=True)
                report["dropped"].append((entry.get("title"), reason))
                continue
            groups.append(group)
        if groups:
            kept.append({**entry, "local_files": groups})

    out = kept if isinstance(manifest, list) else {**manifest, "assets": kept}
    (staging / "manifest.json").write_text(json.dumps(out, indent=1))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", required=True, type=Path)
    parser.add_argument("--id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--summary", required=True)
    parser.add_argument("--homepage", default="")
    parser.add_argument("--out", type=Path, default=Path("dist/art-packs"))
    parser.add_argument("--no-clean", action="store_true",
                        help="pack the library exactly as it is, without dropping or fitting files")
    args = parser.parse_args()

    library = args.library.resolve()
    if not (library / "manifest.json").exists():
        print(f"{library} has no manifest.json", file=sys.stderr)
        return 1

    # Pack a cleaned copy, never the library itself, so the source folder stays
    # exactly what the fetcher produced.
    if not args.no_clean:
        staging = Path(tempfile.mkdtemp(prefix=f"{args.id}-clean-")) / "library"
        report = clean_library(library, staging)
        print(f"cleaned: dropped {len(report['dropped'])}, fitted {len(report['fitted'])}")
        for title, why in report["dropped"]:
            print(f"  dropped {title!r}: {why}")
        for title, box in report["fitted"]:
            print(f"  fitted  {title!r}: viewBox {box}")
        library = staging

    args.out.mkdir(parents=True, exist_ok=True)
    entries = read_manifest(library)
    stats = summarise(entries)

    pack_meta = {
        "id": args.id,
        "name": args.name,
        "version": args.version,
        "summary": args.summary,
        "homepage": args.homepage,
        **stats,
    }

    print(f"{args.name}: {stats['entries']} entries, "
          f"{stats['requiresAttribution']} need attribution, {stats['shareAlike']} share-alike")

    zip_path = args.out / f"{args.id}-{args.version}.zip"
    written, skipped = build_zip(library, pack_meta, zip_path)
    size = zip_path.stat().st_size
    print(f"  packed {written} files ({skipped} skipped) -> {zip_path.name}, {size / 1e6:.0f} MB")

    thumb_path = args.out / f"{args.id}-thumb.png"
    thumbnail = ""
    if render_montage(pick_thumbnail_sources(library, entries, THUMB_COLS * THUMB_ROWS), thumb_path):
        import base64
        thumbnail = "data:image/png;base64," + base64.b64encode(thumb_path.read_bytes()).decode()
        print(f"  thumbnail {thumb_path.stat().st_size / 1024:.0f} KB")

    digest = sha256_of(zip_path)
    entry = {
        **pack_meta,
        "file": zip_path.name,
        "bytes": size,
        "sha256": digest,
        # Filled in once the pack is on Zenodo.
        "url": "REPLACE_WITH_ZENODO_FILE_URL",
        "recordUrl": "REPLACE_WITH_ZENODO_RECORD_URL",
        "thumbnail": thumbnail,
    }
    entry_path = args.out / f"{args.id}.catalogue.json"
    entry_path.write_text(json.dumps(entry, indent=2))
    print(f"  sha256 {digest}")
    print(f"  catalogue entry -> {entry_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
