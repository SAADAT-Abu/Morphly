# How to add an Art Pack

An **Art Pack** is an illustration library that Morphly users install from the
**Art Store**, instead of it shipping inside the installer. Bioicons and SciDraw
are Art Packs. This guide walks through turning a collection of scientific
illustrations into one.

Adding a pack takes five steps:

1. Check the licences.
2. Build a library folder with a `manifest.json`.
3. Turn the folder into a pack with `tools/make_art_pack.py`.
4. Publish the pack file, normally on Zenodo.
5. Add it to the catalogue that the Art Store reads.

If you are not a maintainer, do steps 1 to 3, then
[open an issue](https://github.com/SAADAT-Abu/Morphly/issues) proposing the
pack. Steps 4 and 5 put the pack in front of every Morphly user, so they are
done together with a maintainer.

## What a pack is

A pack is deliberately simple: the same library folder Morphly already reads
from disk, zipped, with a `pack.json` at its root. When someone installs it,
Morphly:

- downloads it over https from an allowed host (`zenodo.org`,
  `github.com` or `raw.githubusercontent.com`)
- checks its sha256 against the catalogue before unpacking anything
- refuses paths that try to escape the pack folder
- writes only `.svg`, `.json` and `.png` files, at most 60,000 of them and
  4 GB in total
- removes scripts, event handlers and external references from every SVG, and
  skips files that are empty or not valid SVG

Because a pack is just a library folder, anyone can also unzip it by hand and
add the folder with **File, Add asset library folder**.

## Step 1: check the licences

Morphly figures end up in journals, posters and grant applications, so the
licence of every illustration matters as much as the drawing itself.

- **Every illustration must allow redistribution**, because the pack is a copy
  of it. Public domain, CC0, CC BY, CC BY-SA, MIT and BSD all do.
- **Avoid NonCommercial (NC) and NoDerivatives (ND) licences.** Figures are
  recoloured and edited, and are often published commercially, so these
  licences create problems users will not notice until submission.
- **Record the licence of each illustration**, not one licence for the whole
  collection, unless every item genuinely shares it.
- **Flag share-alike items.** CC BY-SA can extend to the whole figure, and
  Morphly warns users about it, but only if the manifest says so.
- **Keep the credit and source** of each item, so Morphly can write correct
  citations into exported figures.
- **Check the source's terms** for bulk downloading. Prefer an official API or
  a published archive over scraping, and keep request rates polite.

## Step 2: build a library folder

A library folder holds the SVG files and one `manifest.json`:

```
mylibrary_library/
  manifest.json
  cells/
    12_t-cell.svg
    13_macrophage.svg
  equipment/
    40_pipette.svg
```

`manifest.json` is a list with one entry per illustration. Paths are relative
to the folder, so it stays portable:

```json
[
  {
    "id": "12",
    "title": "T cell",
    "category": "Cells",
    "keywords": ["lymphocyte", "immune", "T cell"],
    "collection": "My Library",
    "license": "CC BY 4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "requires_attribution": true,
    "share_alike": false,
    "creator": "Jane Doe",
    "credit": "Jane Doe, My Library",
    "citation": "Doe, J. (2026). T cell. My Library. https://example.org/12",
    "source_page": "https://example.org/12",
    "local_files": [
      {
        "group_id": "12",
        "caption": "T cell",
        "files": { "SVG": "cells/12_t-cell.svg" }
      }
    ]
  }
]
```

What Morphly needs from each entry:

- **Required:** `id` (unique within the library), `title`, and at least one
  item in `local_files` with a `files.SVG` path.
- **Strongly recommended:** `category`, `keywords`, `collection`, `license`,
  `requires_attribution`, `share_alike`, `creator`, `credit`, `citation` and
  `source_page`. These drive search, the collection filter, the PD, BY and SA
  badges, and the citations added on export.
- **Variants:** if the same drawing exists in several colour schemes, put each
  one in `local_files` with its own `group_id` and `caption`. The sidebar shows
  one tile with a variant picker rather than many near identical tiles.

If `requires_attribution` is missing, Morphly works it out from `license`:
anything other than public domain or CC0 is treated as needing credit.

The fetchers in `scraper/` are working examples. `scidraw_fetcher.py` is the
best one to copy for a source with an API, `phylopic_fetcher.py` for one whose
licence and metadata have to be read per item, and `bioicons_fetcher.py`,
`reactome_fetcher.py` or `healthicons_fetcher.py` for a source that publishes
its files in a repository. The newer ones share `scraper/assetlib.py`, which
holds the retrying fetch, the slug maker, the SVG sanitiser and the manifest
writer, so a new fetcher is mostly a loop and a licence table.

**Leave out what a licence would spread.** Non-commercial artwork makes a
figure unpublishable in most journals, and share-alike artwork can oblige the
whole figure to carry the same licence. Both are better dropped at fetch time
than flagged later, which is what `phylopic_fetcher.py` does by default.

**Only vectors.** Raster files (PNG, JPEG) cannot be recoloured and blur when
scaled, so leave them out of the manifest.

**Try it before packing.** Run Morphly, choose **File, Add asset library
folder**, select your folder and check that the tiles, search, badges and
credits look right. Place a few illustrations, recolour them and export an SVG
and a PDF.

## Step 3: make the pack

Install [Pillow](https://pypi.org/project/pillow/) and
[Inkscape](https://inkscape.org) first. Inkscape draws the thumbnail shown in
the Art Store and measures drawings that declare no size. Without them the pack
still builds, but with no thumbnail.

From the repository root:

```bash
python tools/make_art_pack.py \
  --library mylibrary_library \
  --id mylibrary \
  --name "My Library" \
  --version 1.0.0 \
  --homepage "https://example.org" \
  --summary "320 immune cells and lab equipment drawings, all CC BY 4.0."
```

The script works on a copy, so your folder is never changed. It:

- drops SVG files that are empty, malformed or blank, and removes them from
  the manifest
- gives drawings with no declared size a frame that fits what is drawn
- counts entries, categories, licences, attribution and share-alike items
- zips only `.svg`, `.json` and `.png` files, with `pack.json` at the root
- renders a thumbnail from illustrations spread across categories

It writes three files to `dist/art-packs/`:

- `mylibrary-1.0.0.zip`, the pack itself
- `mylibrary-thumb.png`, the thumbnail
- `mylibrary.catalogue.json`, the catalogue entry, including the file size and
  sha256

Read the list of dropped and fitted files the script prints. A long list
usually means a problem in the fetcher worth fixing at the source.

Write the summary for someone deciding whether to download: what the pack is
strong on, roughly how many illustrations it holds, and what its licences ask
of them.

## Step 4: publish the pack file

Packs are published on [Zenodo](https://zenodo.org), which keeps every version
permanently and gives each a DOI. Bioicons and SciDraw are published there.

Maintainers use `tools/zenodo_upload.py`, which uploads a pack as a **draft**,
so a person always reviews the record and presses Publish:

1. Add the pack to the `PACKS` table at the top of the script, with its Zenodo
   title, licence, source and a credit line.
2. Run `python tools/zenodo_upload.py --dry-run --packs mylibrary` to see what
   would be sent.
3. Run `python tools/zenodo_upload.py --packs mylibrary` to create the draft.
4. Review the draft on Zenodo, then publish it. Publishing cannot be undone.

The token is read from `~/.config/morphly/zenodo-token` (readable only by you)
and never from the command line or the repository.

## Step 5: add it to the catalogue

The Art Store reads `art-packs.json` from the `main` branch on GitHub, and falls
back to the copy inside the app, `app/src/main/art-packs.fallback.json`, when it
is offline.

1. Open `dist/art-packs/mylibrary.catalogue.json` and replace the two
   placeholders:
   - `url`: the direct file link, such as
     `https://zenodo.org/records/<record>/files/mylibrary-1.0.0.zip?download=1`
   - `recordUrl`: the record page, such as `https://zenodo.org/records/<record>`
2. Add the whole entry to the `packs` list in `art-packs.json`, and set
   `updated` to today's date.
3. Make the same change in `app/src/main/art-packs.fallback.json`.
4. Check the `sha256` in the entry matches the file on Zenodo. If they differ,
   installing fails, which is the point.

Once this reaches `main`, every copy of Morphly sees the new pack the next time
its Art Store opens, so check the entry carefully before merging.

## Test the finished pack

- Open the Art Store and confirm the card shows the right name, thumbnail,
  counts and licences.
- Install the pack, find a few illustrations in the sidebar, and check their
  badges and credits in the properties panel.
- Place, recolour and export them, with **Append asset citations** ticked.
- Remove the pack and confirm a figure that used it still opens, since every
  figure keeps its own copy of the artwork.

## Updating a pack

Published Zenodo records never change, so an update is a new version:

1. Rebuild the library folder and run `make_art_pack.py` again with a higher
   version number.
2. Run `python tools/zenodo_upload.py --new-version --packs mylibrary`, which
   opens a new version of the existing record and replaces its file.
3. Publish the draft, then update `version`, `file`, `bytes`, `sha256`, `url`
   and the counts in both catalogue files.

## Checklist

- [ ] Every illustration allows redistribution, with no NC or ND licences
- [ ] Each entry records its own licence, credit and source
- [ ] Share-alike items are flagged
- [ ] The folder works with File, Add asset library folder
- [ ] `make_art_pack.py` ran, and its dropped and fitted list was reviewed
- [ ] The pack is published on Zenodo
- [ ] `url`, `recordUrl` and `sha256` are correct in both catalogue files
- [ ] The pack installs, displays and exports correctly from the Art Store
