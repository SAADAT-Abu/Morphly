#!/usr/bin/env python3
"""
Fetch the Reactome Icon Library (https://reactome.org/icon-lib) into a Morphly
asset library.

Reactome's icons are the molecular vocabulary the other libraries are thin on:
receptors, transporters, channels, complexes, modifications, reaction arrows,
the pieces a pathway diagram is actually made of.

**No scraping and no API.** The whole library is a public GitHub repository,
`reactome/reactome_illustrations`, so this streams the repo tarball in one
request and keeps the icon SVGs. Every icon comes as a pair:

    icons/R-ICO-012337.svg      the drawing
    icons/R-ICO-012337.xml      <name>, <description>, <categories>, <person>

which is unusually good metadata for a free library, and maps straight onto
Morphly's manifest: the designer becomes the creator, the categories become the
category and keywords, the description becomes the search text.

**Licensing.** Reactome's licence agreement is explicit: "Pathway Illustrations,
Icon Library, Art, and Branding Materials. This Reactome content is licensed
under the Creative Commons Attribution 4.0 International License (CC BY 4.0)".
Commercial use is allowed and modification is allowed if noted, so everything
here is CC BY 4.0, needs crediting, and none of it is share-alike.

**EHLD diagrams are skipped by default.** The repo also carries 221 Enhanced
High Level Diagrams, which are whole finished figures rather than elements, and
they are large. --include-ehld takes them as their own category.

To run:
    python scraper/reactome_fetcher.py --out ./reactome_library
"""

import argparse
import io
import re
import sys
import tarfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assetlib import (  # noqa: E402
    USER_AGENT, looks_like_svg, report, sanitise_svg, slugify, write_manifest,
)

TARBALL = "https://codeload.github.com/reactome/reactome_illustrations/tar.gz/refs/heads/main"

LICENCE = "CC BY 4.0"
LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/"

ICON_RE = re.compile(r"^[^/]+/icons/(?P<stem>[^/]+)\.(?P<ext>svg|xml)$")
EHLD_RE = re.compile(r"^[^/]+/ehld/(?P<stem>[^/]+)\.svg$")


def parse_metadata(raw: bytes) -> dict:
    """
    Read one icon's XML sidecar.

    Reactome's own tooling writes these, and a few carry <skip>true</skip>,
    which marks an icon it does not publish. Those are left out rather than
    shipped as something Reactome chose to withdraw.
    """
    try:
        root = ET.fromstring(raw.decode("utf-8", "replace"))
    except ET.ParseError:
        return {}
    categories = [c.text.strip() for c in root.findall("./categories/category")
                  if (c.text or "").strip()]
    designer = ""
    for person in root.findall("./person"):
        if (person.get("role") or "").lower() == "designer" and (person.text or "").strip():
            designer = person.text.strip()
            break
    skip = (root.findtext("skip") or "").strip().lower() in {"true", "1", "yes"}
    return {
        "name": (root.findtext("name") or "").strip(),
        "description": (root.findtext("description") or "").strip(),
        "categories": categories,
        "designer": designer,
        "skip": skip,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("./reactome_library"))
    parser.add_argument("--include-ehld", action="store_true",
                        help="also take the 221 whole pathway diagrams")
    parser.add_argument("--include-skipped", action="store_true",
                        help="also take icons Reactome marked <skip>true</skip>")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    print(f"streaming {TARBALL}")
    svgs: dict[str, str] = {}
    metas: dict[str, dict] = {}
    ehlds: dict[str, str] = {}

    request = urllib.request.Request(TARBALL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        with tarfile.open(fileobj=response, mode="r|gz") as tar:
            for member in tar:
                if not member.isfile():
                    continue
                icon = ICON_RE.match(member.name)
                if icon:
                    payload = tar.extractfile(member).read()
                    if icon.group("ext") == "svg":
                        svgs[icon.group("stem")] = payload.decode("utf-8", "replace")
                    else:
                        metas[icon.group("stem")] = parse_metadata(payload)
                    continue
                diagram = EHLD_RE.match(member.name)
                if diagram and args.include_ehld:
                    ehlds[diagram.group("stem")] = \
                        tar.extractfile(member).read().decode("utf-8", "replace")

    print(f"  {len(svgs)} icon SVGs, {len(metas)} metadata files, {len(ehlds)} EHLD diagrams")

    entries = []
    skipped = unpaired = broken = 0

    for stem in sorted(svgs):
        text = svgs[stem]
        meta = metas.get(stem)
        if meta is None:
            unpaired += 1
            meta = {}
        if meta.get("skip") and not args.include_skipped:
            skipped += 1
            continue
        if not looks_like_svg(text):
            broken += 1
            continue

        name = meta.get("name") or stem
        categories = meta.get("categories") or ["Other"]
        # Reactome writes `Cell_Element`; the sidebar should read "Cell Element".
        category = categories[0].replace("_", " ").replace("-", " ").strip().title()
        rel = Path(slugify(category)) / f"{slugify(name)}-{stem.split('-')[-1]}.svg"
        target = args.out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(sanitise_svg(text), encoding="utf-8")

        designer = meta.get("designer") or "Reactome"
        keywords = sorted({*[slugify(c) for c in categories],
                           *slugify(name).split("-"),
                           *slugify(meta.get("description", "")).split("-")[:12]} - {""})
        entries.append({
            "id": f"reactome:{stem}",
            "title": name,
            "category": category,
            "keywords": keywords,
            "description": meta.get("description", ""),
            "license": LICENCE,
            "license_url": LICENCE_URL,
            "requires_attribution": True,
            "share_alike": False,
            "collection": "Reactome Icon Library",
            "creator": designer,
            "credit": "Reactome",
            "citation": f"{designer}. {name}. Reactome Icon Library. "
                        f"https://reactome.org/icon-lib (CC BY 4.0)",
            "source": "reactome",
            "source_page": "https://reactome.org/icon-lib",
            "local_files": [{
                "group_id": stem,
                "caption": name,
                "files": {"SVG": rel.as_posix()},
            }],
        })

    for stem in sorted(ehlds):
        text = ehlds[stem]
        if not looks_like_svg(text):
            broken += 1
            continue
        rel = Path("pathway-diagrams") / f"{slugify(stem)}.svg"
        target = args.out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(sanitise_svg(text), encoding="utf-8")
        entries.append({
            "id": f"reactome-ehld:{stem}",
            "title": stem.replace("_", " "),
            "category": "Pathway Diagrams",
            "keywords": sorted(set(slugify(stem).split("-")) | {"pathway", "diagram"} - {""}),
            "license": LICENCE,
            "license_url": LICENCE_URL,
            "requires_attribution": True,
            "share_alike": False,
            "collection": "Reactome Icon Library",
            "creator": "Reactome",
            "credit": "Reactome",
            "citation": f"Reactome. {stem}. Reactome Enhanced High Level Diagrams. "
                        f"https://reactome.org (CC BY 4.0)",
            "source": "reactome",
            "source_page": "https://reactome.org/icon-lib",
            "local_files": [{
                "group_id": stem,
                "caption": stem.replace("_", " "),
                "files": {"SVG": rel.as_posix()},
            }],
        })

    write_manifest(args.out, entries)
    if skipped:
        print(f"  {skipped} icons left out as <skip>true</skip>")
    if unpaired:
        print(f"  {unpaired} icons had no metadata file")
    if broken:
        print(f"  {broken} files were not SVGs")
    report(entries, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
