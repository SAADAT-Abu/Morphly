#!/usr/bin/env python3
"""
bioart_scraper.py  (v2)

Scrapes NIH BioArt Source (bioart.niaid.nih.gov) into a local, categorized
asset library suitable for feeding into a drag-and-drop figure editor.

HOW IT WORKS
------------
Each entry has a server-rendered Next.js page at:
    https://bioart.niaid.nih.gov/bioart/{id}

Two things are scraped from that page:

1. Human-readable metadata (title, category, keywords, license, creator,
   credit, image type, dates) from the rendered HTML text.

2. The React Server Component (RSC) payload embedded in the page, which
   contains the pieces the visible HTML does NOT expose:

     "filemapping": {"<groupId>": {"AI": <id>, "EPS": <id>,
                                   "PNG": <id>, "SVG": <id>}, ...}
     "carouselItems": [{"fileId":..., "name":..., "fileFormat":...,
                        "caption":..., "bioartFileGroupId":..., ...}]

   `filemapping` is what the site's "pick representation + file type ->
   Download" UI drives off. Every format resolves through the SAME
   endpoint:

     https://bioart.niaid.nih.gov/api/bioarts/{id}/files/{file_id}

   v1 of this script only saw the file ids that appeared in <img src>
   attributes, which are the PNG previews -- so it downloaded rasters only.
   Reading `filemapping` gives us the real SVG/AI/EPS vector file ids.
   (Verified: entry 3 -> SVG id 626573 returns a genuine <svg> document
   carrying its own <metadata> block with title/license/creator/credit.)

An entry can have MULTIPLE file groups -- e.g. entry 8 "Actin Filament"
has 11 groups, which are color/style variants of the same illustration.
Each group gets downloaded separately and recorded as a variant.

NOTE ON HEADERS
---------------
The file endpoint returns NO Content-Type header, so the file extension is
determined by sniffing magic bytes, not by trusting the response.

USAGE
-----
    pip install -r requirements.txt --break-system-packages
    python bioart_scraper.py --start 1 --end 5000 --out ../bioart_library

    # also pull the PNG previews / Illustrator sources:
    python bioart_scraper.py --formats SVG,PNG,AI

Resumable: pass --resume to load an existing manifest.json and skip entry
ids already recorded in it. Without --resume the manifest is rebuilt from
scratch (files already on disk are still re-downloaded).

Be polite: default delay is 0.3s between entries. NIAID BioArt content is
free to use (Public Domain / CC-BY per entry) -- see /faqs#how-to-cite.
This script writes the required citation string per entry into the
manifest so attribution can be auto-inserted into exported figures later.
"""

import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://bioart.niaid.nih.gov"
HEADERS = {"User-Agent": "Mozilla/5.0 (research asset-library scraper; contact: local use only)"}

# Formats offered by the site. SVG is the only one the editor needs: it
# scales losslessly and its fills/strokes can be remapped by the recolor
# panel. PNG previews were dropped from the default -- they were ~55% of the
# library's bytes and the sidebar can render the SVGs directly.
ALL_FORMATS = ["SVG", "PNG", "AI", "EPS"]
DEFAULT_FORMATS = ["SVG"]

# Magic-byte -> extension. The API sends no Content-Type, so sniff instead.
MAGIC = [
    (b"<?xml", "svg"),
    (b"<svg", "svg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"%PDF", "pdf"),   # the "AI" download is a PDF-compatible Illustrator file
    (b"%!PS", "eps"),
    (b"\xc5\xd0\xd3\xc6", "eps"),  # DOS/binary-preview EPS
]


def slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text or "").strip().lower()
    return re.sub(r"[\s-]+", "-", text) or "untitled"


def sniff_ext(data: bytes) -> str:
    head = data[:16]
    for magic, ext in MAGIC:
        if head.startswith(magic):
            return ext
    # SVG sometimes leads with a comment or whitespace
    if b"<svg" in data[:512]:
        return "svg"
    return "bin"


def fetch_entry(entry_id: int, session: requests.Session):
    resp = session.get(f"{BASE}/bioart/{entry_id}", headers=HEADERS, timeout=15)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.text


def _unescape_rsc(fragment: str) -> str:
    r"""RSC payloads are embedded inside a JS string literal, so their JSON is
    backslash-escaped (\" for a quote). Undo that to get parseable JSON."""
    return fragment.replace('\\"', '"').replace("\\\\", "\\")


def parse_filemapping(html: str) -> dict:
    """{groupId: {"SVG": fileId, "PNG": fileId, ...}} from the RSC payload."""
    m = re.search(r'filemapping\\":(\{.*?\}\})', html)
    if not m:
        return {}
    try:
        return json.loads(_unescape_rsc(m.group(1)))
    except json.JSONDecodeError:
        return {}


def parse_carousel(html: str) -> dict:
    """{groupId: {"caption":..., "name":...}} -- gives each variant a label."""
    groups = {}
    for m in re.finditer(
        r'\\"fileId\\":(\d+).*?\\"name\\":\\"(.*?)\\".*?\\"caption\\":\\"(.*?)\\"'
        r'.*?\\"bioartFileGroupId\\":(\d+)',
        html,
    ):
        _, name, caption, gid = m.groups()
        groups.setdefault(gid, {"caption": caption, "name": name})
    # the site sometimes orders bioartFileGroupId before caption; try the flip
    if not groups:
        for m in re.finditer(
            r'\\"bioartFileGroupId\\":(\d+),\\"caption\\":\\"(.*?)\\"', html
        ):
            gid, caption = m.groups()
            groups.setdefault(gid, {"caption": caption, "name": None})
    return groups


