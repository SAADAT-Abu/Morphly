#!/usr/bin/env python3
"""
bioicons_fetcher.py

Downloads the Bioicons library (bioicons.com) into the same local, categorized
layout the BioArt scraper produces, so Morphly can browse both from one sidebar.

WHY A TARBALL AND NOT A SCRAPER
-------------------------------
Bioicons is a static Nuxt site backed entirely by a public GitHub repo
(github.com/duerrsimon/bioicons, MIT). Every icon is a plain file in that repo,
so there is nothing to reverse-engineer and no reason to issue ~2,800 requests
at the website. We stream the repo tarball in ONE request and extract only the
icon SVGs.

The repo also carries ~163 MB of draw.io stencil libraries we have no use for.
Streaming with tarfile in `r|gz` mode means those are read past and discarded
without ever being written to disk.

PATH STRUCTURE (this is the whole metadata schema)
--------------------------------------------------
    static/icons/{license}/{Category}/{Author}/{Name}.svg

License, category and author are encoded in the path itself -- there is no
separate metadata file to fetch. A single icon in the current tree omits the
author segment; that case is handled rather than skipped.

LICENSING -- READ THIS
----------------------
Unlike NIH BioArt (mostly Public Domain), the great majority of Bioicons
REQUIRES ATTRIBUTION, and a few icons are share-alike:

    cc-by-3.0     1376    attribution required
    cc-by-4.0      885    attribution required
    cc-0           488    public domain, attribution appreciated
    mit             39    licence notice required
    cc-by-sa-4.0    35    attribution + SHARE-ALIKE
    cc-by-sa-3.0     4    attribution + SHARE-ALIKE
    bsd              3    licence notice required

Share-alike matters for a figure tool: including one of those icons can oblige
the resulting figure to carry the same licence. Every manifest entry therefore
records `requires_attribution` and `share_alike` flags alongside a ready-made
attribution string, so the editor can surface the obligation instead of
leaving it to be discovered at submission time.

USAGE
-----
    python bioicons_fetcher.py --out ../bioicons_library
    python bioicons_fetcher.py --out ../bioicons_library --max-bytes 1000000

`--max-bytes` skips unusually heavy icons. Most are small (median ~27 KB) but a
long tail is enormous -- one is 11.6 MB with 26,000 paths, which is slow to
render and impractical to recolour swatch by swatch.
"""

import argparse
import io
import json
import re
import tarfile
import unicodedata
from pathlib import Path

import requests

TARBALL = "https://codeload.github.com/duerrsimon/bioicons/tar.gz/refs/heads/main"
SITE = "https://bioicons.com"
REPO = "https://github.com/duerrsimon/bioicons"
HEADERS = {"User-Agent": "Morphly asset fetcher (local use; contact: local)"}

# license directory name -> (human label, url, attribution required, share-alike)
LICENSES = {
    "cc-0": ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/", False, False),
    "cc-by-3.0": ("CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/", True, False),
    "cc-by-4.0": ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", True, False),
    "cc-by-sa-3.0": ("CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/", True, True),
    "cc-by-sa-4.0": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/", True, True),
    "mit": ("MIT", "https://opensource.org/licenses/MIT", True, False),
    "bsd": ("BSD-3-Clause", "https://opensource.org/licenses/BSD-3-Clause", True, False),
}

ICON_RE = re.compile(r"^[^/]+/static/icons/(?P<rest>.+\.svg)$")


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[\s_-]+", "-", text) or "untitled"


def prettify(name: str) -> str:
    """`fly_fertlized_egg_3.5h` -> `Fly fertlized egg 3.5h`."""
    text = re.sub(r"[_-]+", " ", name).strip()
    return text[:1].upper() + text[1:] if text else name


def clean_author(raw: str) -> str:
    """Author directories encode punctuation oddly, e.g.
    `B--Gideon-Bergheim` and `David-Eccles--gringer-`."""
    text = raw.replace("--", " (").replace("_", " ")
    text = text.replace("-", " ").strip()
    text = re.sub(r"\s+", " ", text)
    if "(" in text and not text.endswith(")"):
        text += ")"
    return text


def build_attribution(title, author, license_key):
    label, url, needs_attr, _ = LICENSES.get(license_key, (license_key, "", True, False))
    if not needs_attr:
        return f'"{title}" by {author}, {label} (public domain), via Bioicons ({SITE})'
    return f'"{title}" by {author}, licensed {label} <{url}>, via Bioicons ({SITE})'


