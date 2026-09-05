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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", required=True, type=Path)
    parser.add_argument("--id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--summary", required=True)
    parser.add_argument("--homepage", default="")
    parser.add_argument("--out", type=Path, default=Path("dist/art-packs"))
    args = parser.parse_args()

    library = args.library.resolve()
    if not (library / "manifest.json").exists():
        print(f"{library} has no manifest.json", file=sys.stderr)
        return 1

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
