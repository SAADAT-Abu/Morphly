#!/usr/bin/env python3
"""
Upload Art Packs to Zenodo as DRAFTS, one record per pack.

Publishing on Zenodo cannot be undone: a published record can get new
versions, but it never goes away. So this script stops at a draft by default,
and you review and press Publish in the web UI. `--publish` exists for when
the drafts have been checked once and the flow is trusted.

The token is read from a file, never from the command line (which lands in
shell history) and never from the repository:

    ~/.config/morphly/zenodo-token      (chmod 600)

It needs the scopes deposit:write and deposit:actions.

    python tools/zenodo_upload.py --dry-run            # show what would be sent
    python tools/zenodo_upload.py --sandbox            # test on sandbox.zenodo.org
    python tools/zenodo_upload.py                      # real drafts on zenodo.org
"""

import argparse
import datetime
import json
import os
import stat
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PACKS_DIR = REPO / "dist" / "art-packs"
TOKEN_FILE = Path.home() / ".config" / "morphly" / "zenodo-token"

AUTHOR = {"name": "Saadat, Abu", "affiliation": "Josep Carreras Leukaemia Research Institute (IJC)"}

# Zenodo takes one licence per record. SciDraw is CC BY 4.0 plus CC0, so
# CC BY is an honest umbrella. Bioicons mixes CC BY, CC BY-SA, CC0, MIT and
# BSD, and no single licence describes it without misrepresenting part of it.
PACKS = {
    "bioicons": {
        "title": "Morphly Art Pack: Bioicons",
        "license": "other-open",
        "source": "https://bioicons.com",
        "credit": "Icons from Bioicons (bioicons.com) by their individual authors. "
                  "Licences vary per icon (CC BY 3.0 and 4.0, CC BY-SA 3.0 and 4.0, CC0, "
                  "MIT, BSD-3-Clause) and are recorded per icon in manifest.json.",
    },
    "scidraw": {
        "title": "Morphly Art Pack: SciDraw",
        "license": "cc-by-4.0",
        "source": "https://scidraw.io",
        "credit": "Drawings from SciDraw (scidraw.io) by their individual contributors, "
                  "each under CC BY 4.0 or CC0 with its own DOI, recorded per drawing in "
                  "manifest.json.",
    },
}


def read_token() -> str:
    if not TOKEN_FILE.exists():
        sys.exit(f"No token at {TOKEN_FILE}. Create one with scopes deposit:write and deposit:actions.")
    if TOKEN_FILE.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        sys.exit(f"{TOKEN_FILE} is readable by other users. Run: chmod 600 {TOKEN_FILE}")
    return TOKEN_FILE.read_text().strip()


def api(method, url, token, body=None, data=None, content_type="application/json"):
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        data = json.dumps(body).encode()
    if data is not None:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=3600) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        sys.exit(f"{method} {url} failed: HTTP {err.code}\n{err.read().decode(errors='replace')[:800]}")


class ProgressFile:
    """File wrapper so a 180 MB upload shows progress instead of looking hung."""

    def __init__(self, path: Path):
        self.handle = path.open("rb")
        self.total = path.stat().st_size
        self.sent = 0
        self.last = -1

    def __len__(self):
        return self.total

    def read(self, size=-1):
        chunk = self.handle.read(1 << 20 if size < 0 else size)
        self.sent += len(chunk)
        pct = int(self.sent * 100 / self.total)
        if pct != self.last and pct % 5 == 0:
            print(f"    {pct}%", flush=True)
            self.last = pct
        return chunk


def metadata_for(pack_id: str, catalogue: dict) -> dict:
    config = PACKS[pack_id]
    description = (
        f"<p>{catalogue['summary']}</p>"
        f"<p>An Art Pack for <a href=\"https://github.com/SAADAT-Abu/Morphly\">Morphly</a>, "
        f"a free desktop editor for scientific figures. Install it from the Art Store inside "
        f"Morphly, or unzip it and add the folder as an asset library.</p>"
        f"<p>{config['credit']}</p>"
        f"<p>{catalogue['entries']} illustrations: {catalogue['requiresAttribution']} require "
        f"attribution, {catalogue['shareAlike']} are share-alike.</p>"
    )
    return {
        "metadata": {
            "upload_type": "image",
            "image_type": "drawing",
            "title": config["title"],
            "creators": [AUTHOR],
            "description": description,
            "access_right": "open",
            "license": config["license"],
            "version": catalogue["version"],
            "publication_date": datetime.date.today().isoformat(),
            "keywords": ["scientific illustration", "figure", "Morphly", "art pack", pack_id],
            "related_identifiers": [
                {"identifier": config["source"], "relation": "isDerivedFrom", "resource_type": "image"},
                {"identifier": "https://github.com/SAADAT-Abu/Morphly", "relation": "isSupplementTo",
                 "resource_type": "software"},
            ],
        }
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packs", nargs="+", default=list(PACKS))
    parser.add_argument("--sandbox", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()

    base = "https://sandbox.zenodo.org" if args.sandbox else "https://zenodo.org"
    token = None if args.dry_run else read_token()
    results = {}

    for pack_id in args.packs:
        catalogue = json.loads((PACKS_DIR / f"{pack_id}.catalogue.json").read_text())
        archive = PACKS_DIR / catalogue["file"]
        meta = metadata_for(pack_id, catalogue)
        print(f"\n{pack_id}: {archive.name}, {archive.stat().st_size / 1e6:.0f} MB")

        if args.dry_run:
            print(json.dumps(meta, indent=2))
            continue

        draft = api("POST", f"{base}/api/deposit/depositions", token, body={})
        print(f"  draft {draft['id']} created")

        print("  uploading")
        api("PUT", f"{draft['links']['bucket']}/{archive.name}", token,
            data=ProgressFile(archive), content_type="application/octet-stream")

        api("PUT", f"{base}/api/deposit/depositions/{draft['id']}", token, body=meta)
        print("  metadata set")

        record = draft
        if args.publish:
            record = api("POST", f"{base}/api/deposit/depositions/{draft['id']}/actions/publish", token)
            print(f"  published, DOI {record.get('doi')}")

        results[pack_id] = {
            "id": record["id"],
            "review": f"{base}/uploads/{record['id']}",
            "file_url": f"{base}/records/{record['id']}/files/{archive.name}?download=1",
            "published": args.publish,
        }

    if results:
        out = PACKS_DIR / ("zenodo-sandbox.json" if args.sandbox else "zenodo.json")
        out.write_text(json.dumps(results, indent=2))
        print(f"\nwrote {out}")
        for pack_id, r in results.items():
            print(f"  {pack_id}: review at {r['review']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