def parse_icon_path(rest: str):
    """`{license}/{Category}/{Author}/{Name}.svg` -> metadata dict, or None."""
    parts = rest.split("/")
    if len(parts) == 4:
        license_key, category, author_dir, filename = parts
    elif len(parts) == 3:
        # One icon in the tree has no author directory.
        license_key, category, filename = parts
        author_dir = "Unknown"
    else:
        return None

    if license_key not in LICENSES:
        return None

    name = filename[:-4]  # strip .svg
    title = prettify(name)
    author = clean_author(author_dir)
    label, url, needs_attr, share_alike = LICENSES[license_key]

    keywords = sorted(
        {w.lower() for w in re.split(r"[\s_\-.]+", name) if len(w) > 1}
        | {category.replace("_", " ").lower()}
    )

    return {
        "id": f"bioicons:{license_key}/{category}/{author_dir}/{name}",
        "title": title,
        "category": category.replace("_", " "),
        "keywords": keywords,
        "license": label,
        "license_url": url,
        "requires_attribution": needs_attr,
        "share_alike": share_alike,
        "collection": "Bioicons",
        "creator": author,
        "credit": f"{author} via Bioicons",
        "citation": build_attribution(title, author, license_key),
        "source_page": f"{SITE}/icons?q={name}",
        "source": "bioicons",
        "_dest_name": f"{slugify(author)}_{slugify(name)}.svg",
        "_category_slug": slugify(category),
    }


def main():
    ap = argparse.ArgumentParser(description="Download the Bioicons library.")
    ap.add_argument("--out", default="./bioicons_library")
    ap.add_argument(
        "--max-bytes",
        type=int,
        default=0,
        help="skip icons larger than this many bytes (0 = keep everything)",
    )
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Streaming {TARBALL}")
    print("(one request; draw.io stencil libraries are read past, not saved)\n")

    manifest = []
    skipped_large = 0
    skipped_other = 0
    total_bytes = 0

    with requests.get(TARBALL, headers=HEADERS, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        # r|gz = streaming, single pass, no seeking -- so the archive never has
        # to be buffered to disk or memory in full.
        with tarfile.open(fileobj=resp.raw, mode="r|gz") as tar:
            for member in tar:
                if not member.isfile():
                    continue
                m = ICON_RE.match(member.name)
                if not m:
                    continue

                meta = parse_icon_path(m.group("rest"))
                if meta is None:
                    skipped_other += 1
                    continue

                if args.max_bytes and member.size > args.max_bytes:
                    skipped_large += 1
                    continue

                data = tar.extractfile(member).read()

                dest_dir = out_dir / meta["_category_slug"]
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / meta["_dest_name"]
                dest.write_bytes(data)
                total_bytes += len(data)

                rel = str(dest.relative_to(out_dir))
                entry = {k: v for k, v in meta.items() if not k.startswith("_")}
                entry["local_files"] = [
                    {"group_id": 0, "caption": meta["title"], "files": {"SVG": rel}}
                ]
                manifest.append(entry)

                if len(manifest) % 250 == 0:
                    print(f"  {len(manifest):>5} icons  ({total_bytes/1048576:.0f} MB)")

    manifest.sort(key=lambda e: (e["category"], e["title"]))
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # Summary, with the licence picture spelled out -- it is the thing most
    # likely to matter later and least likely to be checked.
    by_license = {}
    for e in manifest:
        by_license[e["license"]] = by_license.get(e["license"], 0) + 1

    print(f"\nDone. {len(manifest)} icons, {total_bytes/1048576:.1f} MB -> {out_dir}/")
    if skipped_large:
        print(f"Skipped {skipped_large} icons over --max-bytes.")
    if skipped_other:
        print(f"Skipped {skipped_other} files with an unrecognised licence folder.")

    print("\nLicences:")
    for label, count in sorted(by_license.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>5}  {label}")

    needs = sum(1 for e in manifest if e["requires_attribution"])
    sa = sum(1 for e in manifest if e["share_alike"])
    print(f"\n{needs} of {len(manifest)} icons require attribution.")
    print(f"{sa} are SHARE-ALIKE -- using one can oblige the whole figure to match.")
    print(f"\nSource: {REPO} (MIT). Icon licences are per-icon, as above.")


if __name__ == "__main__":
    main()
