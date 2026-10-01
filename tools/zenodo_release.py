#!/usr/bin/env python3
"""
Archive a Morphly release on Zenodo as a new version of the software record.

Every release is a version of one concept record (10.5281/zenodo.22238248), so
the DOI in the README always resolves to the newest and old citations keep
working. This opens that new version, uploads the installers and stops at a
DRAFT: publishing on Zenodo cannot be undone, so the last look is a person's.

The installers come from the published GitHub release rather than from a local
build, so what is archived is exactly what people downloaded. Fetch them first:

    gh_release=https://github.com/SAADAT-Abu/Morphly/releases/download/v0.5.2
    mkdir -p app/release/0.5.2-ci && cd app/release/0.5.2-ci
    for f in Morphly-0.5.2.AppImage "Morphly.Setup.0.5.2.exe" \
             Morphly-0.5.2.dmg Morphly-0.5.2-arm64.dmg; do
      curl -sSL -O "$gh_release/$f"
    done

The token is read from ~/.config/morphly/zenodo-token (chmod 600), never from
the command line. Description text is read from a file so it can be written and
reviewed like prose rather than wrestled into a shell argument.

    python tools/zenodo_release.py --version 0.5.2 --notes notes.html --dry-run
    python tools/zenodo_release.py --version 0.5.2 --notes notes.html
"""

import argparse
import json
import sys
import urllib.parse
from pathlib import Path

# The Art Pack uploader already knows how to talk to Zenodo; reuse it rather
# than keeping a second copy of the same four functions.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from zenodo_upload import AUTHOR, ProgressFile, api, read_token, start_new_version  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
CONCEPT = 22238248
# The record each release was published as, so --new-version has somewhere to
# start. Zenodo resolves the concept to its latest version for us.
TITLE = "Morphly: a free desktop editor for scientific figures"
INSTALLERS = [
    "Morphly-{v}.AppImage",
    "Morphly Setup {v}.exe",
    "Morphly-{v}.dmg",
    "Morphly-{v}-arm64.dmg",
]


def latest_record(base: str) -> int:
    """The newest published version of the concept record."""
    record = api("GET", f"{base}/api/records/{CONCEPT}", None)
    return int(record["id"])


def metadata_for(version: str, notes_html: str) -> dict:
    return {
        "metadata": {
            "upload_type": "software",
            "title": TITLE,
            "creators": [{**AUTHOR, "orcid": "0000-0001-9636-2513"}],
            "description": notes_html,
            "access_right": "open",
            "license": "cc-by-4.0",
            "version": version,
            "keywords": [
                "scientific figures", "figure editor", "scientific illustration",
                "NIH BioArt", "vector graphics", "SVG", "publication figures",
                "graphical abstract", "open source", "offline", "Electron",
                "BioRender alternative",
            ],
            "related_identifiers": [
                {"identifier": "https://morphly.pages.dev/", "relation": "isDocumentedBy",
                 "resource_type": "software", "scheme": "url"},
                {"identifier": "https://github.com/SAADAT-Abu/Morphly", "relation": "isSupplementTo",
                 "resource_type": "software", "scheme": "url"},
            ],
        }
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="e.g. 0.5.2")
    parser.add_argument("--notes", type=Path, required=True,
                        help="file of HTML for the record description")
    parser.add_argument("--from-dir", type=Path, default=None,
                        help="where the installers are (default app/release/<version>-ci)")
    parser.add_argument("--draft", type=int, default=None,
                        help="carry on filling an existing draft instead of opening a new "
                             "version; files already uploaded are skipped")
    parser.add_argument("--sandbox", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    base = "https://sandbox.zenodo.org" if args.sandbox else "https://zenodo.org"
    source = args.from_dir or REPO / "app" / "release" / f"{args.version}-ci"
    files = [source / name.format(v=args.version) for name in INSTALLERS]

    missing = [f.name for f in files if not f.exists()]
    if missing:
        sys.exit(f"Not in {source}: {', '.join(missing)}. Fetch them from the GitHub release first.")

    meta = metadata_for(args.version, args.notes.read_text().strip())
    total = sum(f.stat().st_size for f in files)
    print(f"Morphly {args.version}: {len(files)} installers, {total / 1e9:.2f} GB")
    for f in files:
        print(f"  {f.stat().st_size / 1e6:6.0f} MB  {f.name}")

    if args.dry_run:
        print(json.dumps(meta, indent=2)[:1200])
        return 0

    token = read_token()
    if args.draft:
        draft = api("GET", f"{base}/api/deposit/depositions/{args.draft}", token)
        print(f"carrying on with draft {draft['id']}")
    else:
        previous = latest_record(base)
        print(f"opening a new version of record {previous}")
        draft = start_new_version(base, token, previous)
        print(f"  draft {draft['id']}")

    # A 1 GB upload is worth resuming rather than repeating, so anything the
    # draft already holds at the right size is left alone.
    already = {f["filename"]: f.get("filesize") for f in draft.get("files", [])}

    for f in files:
        if already.get(f.name) == f.stat().st_size:
            print(f"  already there, skipping {f.name}")
            continue
        print(f"  uploading {f.name}")
        # The installer names carry spaces, and a raw space in a URL is rejected
        # before the request is even sent. Only the file name is quoted: the
        # bucket URL is Zenodo's own and already safe.
        api("PUT", f"{draft['links']['bucket']}/{urllib.parse.quote(f.name)}", token,
            data=ProgressFile(f), content_type="application/octet-stream")

    api("PUT", f"{base}/api/deposit/depositions/{draft['id']}", token, body=meta)
    print("  metadata set")
    print(f"\nreview and publish: {base}/uploads/{draft['id']}")
    print("Nothing is public until you press Publish.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
