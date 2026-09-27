#!/usr/bin/env python3
"""
Count how many people reached Morphly and how many downloaded it.

Everything here comes from public APIs, so no token is needed:

  * GitHub releases: per asset download counts, plus stars and forks.
  * Zenodo: views and downloads per version, for the app and for every
    Art Pack, using the concept record so all versions are covered.

What cannot be counted from here, and where to look instead:

  * Repository page views and clones. GitHub's traffic API needs a token with
    push access to the repo, and it only keeps a 14 day window, so read it in
    the browser at github.com/SAADAT-Abu/Morphly/graphs/traffic and note the
    numbers down if you want a longer series.
  * Art Store installs from inside Morphly. Those are Zenodo file downloads,
    which the Zenodo numbers below already include, and Morphly itself sends
    no telemetry, by design.
  * LinkedIn reach. Only LinkedIn's own post analytics has that.

Zenodo aggregates its counters on a delay of roughly a day, so a download made
in the last few hours will not appear yet.

    python tools/usage_stats.py
    python tools/usage_stats.py --json      # for keeping a series over time
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

REPO = "SAADAT-Abu/Morphly"
APP_CONCEPT = 22238248          # Morphly itself, all versions
PACK_RECORDS = {                # one published record per Art Pack
    "bioicons": 22735880,
    "scidraw": 22736296,
    "reactome": 22905668,
    "healthicons": 22905670,
    "phylopic": 22916817,
}
USER_AGENT = "Morphly-usage-stats/1.0 (+https://github.com/SAADAT-Abu/Morphly)"


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


def github() -> dict:
    repo = get(f"https://api.github.com/repos/{REPO}")
    releases = get(f"https://api.github.com/repos/{REPO}/releases?per_page=100")
    out = {
        "stars": repo["stargazers_count"],
        "forks": repo["forks_count"],
        "watchers": repo["subscribers_count"],
        "open_issues": repo["open_issues_count"],
        "releases": [],
    }
    for release in releases:
        out["releases"].append({
            "tag": release["tag_name"],
            "published": (release["published_at"] or "")[:10],
            "assets": {a["name"]: a["download_count"] for a in release["assets"]},
            "downloads": sum(a["download_count"] for a in release["assets"]),
        })
    out["downloads"] = sum(r["downloads"] for r in out["releases"])
    return out


def zenodo_record(record_id: int) -> dict:
    """
    One record's counters.

    Zenodo's top level `downloads` and `views` are totals across every version
    of the record; the `version_*` keys are this version alone. Reporting only
    the top level ones for a five version series would repeat the same number
    five times, which reads like a bug.
    """
    record = get(f"https://zenodo.org/api/records/{record_id}")
    stats = record.get("stats", {})
    return {
        "id": record["id"],
        "version": record["metadata"].get("version") or "",
        "created": record["created"][:10],
        "doi": record.get("doi"),
        "views": stats.get("version_unique_views", 0),
        "downloads": stats.get("version_unique_downloads", 0),
        "all_version_views": stats.get("unique_views", 0),
        "all_version_downloads": stats.get("unique_downloads", 0),
    }


def zenodo_series(concept_id: int) -> list:
    """Every published version of a concept record, newest first."""
    latest = get(f"https://zenodo.org/api/records/{concept_id}")
    versions = get(f"https://zenodo.org/api/records/{latest['id']}/versions?size=25")
    hits = versions.get("hits", {}).get("hits", [])
    return [zenodo_record(hit["id"]) for hit in hits]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="machine readable output")
    args = parser.parse_args()

    try:
        report = {
            "github": github(),
            "app": zenodo_series(APP_CONCEPT),
            "packs": {name: zenodo_record(rid) for name, rid in PACK_RECORDS.items()},
        }
    except urllib.error.HTTPError as err:
        sys.exit(f"{err.url} failed: HTTP {err.code}")

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    gh = report["github"]
    print(f"GitHub  {REPO}")
    print(f"  {gh['stars']} stars, {gh['forks']} forks, {gh['watchers']} watching, "
          f"{gh['open_issues']} open issues")
    print(f"  {gh['downloads']} installer downloads from Releases")
    for release in gh["releases"]:
        print(f"    {release['tag']:8s} {release['published']}  {release['downloads']:5d}")
        for name, count in sorted(release["assets"].items()):
            print(f"      {count:5d}  {name}")
    print("  page views and clones: github.com/SAADAT-Abu/Morphly/graphs/traffic")

    print("\nZenodo  Morphly installers (unique visitors and downloads)")
    for version in report["app"]:
        label = f"v{version['version']}" if version["version"] else "(no version)"
        print(f"  {label:12s} {version['created']}  {version['views']:5d} views  "
              f"{version['downloads']:5d} downloads")
    total = report["app"][0] if report["app"] else {}
    print(f"  all versions together: {total.get('all_version_views', 0)} views, "
          f"{total.get('all_version_downloads', 0)} downloads")

    print("\nZenodo  Art Packs")
    for name, pack in report["packs"].items():
        print(f"  {name:12s} v{pack['version']:8s} {pack['views']:5d} views  "
              f"{pack['downloads']:5d} downloads")
    print("\nZenodo counters lag by about a day. Morphly sends no telemetry, so an")
    print("install is only visible as the download that preceded it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