def parse_entry(html: str, entry_id: int) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)

    def grab_after(label):
        # crude but effective given the flat text-node structure of this SSR page
        m = re.search(rf"{re.escape(label)}\n([^\n]+)", text)
        return m.group(1).strip() if m else None

    title = grab_after(f"BIOART-{entry_id:06d}")
    keywords = grab_after("Keywords")
    collection = grab_after("Collection")
    submission_date = grab_after("Submission Date:") or ""
    if submission_date.startswith("Submission Date:"):
        submission_date = submission_date.split(":", 1)[1].strip()
    # dates render as "Submission Date: 10/7/2024" inside one text node
    m = re.search(r"Submission Date:\s*([\d/]+)", text)
    submission_date = m.group(1) if m else None

    desc_match = re.search(r"Description\n---\n([^\n]+)", text)
    description = desc_match.group(1).strip() if desc_match else None

    filemapping = parse_filemapping(html)
    captions = parse_carousel(html)

    variants = []
    for gid, formats in sorted(filemapping.items(), key=lambda kv: int(kv[0])):
        variants.append(
            {
                "group_id": int(gid),
                "caption": (captions.get(gid) or {}).get("caption") or title,
                "files": {
                    fmt: urljoin(BASE, f"/api/bioarts/{entry_id}/files/{fid}")
                    for fmt, fid in formats.items()
                },
            }
        )

    # Citation format per BioArt FAQ (/faqs#how-to-cite):
    #   <Collection>. (<date>). <Title>. NIAID NIH BIOART Source. <url>
    citation = (
        f"{collection or 'NIAID Visual & Medical Arts'}. "
        f"({submission_date or 'n.d.'}). {title or 'Untitled'}. "
        f"NIAID NIH BIOART Source. bioart.niaid.nih.gov/bioart/{entry_id}"
    )

    return {
        "id": entry_id,
        "title": title,
        "category": grab_after("Category"),
        "keywords": [k.strip() for k in keywords.split(",")] if keywords else [],
        "license": grab_after("Licensing:"),
        "collection": collection,
        "creator": grab_after("Creator"),
        "credit": grab_after("Credit"),
        "image_type": grab_after("Image Type"),
        "software": grab_after("Illustration Software/Version"),
        "submission_date": submission_date,
        "description": description,
        "variants": variants,
        "citation": citation,
        "source_page": f"{BASE}/bioart/{entry_id}",
    }


def download_files(entry: dict, out_dir: Path, session: requests.Session, formats):
    """Download the requested formats for every variant. Returns a list of
    {group_id, caption, files: {FMT: relative_path}}."""
    dest_dir = out_dir / slugify(entry["category"] or "Uncategorized")
    dest_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify(entry["title"] or f"entry-{entry['id']}")

    local = []
    for variant in entry["variants"]:
        saved = {}
        for fmt in formats:
            url = variant["files"].get(fmt)
            if not url:
                continue
            try:
                r = session.get(url, headers=HEADERS, timeout=30)
            except requests.RequestException as e:
                print(f"    ! {fmt} group {variant['group_id']}: {e}")
                continue
            if r.status_code != 200 or not r.content:
                continue
            ext = sniff_ext(r.content)
            fname = f"{entry['id']:06d}_{slug}_g{variant['group_id']}.{ext}"
            (dest_dir / fname).write_bytes(r.content)
            # store paths relative to the library root so the manifest stays
            # portable if the folder is moved or pointed at from the app
            saved[fmt] = str((dest_dir / fname).relative_to(out_dir))
        if saved:
            local.append(
                {
                    "group_id": variant["group_id"],
                    "caption": variant["caption"],
                    "files": saved,
                }
            )
    return local


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[3])
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--end", type=int, default=5000)
    ap.add_argument("--out", type=str, default="./bioart_library")
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument(
        "--formats",
        type=str,
        default=",".join(DEFAULT_FORMATS),
        help=f"comma-separated subset of {ALL_FORMATS} (default: {','.join(DEFAULT_FORMATS)})",
    )
    ap.add_argument(
        "--resume",
        action="store_true",
        help="load existing manifest.json and skip entry ids already in it",
    )
    args = ap.parse_args()

    formats = [f.strip().upper() for f in args.formats.split(",") if f.strip()]
    bad = [f for f in formats if f not in ALL_FORMATS]
    if bad:
        ap.error(f"unknown format(s) {bad}; choose from {ALL_FORMATS}")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"

    manifest, done = [], set()
    if args.resume and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        done = {e["id"] for e in manifest}
        print(f"Resuming: {len(done)} entries already in {manifest_path}")

    session = requests.Session()
    misses = 0

    for entry_id in range(args.start, args.end + 1):
        if entry_id in done:
            continue
        try:
            html = fetch_entry(entry_id, session)
        except requests.RequestException as e:
            print(f"[{entry_id}] request error: {e}")
            time.sleep(args.delay)
            continue

        if html is None:
            misses += 1
            continue  # 404, no such entry

        entry = parse_entry(html, entry_id)
        entry["local_files"] = download_files(entry, out_dir, session, formats)
        manifest.append(entry)

        n_files = sum(len(v["files"]) for v in entry["local_files"])
        print(
            f"[{entry_id}] {entry['title']} "
            f"({entry['category']}) -> {len(entry['local_files'])} variant(s), "
            f"{n_files} file(s)"
        )

        # write incrementally so a long run can be interrupted safely
        manifest_path.write_text(json.dumps(manifest, indent=2))
        time.sleep(args.delay)

    print(f"\nDone. {len(manifest)} entries in manifest ({misses} ids missing/404).")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
