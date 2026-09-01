# Morphly: A BioArt Figure Editor - Project Brief

Morphly is a BioRender-style desktop app for building scientific figures using NIH
BioArt Source's free, curated illustration library. Drag-and-drop icons
onto a canvas, add shapes/text, recolor assets, export to PNG/SVG/PDF.

Built by: Abu Saadat (Bioinformatics postdoc, IJC Barcelona.
This is a side project; JS/React/Electron is new territory, so favor explicit, well
commented scaffolding over clever abstraction.

## Why this exists

BioRender is proprietary/paid. NIH BioArt Source (bioart.niaid.nih.gov) is
a free, public-domain-or-CC-BY library of ~2,000+ vetted scientific/medical
vector illustrations, already organized into categories (Viruses, Anatomy,
Cells and Organelles, Equipment, Proteins, Animals, People, Arthropods,
Bacteria, Cellular Processes, Molecules, Plants, Shapes, plus Brushes/
Swatches/Templates). Instead of building a canvas editor from scratch, fork
an existing open-source design-editor engine and wire the BioArt library in
as the asset panel.

## Architecture (3 phases)

1. **Asset pipeline (Python)** — scrape BioArt into a local, categorized
   library + JSON manifest. DONE (v1) — see `bioart_scraper.py`.
2. **Editor shell (Electron + React + Polotno)** — canvas editor with the
   BioArt manifest as a searchable/browsable sidebar, drag-drop onto
   canvas, shape/text tools, SVG recolor, export. NOT STARTED.
3. **Packaging (electron-builder)** — produce a real installable desktop
   app (.dmg / .exe / .AppImage). NOT STARTED.

## Phase 1 — Asset pipeline (done, v1)

Script: `bioart_scraper.py` (Python, `requests` + `beautifulsoup4`).

**Confirmed API structure** (reverse-engineered via page source, not an
official/documented API — be a good citizen: keep request delay, don't
hammer it):

- Entry metadata page (server-rendered, scrapeable with plain HTTP + HTML
  parsing, no browser automation needed):
  `https://bioart.niaid.nih.gov/bioart/{id}`
  Contains: title, category + sub-tags, keywords, license, creator,
  collection, credit, image type, illustration software, description, and
  `<img>` tags pointing at file endpoints.

- File download endpoint (confirmed working, returns binary image data):
  `https://bioart.niaid.nih.gov/api/bioarts/{id}/files/{file_id}`

- IDs are sequential integers; missing/invalid ones 404. Script iterates a
  range and skips 404s. Site has ~2,000+ entries total (exact max ID
  unconfirmed — start with a generous range like 1–5000 and let it skip
  gaps).

**RESOLVED (2026-09-01) — the full-vector download endpoint**: the entry
page's React Server Component payload contains a `filemapping` object that
the site's "pick representation + file type -> Download" UI drives off:

```
"filemapping": {"<groupId>": {"AI": 626569, "EPS": 626570,
                              "PNG": 626572, "SVG": 626573}}
```

All formats resolve through the *same* `/api/bioarts/{id}/files/{file_id}`
endpoint — there is no separate download URL. v1 of the scraper only saw
the file ids appearing in `<img src>` attributes, which are the PNG
previews, so it downloaded rasters only. v2 parses `filemapping` and pulls
genuine SVGs (verified: real `<svg>` documents carrying their own
`<metadata>` block with title/license/creator/credit). No DevTools check
needed.

Two other things learned in the process:

- The file endpoint sends **no Content-Type header**, so the extension must
  be sniffed from magic bytes. ("AI" downloads are PDF-compatible files.)
- An entry can have **multiple file groups** — color/style variants of the
  same illustration (e.g. entry 8 "Actin Filament" has 11). The scraper
  saves each as a separate variant; the sidebar should group them under one
  asset with a variant picker rather than showing 11 near-identical tiles.
- Some entries (image_type `Brush`) ship **AI only**, no SVG/PNG. They are
  skipped under the default `--formats SVG,PNG` and land in the manifest
  with an empty `local_files`.

**Output structure**:
```
bioart_library/
  manifest.json              <- array of entries: id, title, category,
                                 keywords[], license, collection, creator,
                                 credit, image_type, software,
                                 submission_date, description, variants[],
                                 citation, source_page, local_files[]
  <category-slug>/
    {id}_{title-slug}_g{group-id}.svg     <- .png/.pdf/.eps only if
                                             --formats asks for them
```

`manifest.json` entries carry `variants[]` (remote URLs per format, per
file group) and `local_files[]` (`{group_id, caption, files: {FMT: path}}`
with paths **relative to the library root**, so the folder stays portable).

**Licensing / attribution** (important, don't skip): BioArt entries are
free for any use. Public Domain entries don't require citation but it's
appreciated; CC-BY entries should be cited. Citation format (from BioArt
FAQ):
```
<Collection Name>. (<date>). <Entry Title>. NIAID NIH BioArt Source.
bioart.niaid.nih.gov/bioart/<id>
```
The manifest already generates a citation string per entry — Phase 2's
export step should offer to auto-insert this as a text layer or footer.

**To run**:
```bash
pip install -r scraper/requirements.txt --break-system-packages
python scraper/bioart_scraper.py --start 1 --end 5000 --out ./bioart_library
```
`manifest.json` is written incrementally, so an interrupted run loses at
most one entry. Pass `--resume` to skip ids already in the manifest.

**SVG-only by default.** Vectors scale losslessly and are what the recolor
panel operates on, so PNG previews are no longer fetched — they were ~55%
of the library's bytes (11.7 MB of the first 21 MB) for no capability the
SVGs don't already provide. The sidebar renders the SVGs directly. Use
`--formats SVG,PNG,AI` if raster previews or Illustrator sources are ever
needed.

## Phase 2 — Editor shell (to build)

**Stack decision**: Electron (desktop, per user preference) + React +
[Polotno](https://polotno.com) as the canvas engine, rather than building
a canvas editor from scratch or forking Excalidraw/tldraw (those are
diagram/whiteboard-first; Polotno is a Canva-style design editor and is
the closer match to BioRender's actual feature set — layers, shapes, text,
image placement, export).

**Core features to implement**:
- Electron shell wrapping a React renderer running Polotno's `<Workspace>`
  canvas.
- Left sidebar: reads `manifest.json` from Phase 1, groups assets by
  `category`, with a search box filtering on `title` + `keywords`.
- Drag-from-sidebar → `store.activePage.addElement()` (Polotno API) to
  place an asset on canvas.
- Shape tools (rect, circle, line, arrow) and text boxes — Polotno ships
  these natively, just needs toolbar wiring.
- SVG recolor panel: **measured on a 26-file sample — BioArt SVGs are
  overwhelmingly multi-color** (1/2/3/5/6/13/14/15/21 distinct hex colors;
  median ~5, and 25–500 shape elements each). A single fill swap is not
  enough. Build a **palette-swap panel**: parse the SVG, collect its
  distinct `fill`/`stroke` values into a swatch list, and let the user remap
  each one — that keeps shading and outlines intact, which per-path controls
  at 500 shapes would not.
- Export: PNG/SVG/PDF via Polotno's built-in export, with an option to
  auto-append the citation string(s) for any BioArt assets used in the
  figure.
- Layer panel, undo/redo, alignment guides — check what Polotno provides
  out of the box before building custom.

**Not yet decided / to figure out during build**:
- Whether to bundle the BioArt library inside the app or point at a local
  folder path the user configures (bundling ~2,000 SVGs could bloat the
  installer; a "point at your scraped folder" setting may be simpler for
  v1).
- Whether Polotno's free tier covers everything needed or if any features
  require their paid SDK key — check before committing to it as the base.
- How to present multi-variant entries in the sidebar (see file-group note
  in Phase 1).

## Phase 3 — Packaging (to build)

`electron-builder` config to produce `.dmg` (mac) / `.exe` (Windows) /
`.AppImage` (Linux) installers.

## Repo layout (current)

```
Morphly/
  scraper/
    bioart_scraper.py
    requirements.txt
  app/                      <- Electron + React + Polotno (empty scaffold)
    src/
      main/                 <- Electron main process
      renderer/             <- React app (canvas, sidebar, toolbar)
    package.json
  bioart_library/            <- output of scraper (gitignored — large, regenerate locally)
  CLAUDE.md
```

## Immediate next steps

1. ~~Run the scraper locally, sanity-check output quality.~~ DONE — real
   vectors confirmed.
2. ~~DevTools network check on BioArt's real download flow.~~ DONE — see
   `filemapping` note above; scraper v2 pulls true SVGs.
3. Scaffold the Electron + React + Polotno shell, wire in the manifest as
   the sidebar asset source.
4. Get basic drag-drop-to-canvas working end to end before adding recolor/
   export polish.
