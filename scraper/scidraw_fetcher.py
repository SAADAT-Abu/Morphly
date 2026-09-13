#!/usr/bin/env python3
"""
Fetch the SciDraw library (https://scidraw.io) into a Morphly asset library.

SciDraw is community-contributed scientific drawings: whole animals, brains,
behavioural rigs, lab setups. That is material neither NIH BioArt nor Bioicons
covers, which is the reason to have it.

**It has a real API**, unlike BioArt, so no scraping is needed:

    GET https://scidraw.io/api/v1/drawings/?limit=200[&cursor=...]

returns cursor-paginated JSON with `image_url`, `license`, `doi`,
`primary_author` and a category per drawing. This script pages through it,
downloads the vector drawings and writes the same `manifest.json` the other
Morphly libraries use.

**Licensing.** Every drawing is CC-BY or CC0 (roughly 630 and 140 of them), so
all of it is redistributable and none of it is share-alike. The CC-BY ones need
crediting, which the manifest records per drawing so Morphly can flag them and
write the citations into an export.

**Rasters are skipped.** About 160 of the 772 drawings are PNG or JPEG. Morphly
recolours and exports vectors, so a raster in the sidebar would look like an
asset that cannot be recoloured and goes blurry when scaled.

To run:
    python scraper/scidraw_fetcher.py --out ./scidraw_library
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://scidraw.io/api/v1/drawings/"
USER_AGENT = "Morphly-asset-fetcher/1.0 (+https://github.com/SAADAT-Abu/Morphly)"

LICENCES = {
    # slug: (label, url, requires attribution, share-alike)
    "cc-by": ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", True, False),
    "cc0": ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/", False, False),
}

SLUG_SAFE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    return SLUG_SAFE.sub("-", (text or "").lower()).strip("-") or "untitled"


def sanitise_svg(text: str) -> str:
    """
    Strip anything executable before it is ever written to disk.

    Morphly sanitises art packs on install as well, but a library built here can
    be mounted directly from the folder, which skips that step.
    """
    text = re.sub(r"<\s*script[\s\S]*?<\s*/\s*script\s*>", "", text, flags=re.I)
    text = re.sub(r"<\s*script[^>]*/>", "", text, flags=re.I)
    text = re.sub(r"<\s*foreignObject[\s\S]*?<\s*/\s*foreignObject\s*>", "", text, flags=re.I)
    text = re.sub(r"\son[a-z]+\s*=\s*\"[^\"]*\"", "", text, flags=re.I)
    text = re.sub(r"\son[a-z]+\s*=\s*'[^']*'", "", text, flags=re.I)
    return text


def fetch_json(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt == retries - 1:
                raise
            print(f"    retrying after {err}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return {}


def fetch_bytes(url: str, retries: int = 3) -> bytes:
    # The API hands back http:// URLs for its own media; ask for https instead
    # of downloading artwork over a plaintext connection.
    url = url.replace("http://", "https://", 1)
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt == retries - 1:
                raise
            print(f"    retrying after {err}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return b""


def list_drawings(delay: float) -> list:
    """Page through the whole catalogue."""
    url = f"{API}?limit=200"
    rows = []
    while url:
        payload = fetch_json(url)
        rows.extend(payload.get("results", []))
        print(f"  listed {len(rows)} drawings")
        url = payload.get("next")
        if url:
            url = url.replace("http://", "https://", 1)
            time.sleep(delay)
    return rows


def citation_for(row: dict) -> str:
    author = (row.get("primary_author") or {}).get("full_name") or "SciDraw contributor"
    year = (row.get("created_at") or "")[:4]
    name = row.get("name") or "Untitled"
    doi = row.get("doi")
    tail = f"https://doi.org/{doi}" if doi else "https://scidraw.io"
    return f"{author}. ({year}). {name}. SciDraw. {tail}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("./scidraw_library"))
    parser.add_argument("--delay", type=float, default=0.4,
                        help="seconds between requests; be a good citizen")
    parser.add_argument("--include-raster", action="store_true",
                        help="also fetch PNG/JPEG drawings, which Morphly cannot recolour")
    parser.add_argument("--resume", action="store_true",
                        help="skip drawings already written")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "manifest.json"

    existing = {}
    if args.resume and manifest_path.exists():
        existing = {entry["id"]: entry for entry in json.loads(manifest_path.read_text())}
        print(f"resuming: {len(existing)} entries already fetched")

    print("listing the catalogue")
    rows = list_drawings(args.delay)
    wanted = [r for r in rows if args.include_raster or r.get("image_type") == "svg"]
    print(f"{len(rows)} drawings, {len(wanted)} to fetch "
          f"({len(rows) - len(wanted)} raster ones skipped)")

    entries = []
    for index, row in enumerate(wanted, 1):
        asset_id = f"scidraw:{row['slug']}"
        if asset_id in existing:
            entries.append(existing[asset_id])
            continue

        label, url, needs_credit, share_alike = LICENCES.get(
            row.get("license"), ("Unspecified", "", True, False)
        )
        category = row.get("category_name") or "other"
        suffix = "." + (row.get("image_type") or "svg")
        rel = Path(slugify(category)) / f"{slugify(row['name'])}-{row['slug'][-8:]}{suffix}"
        target = args.out / rel
        target.parent.mkdir(parents=True, exist_ok=True)

        try:
            data = fetch_bytes(row["image_url"])
        except Exception as err:
            print(f"  ! {row['name']}: {err}", file=sys.stderr)
            continue

        if suffix == ".svg":
            target.write_text(sanitise_svg(data.decode("utf-8", "replace")), encoding="utf-8")
        else:
            target.write_bytes(data)

        entries.append({
            "id": asset_id,
            "title": row.get("name") or "Untitled",
            "category": category.title(),
            "keywords": sorted({category, *slugify(row.get("name") or "").split("-")} - {""}),
            "license": label,
            "license_url": url,
            "requires_attribution": needs_credit,
            "share_alike": share_alike,
            "collection": "SciDraw",
            "creator": (row.get("primary_author") or {}).get("full_name") or "",
            "credit": "SciDraw",
            "citation": citation_for(row),
            "source": "scidraw",
            "source_page": f"https://scidraw.io/drawings/{row['slug']}",
            "doi": row.get("doi"),
            "local_files": [{
                "group_id": row["slug"],
                "caption": row.get("name") or "",
                "files": {suffix[1:].upper(): rel.as_posix()},
            }],
        })

        if index % 25 == 0 or index == len(wanted):
            manifest_path.write_text(json.dumps(entries, indent=1))
            print(f"  {index}/{len(wanted)} fetched")
        time.sleep(args.delay)

    manifest_path.write_text(json.dumps(entries, indent=1))
    total = sum(f.stat().st_size for f in args.out.rglob("*") if f.is_file())
    credit = sum(1 for e in entries if e["requires_attribution"])
    print(f"\ndone: {len(entries)} drawings, {total / 1e6:.0f} MB")
    print(f"  {credit} need crediting, {len(entries) - credit} are CC0, 0 share-alike")
    return 0


if __name__ == "__main__":
    sys.exit(main())
