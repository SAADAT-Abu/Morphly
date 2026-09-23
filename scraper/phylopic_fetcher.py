#!/usr/bin/env python3
"""
Fetch PhyloPic (https://phylopic.org) into a Morphly asset library.

PhyloPic is ~13,000 silhouettes of organisms, from bacteria to whales, each
contributed by a named person and each carrying its own licence. It is the one
free library that covers whole organisms across the tree of life, which is what
BioArt, Bioicons and SciDraw between them still do not.

**It has a real API**, so nothing is scraped:

    GET https://api.phylopic.org/images?build=<n>&page=<n>
    GET https://api.phylopic.org/images/<uuid>?build=<n>

The listing is paged; each image's own record carries the licence, the
attribution line and a `vector.svg`. `build` is PhyloPic's cache-busting
version number and the API refuses a paged request without it, so the build is
read once from the root and then passed everywhere.

**Licensing is the reason this script filters.** PhyloPic's mix is roughly:

    53%  CC0 / Public Domain Mark      32%  CC BY 3.0 or 4.0
     9%  CC BY-SA 3.0                   7%  CC BY-NC or BY-NC-SA 3.0

Only the first two groups are taken. NC is dropped because Morphly's users
publish in journals that are commercial, and a non-commercial silhouette would
quietly make a figure unusable. SA is dropped because share-alike is contagious:
one silhouette can oblige the whole figure to carry the same licence, which is
exactly the trap that gets discovered at submission rather than at design time.
Pass --include-sa if you want them anyway; they are then flagged share_alike
and Morphly shows the SA badge.

**Categories** come from clade filters, not from the file path: the API takes a
`filter_clade=<node uuid>` and each clade below is listed once, so a silhouette
lands under Mammals or Insects rather than under nothing. Anything outside all
of them becomes "Other life".

To run:
    python scraper/phylopic_fetcher.py --out ./phylopic_library
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from assetlib import (  # noqa: E402
    fetch_bytes, fetch_json, looks_like_svg, report, sanitise_svg, slugify, write_manifest,
)

API = "https://api.phylopic.org"
ACCEPT = "application/vnd.phylopic.v2+json"

# label -> the clade's name in PhyloPic's node index. Order matters: an image is
# filed under the first clade that claims it, so the narrow groups come before
# the broad ones (a beetle should be an insect, not just an animal).
#
# The names are PhyloPic's, not the ones a biologist would reach for first, and
# the node search is fuzzy enough to answer with a neighbour: "Archaea" comes
# back as Neomura, which is Archaea plus all eukaryotes, and would have swept
# twelve thousand silhouettes into the wrong drawer. So each name here is one
# that was checked to resolve to itself, and clade_members refuses anything
# that does not come back under the name it asked for.
CLADES = [
    ("Mammals", "Mammalia"),
    ("Birds", "Aves"),
    ("Reptiles", "Reptilia"),
    ("Amphibians", "pan-Lissamphibia"),
    ("Fish", "Actinopterygii"),
    ("Sharks and rays", "Chondrichthyes"),
    ("Insects", "Insecta"),
    ("Arachnids", "Arachnida"),
    ("Crustaceans", "Crustacea"),
    ("Molluscs", "Mollusca"),
    ("Worms", "Annelida"),
    ("Nematodes", "Nematoda"),
    ("Cnidarians", "Cnidaria"),
    ("Echinoderms", "Echinodermata"),
    ("Other animals", "Metazoa"),
    ("Plants", "Embryophyta"),
    ("Fungi", "Fungi"),
    ("Bacteria", "Eubacteria"),
    ("Algae and protists", "Eukarya"),
]

# licence url -> (label, requires attribution, share-alike, wanted by default)
LICENCES = {
    "https://creativecommons.org/publicdomain/zero/1.0/": ("CC0 1.0", False, False, True),
    "https://creativecommons.org/publicdomain/mark/1.0/": ("Public Domain", False, False, True),
    "https://creativecommons.org/licenses/by/3.0/": ("CC BY 3.0", True, False, True),
    "https://creativecommons.org/licenses/by/4.0/": ("CC BY 4.0", True, False, True),
    "https://creativecommons.org/licenses/by-sa/3.0/": ("CC BY-SA 3.0", True, True, False),
    "https://creativecommons.org/licenses/by-sa/4.0/": ("CC BY-SA 4.0", True, True, False),
    "https://creativecommons.org/licenses/by-nc/3.0/": ("CC BY-NC 3.0", True, False, False),
    "https://creativecommons.org/licenses/by-nc-sa/3.0/": ("CC BY-NC-SA 3.0", True, True, False),
}


def current_build() -> int:
    """
    The root hands back the build number.

    A paged request without one is rejected, and the rejection helpfully names
    the current build, so that error is a valid way to read it.
    """
    root = fetch_json(f"{API}/", ACCEPT)
    if "build" in root:
        return int(root["build"])
    probe = fetch_json(f"{API}/images?page=0", ACCEPT)
    return int(probe["build"])


def page_items(path: str, build: int, delay: float) -> list:
    """Walk every page of a listing, returning the item links."""
    items, page = [], 0
    joiner = "&" if "?" in path else "?"
    while True:
        url = f"{API}{path}{joiner}build={build}&page={page}"
        payload = fetch_json(url, ACCEPT, missing_is_none=True)
        # A page past the end answers 404 rather than an empty list.
        batch = (payload or {}).get("_links", {}).get("items") or []
        if not batch:
            return items
        items.extend(batch)
        page += 1
        time.sleep(delay)


def clade_members(label: str, name: str, build: int, delay: float) -> tuple:
    """Every silhouette uuid inside one clade."""
    nodes = fetch_json(f"{API}/nodes?build={build}&filter_name={slugify(name)}&page=0", ACCEPT)
    found = nodes.get("_links", {}).get("items") or []
    if not found:
        print(f"  ! no node called {name}, skipping that category", file=sys.stderr)
        return label, []
    if (found[0].get("title") or "").strip().lower() != name.strip().lower():
        print(f"  ! {name} resolved to {found[0].get('title')!r}, which is a different clade; "
              f"skipping {label}", file=sys.stderr)
        return label, []
    uuid = found[0]["href"].split("/nodes/")[1].split("?")[0]
    images = page_items(f"/images?filter_clade={uuid}", build, delay)
    keys = [i["href"].split("/images/")[1].split("?")[0] for i in images]
    print(f"  {label:<18} {len(keys):5d} silhouettes")
    return label, keys


def clade_index(build: int, delay: float, workers: int) -> dict:
    """
    uuid -> category label.

    Twenty clade listings instead of thirteen thousand lookups. The listings run
    in parallel because the broad ones (Eukaryota, Metazoa) walk nearly the whole
    catalogue a page at a time, and serially they take longer than the download
    itself. Merging afterwards in CLADES order keeps the rule that the narrowest
    clade wins: a beetle is filed under Insects, not under Other animals.
    """
    with ThreadPoolExecutor(workers) as pool:
        found = dict(pool.map(lambda c: clade_members(c[0], c[1], build, delay), CLADES))

    index = {}
    for label, _ in CLADES:
        for key in found.get(label, []):
            index.setdefault(key, label)
    return index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("./phylopic_library"))
    parser.add_argument("--delay", type=float, default=0.1,
                        help="seconds between listing requests; be a good citizen")
    parser.add_argument("--workers", type=int, default=6,
                        help="parallel metadata and file fetches")
    parser.add_argument("--include-sa", action="store_true",
                        help="also take CC BY-SA silhouettes, which oblige the whole figure")
    parser.add_argument("--include-nc", action="store_true",
                        help="also take non-commercial silhouettes; see the module docstring")
    parser.add_argument("--limit", type=int, default=0, help="stop after N silhouettes (testing)")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    build = current_build()
    print(f"PhyloPic build {build}")

    print("indexing clades")
    categories = clade_index(build, args.delay, args.workers)

    print("listing every silhouette")
    everything = page_items("/images", build, args.delay)
    uuids = [i["href"].split("/images/")[1].split("?")[0] for i in everything]
    titles = {i["href"].split("/images/")[1].split("?")[0]: i.get("title") or "" for i in everything}
    if args.limit:
        uuids = uuids[: args.limit]
    print(f"{len(uuids)} silhouettes, {len(categories)} already placed in a clade")

    wanted_extra = set()
    if args.include_sa:
        wanted_extra |= {"CC BY-SA 3.0", "CC BY-SA 4.0"}
    if args.include_nc:
        wanted_extra |= {"CC BY-NC 3.0", "CC BY-NC-SA 3.0"}

    def describe(uuid: str):
        record = fetch_json(f"{API}/images/{uuid}?build={build}", ACCEPT)
        licence_url = (record.get("_links", {}).get("license") or {}).get("href", "")
        known = LICENCES.get(licence_url)
        if not known:
            return None
        label, needs_credit, share_alike, default_ok = known
        if not (default_ok or label in wanted_extra):
            return None
        vector = (record.get("_links", {}).get("vectorFile") or {}).get("href")
        if not vector:
            return None
        return {
            "uuid": uuid,
            "title": titles.get(uuid) or "Silhouette",
            "attribution": record.get("attribution") or "",
            "licence": label,
            "licence_url": licence_url,
            "requires_attribution": needs_credit,
            "share_alike": share_alike,
            "vector": vector,
            "created": (record.get("created") or "")[:10],
        }

    print(f"reading licences with {args.workers} workers")
    with ThreadPoolExecutor(args.workers) as pool:
        described = list(pool.map(describe, uuids))

    keep = [d for d in described if d]
    print(f"{len(keep)} usable, {len(described) - len(keep)} dropped "
          f"(non-commercial, share-alike or no vector)")

    entries, failures = [], 0

    def download(meta):
        category = categories.get(meta["uuid"], "Other life")
        rel = Path(slugify(category)) / f"{slugify(meta['title'])}-{meta['uuid'][:8]}.svg"
        target = args.out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        text = fetch_bytes(meta["vector"]).decode("utf-8", "replace")
        if not looks_like_svg(text):
            raise ValueError("not an SVG")
        target.write_text(sanitise_svg(text), encoding="utf-8")
        return category, rel, meta

    with ThreadPoolExecutor(args.workers) as pool:
        for index, result in enumerate(pool.map(lambda m: _safe(download, m), keep), 1):
            if result is None:
                failures += 1
                continue
            category, rel, meta = result
            who = meta["attribution"] or "PhyloPic contributor"
            entries.append({
                "id": f"phylopic:{meta['uuid']}",
                "title": meta["title"],
                "category": category,
                "keywords": sorted(set(slugify(meta["title"]).split("-")) | {slugify(category)}
                                   - {""}),
                "license": meta["licence"],
                "license_url": meta["licence_url"],
                "requires_attribution": meta["requires_attribution"],
                "share_alike": meta["share_alike"],
                "collection": "PhyloPic",
                "creator": who,
                "credit": "PhyloPic",
                "citation": f"{who}. {meta['title']}. PhyloPic. "
                            f"https://www.phylopic.org/images/{meta['uuid']}",
                "source": "phylopic",
                "source_page": f"https://www.phylopic.org/images/{meta['uuid']}",
                "local_files": [{
                    "group_id": meta["uuid"],
                    "caption": meta["title"],
                    "files": {"SVG": rel.as_posix()},
                }],
            })
            if index % 500 == 0:
                write_manifest(args.out, entries)
                print(f"  {index}/{len(keep)} downloaded")

    write_manifest(args.out, entries)
    if failures:
        print(f"  {failures} silhouettes could not be downloaded")
    report(entries, args.out)
    return 0


def _safe(fn, arg):
    try:
        return fn(arg)
    except Exception as err:  # one bad silhouette should not end a 13,000 item run
        print(f"  ! {arg.get('uuid')}: {err}", file=sys.stderr)
        return None


if __name__ == "__main__":
    sys.exit(main())
