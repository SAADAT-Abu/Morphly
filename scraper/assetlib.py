#!/usr/bin/env python3
"""
The pieces every Morphly asset fetcher needs.

The first two fetchers (BioArt, Bioicons) each carried their own copy of these
helpers, which was fine for two and would be silly for five. New fetchers
import them from here; the old two are left alone rather than churned.

Nothing here is clever: retries with a pause, a slug maker, an SVG sanitiser,
and the manifest writer that produces the shape `app/src/main/library.js`
already reads.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "Morphly-asset-fetcher/1.0 (+https://github.com/SAADAT-Abu/Morphly)"

SLUG_SAFE = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    return SLUG_SAFE.sub("-", (text or "").lower()).strip("-") or "untitled"


def prettify(name: str) -> str:
    """`t-cell_activated` -> `T cell activated`, for libraries that name by file."""
    words = re.split(r"[-_\s]+", (name or "").strip())
    words = [w for w in words if w]
    if not words:
        return "Untitled"
    first = words[0]
    head = first if first.isupper() or len(first) <= 3 else first.capitalize()
    return " ".join([head, *words[1:]])


def sanitise_svg(text: str) -> str:
    """
    Strip anything executable before it is ever written to disk.

    Morphly sanitises art packs on install too, but a library built here can be
    mounted straight from the folder, which skips that step.
    """
    text = re.sub(r"<\s*script[\s\S]*?<\s*/\s*script\s*>", "", text, flags=re.I)
    text = re.sub(r"<\s*script[^>]*/>", "", text, flags=re.I)
    text = re.sub(r"<\s*foreignObject[\s\S]*?<\s*/\s*foreignObject\s*>", "", text, flags=re.I)
    text = re.sub(r"\son[a-z]+\s*=\s*\"[^\"]*\"", "", text, flags=re.I)
    text = re.sub(r"\son[a-z]+\s*=\s*'[^']*'", "", text, flags=re.I)
    return text


def looks_like_svg(text: str) -> bool:
    return "<svg" in text[:4000].lower()


def request(url: str, accept: str | None = None) -> urllib.request.Request:
    headers = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    return urllib.request.Request(url, headers=headers)


def fetch_json(url: str, accept: str | None = None, retries: int = 4,
               missing_is_none: bool = False) -> dict:
    """
    `missing_is_none` is for APIs that answer a page past the end with a 404
    rather than an empty list, which is how PhyloPic marks the end of a listing.
    """
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request(url, accept), timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as err:
            if err.code == 404 and missing_is_none:
                return None
            if attempt == retries - 1 or err.code < 500:
                raise
            print(f"    retrying {url}: {err}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            if attempt == retries - 1:
                raise
            print(f"    retrying {url}: {err}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return {}


def fetch_bytes(url: str, retries: int = 4) -> bytes:
    url = url.replace("http://", "https://", 1)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request(url), timeout=120) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt == retries - 1:
                raise
            print(f"    retrying {url}: {err}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return b""


def write_manifest(out: Path, entries: list) -> None:
    (out / "manifest.json").write_text(json.dumps(entries, indent=1))


def report(entries: list, out: Path) -> None:
    """The three numbers that decide whether a pack is usable: size, credit, share-alike."""
    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    credit = sum(1 for e in entries if e.get("requires_attribution"))
    viral = sum(1 for e in entries if e.get("share_alike"))
    print(f"\ndone: {len(entries)} assets, {total / 1e6:.0f} MB in {out}")
    print(f"  {credit} need crediting, {len(entries) - credit} do not, {viral} are share-alike")
