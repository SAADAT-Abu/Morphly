#!/usr/bin/env python3
"""
Fetch Health Icons (https://healthicons.org) into a Morphly asset library.

Health Icons is about a thousand public-health pictograms: clinics and wards,
staff and patients, equipment, medicines, vaccines, symptoms, vectors and
zoonoses. The style is flat and diagrammatic rather than illustrative, which
makes it the right vocabulary for study designs, clinical workflows and
consort-style figures, and the wrong one for a molecular picture. It is its own
pack for that reason.

**No scraping.** Like Bioicons, the whole library is a public GitHub repo, so
this streams the tarball once and keeps the icon SVGs.

    public/icons/svg/{variant}/{category}/{name}.svg

The repo ships each pictogram in four variants: `filled` and `outline` at full
size, 749 icons each, and `filled-24px` and `outline-24px`, a 282 icon subset
drawn for small sizes. Only `filled` is taken by default, because four copies of
the same pictogram in a sidebar is noise rather than choice; --variant outline
or --variant all change that.

**Licensing is the easy part.** Health Icons states it plainly: "All icons are
open source, licensed under a Creative Commons CC0 License." Nothing here needs
crediting and nothing is share-alike, which makes this the one pack a user can
drop into a figure without reading anything first. The manifest still records
CC0 per icon so the sidebar badge and the export dialog stay honest.

To run:
    python scraper/healthicons_fetcher.py --out ./healthicons_library
"""

import argparse
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assetlib import (  # noqa: E402
    USER_AGENT, looks_like_svg, prettify, report, sanitise_svg, slugify, write_manifest,
)

TARBALL = "https://codeload.github.com/resolvetosavelives/healthicons/tar.gz/refs/heads/main"

LICENCE = "CC0 1.0"
LICENCE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"

ICON_RE = re.compile(
    r"^[^/]+/public/icons/svg/(?P<variant>[^/]+)/(?P<category>[^/]+)/(?P<name>[^/]+)\.svg$"
)


# Health Icons names files for the filesystem, not for a sidebar: `blood-ab_n`,
# `rdt-result-mixed-invalid`, `cpap-masks`. Left alone those become "Blood ab n"
# and "Rdt result...", which is what a user would be searching past rather than
# for. These two rules fix the cases that actually occur in the set.
ACRONYMS = {
    "rdt": "RDT", "cpap": "CPAP", "iud": "IUD", "ppe": "PPE", "hiv": "HIV",
    "tb": "TB", "sti": "STI", "icu": "ICU", "ecg": "ECG", "iv": "IV",
    "ors": "ORS", "art": "ART", "bp": "BP", "ct": "CT", "mri": "MRI",
    "x": "X", "ui": "UI", "who": "WHO", "hpv": "HPV", "std": "STD",
    "imci": "IMCI", "pmtct": "PMTCT", "anc": "ANC", "pnc": "PNC",
}

BLOOD_GROUPS = {"a": "A", "b": "B", "ab": "AB", "o": "O"}


def nice_title(raw_name: str, category: str) -> str:
    """`blood-ab_n` -> `Blood AB negative`, `rdt-result-mixed` -> `RDT result mixed`."""
    words = [w for w in re.split(r"[-_\s]+", raw_name.strip()) if w]

    if category == "blood" and len(words) >= 2:
        # The set writes blood groups as `blood-<group>_<n|p>`.
        group = BLOOD_GROUPS.get(words[1].lower())
        sign = {"n": "negative", "p": "positive"}.get(words[-1].lower())
        if group and sign:
            return f"Blood {group} {sign}"

    out = []
    for index, word in enumerate(words):
        known = ACRONYMS.get(word.lower())
        if known:
            out.append(known)
        elif index == 0:
            out.append(word if word.isupper() else word.capitalize())
        else:
            out.append(word)
    return " ".join(out) or "Untitled"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("./healthicons_library"))
    parser.add_argument("--variant", default="filled",
                        help="which drawing style to keep: filled, outline, "
                             "filled-24px, outline-24px, or 'all' for every one")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    keep_all = args.variant.lower() == "all"

    print(f"streaming {TARBALL}")
    entries = []
    seen_variants = set()
    broken = 0

    request = urllib.request.Request(TARBALL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        with tarfile.open(fileobj=response, mode="r|gz") as tar:
            for member in tar:
                if not member.isfile():
                    continue
                match = ICON_RE.match(member.name)
                if not match:
                    continue
                variant = match.group("variant")
                seen_variants.add(variant)
                if not keep_all and variant != args.variant:
                    continue

                text = tar.extractfile(member).read().decode("utf-8", "replace")
                if not looks_like_svg(text):
                    broken += 1
                    continue

                raw_category = match.group("category")
                raw_name = match.group("name")
                category = prettify(raw_category)
                title = nice_title(raw_name, raw_category)
                stem = f"{slugify(raw_name)}" + ("" if not keep_all else f"-{slugify(variant)}")
                rel = Path(slugify(category)) / f"{stem}.svg"
                target = args.out / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(sanitise_svg(text), encoding="utf-8")

                entries.append({
                    "id": f"healthicons:{variant}:{raw_category}/{raw_name}",
                    "title": title,
                    "category": category,
                    "keywords": sorted({*slugify(raw_name).split("-"),
                                        *slugify(raw_category).split("-")} - {""}),
                    "license": LICENCE,
                    "license_url": LICENCE_URL,
                    "requires_attribution": False,
                    "share_alike": False,
                    "collection": "Health Icons",
                    "creator": "Health Icons contributors",
                    "credit": "Health Icons",
                    "citation": "Health Icons (healthicons.org), CC0 1.0. "
                                "Crediting is not required.",
                    "source": "healthicons",
                    "source_page": f"https://healthicons.org/icons/{raw_name}",
                    "local_files": [{
                        "group_id": f"{raw_category}/{raw_name}",
                        "caption": title,
                        "files": {"SVG": rel.as_posix()},
                    }],
                })

    write_manifest(args.out, entries)
    print(f"  variants in the repo: {', '.join(sorted(seen_variants))}")
    if broken:
        print(f"  {broken} files were not SVGs")
    report(entries, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
