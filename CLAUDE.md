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

1. **Asset pipelines (Python)** — build local, categorized libraries + JSON
   manifests. DONE — `scraper/bioart_scraper.py` (NIH BioArt) and
   `scraper/bioicons_fetcher.py` (Bioicons). Both emit the same manifest
   format, and the editor mounts several libraries at once.
2. **Editor shell (Electron + React + Konva)** — canvas editor with the
   BioArt manifest as a searchable/browsable sidebar, drag-drop onto
   canvas, shape/text tools, SVG recolor, export. BUILT (v0.1) — see `app/`.
   Note: Konva, not Polotno; Polotno turned out to require a paid
   subscription for any production use.
3. **Packaging (electron-builder)** — produce a real installable desktop
   app (.dmg / .exe / .AppImage). CONFIGURED, NOT YET BUILT.

## Phase 1 — NIH BioArt pipeline (done, v2)

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

## Phase 1b — Bioicons (done)

Second asset source: [Bioicons](https://bioicons.com) — 2,830 science icons,
437 MB. Script: `scraper/bioicons_fetcher.py`.

**No scraping needed.** Bioicons is a static Nuxt site backed entirely by a
public GitHub repo (`duerrsimon/bioicons`, MIT). Every icon is a plain file in
that repo, so the fetcher streams the repo tarball in **one request** and
extracts only the icon SVGs. The repo also carries ~163 MB of draw.io stencil
libraries; streaming with `tarfile` in `r|gz` mode reads past them without
writing them to disk.

**All metadata is in the path** — there is no separate index file to fetch:

```
static/icons/{license}/{Category}/{Author}/{Name}.svg
```

**Licensing — this differs sharply from BioArt and matters.** BioArt is mostly
Public Domain; Bioicons mostly is not:

```
  1376  CC BY 3.0          885  CC BY 4.0        488  CC0 1.0
    39  MIT                 35  CC BY-SA 4.0       4  CC BY-SA 3.0
     3  BSD-3-Clause
```

**2,342 of 2,830 icons require attribution, and 39 are share-alike** — using
one of those can oblige the *entire figure* to carry the same licence. That is
exactly the kind of thing discovered at journal-submission time rather than at
design time, so the manifest records `requires_attribution` and `share_alike`
flags per icon and the editor surfaces them: a licence badge (PD / BY / SA) on
every sidebar tile, a warning in the properties panel, and a warning in the
export dialog.

**Quality**: genuine vectors, no embedded rasters, no `ns0:` prefixes (unlike
BioArt). Colours appear in both styles — Servier icons use `fill=` attributes,
DBCLS/PacBio use CSS `fill:` inside `<style>` blocks — and the existing palette
engine already handled both, so recolouring worked on Bioicons unchanged.

**Size**: median icon is 27 KB but the mean is 155 KB; 83 icons exceed 1 MB and
account for 130 MB of the 428 MB. The largest is 11.6 MB with 26,000 paths.
`--max-bytes` skips outliers if the full set is too heavy. One Bioicons
illustration has **501 distinct colours**, which is why the recolour panel caps
its swatch list at the 24 most-used and hides the rest behind a toggle.

**To run**:
```bash
python scraper/bioicons_fetcher.py --out ./bioicons_library
```

## Phase 2 — Editor shell (BUILT, v0.1)

**Stack decision CHANGED (2026-09-01): Konva, not Polotno.**

The brief said to check Polotno's licensing before committing to it. Checked —
`polotno@4.11.0`'s LICENSE.md reads:

> You can use this package for evaluation, development, and testing for 60
> days. After 60 days, all use requires a valid Polotno subscription.
> Production use requires a valid Polotno subscription at any time. Production
> use is use of this package in a live product, service, or internal tool,
> including a tool that only your own employees use.

A paid dependency defeats the project's whole premise — Morphly exists because
BioRender is proprietary and paid. So the canvas is built on **Konva +
react-konva (MIT)**, which is the engine Polotno itself is built on. What we
give up is Polotno's ready-made toolbar/layer scaffolding; what was always
going to be custom — the BioArt sidebar and the palette recolour — is
unaffected.

**Stack**: Electron 38 + React 19 + react-konva (Konva 10) + Zustand 5, bundled
by Vite 7. Plain JavaScript, no TypeScript.

**What works**:
- Asset sidebar reading `manifest.json`, with search over title + keywords
  (all terms must match, so "green virus" narrows), category filter, and
  paged rendering so 2,000 assets don't all mount at once.
- Multi-variant entries collapse to one tile with an expandable variant strip.
- Click a thumbnail to place centred, or drag it onto the canvas to drop it
  under the cursor.
- Shapes: rectangle (corner radius), ellipse, triangle, line, arrow. Text with
  font/size/style/alignment/colour and double-click inline editing.
- **SVG palette recolour** — see the recolour note below.
- Select / move / resize / rotate, multi-select, snapping guides against the
  canvas centre, canvas edges and other elements' edges.
- Layers panel: reorder by drag, rename, hide, lock, z-order buttons.
- Undo/redo (snapshot-based, 100 steps), duplicate, delete, arrow-key nudge,
  align to canvas or to selection.
- Zoom/pan (Ctrl+wheel to zoom, space-drag to pan, Ctrl+0 to fit).
- Save/open `.morphly` project files (JSON).
- Export PNG (1×/2×/4×, optional transparency), **SVG and PDF as true
  vectors**, with optional auto-appended BioArt citations.
- Keyboard shortcuts: V/R/O/L/A/T tools, Ctrl+Z/Y, Ctrl+S/O/N/D/A, Ctrl+0,
  Delete, Escape.

**How the recolour works** (the measured design, now implemented): BioArt SVGs
carry ~5 distinct colours on average (up to 21) across 25–500 shapes, and
crucially **most colours live in CSS rules inside a `<style>` block**, not on
`fill=` attributes:

```
.cls-2, .cls-3 { fill: #c5f8f6; }
.cls-3, .cls-4 { stroke: #465b5a; stroke-width: 2.19px; }
```

An attribute-only recolour would silently miss most of the artwork.
`src/renderer/lib/svgPalette.js` handles both the attribute and the CSS
declaration form, skips `none` / `url(#...)` / gradients, and is careful not to
match `stroke-width` or `stroke-miterlimit`. Colour normalisation goes through
a canvas 2D context, so named colours and `rgb()` work without a lookup table.

Recolouring is **non-destructive**: the element stores the untouched SVG text
plus a `{ fromColour: toColour }` map applied at render time, so every swatch
can be reset and the source is never lost.

Every BioArt SVG uses `ns0:`-prefixed element names, which is why the recolour
is textual rather than DOM-based — a serialise/reparse round trip tends to
mangle those prefixes. For the same reason SVG export inlines assets as nested
`<svg>` elements, which keeps each file's own namespace declarations intact.
Verified: exported SVGs render correctly in librsvg, not just in the app.

**Resolved open questions**:
- Polotno's free tier — resolved above; not usable, switched to Konva.
- Bundle the library vs. point at a folder — **points at folders**, plural.
  Several libraries mount at once and are browsed as one merged index with a
  collection filter. Paths live in the app's user-data settings, not in the
  project. Keeps the installer small (the two libraries together exceed 1.4 GB)
  and lets each be re-fetched independently.

**To run**:
```bash
cd app
npm install
npm run dev          # Vite dev server + Electron
npm start            # production build, then Electron
```
On first launch, choose the folder containing `manifest.json`.

**Known gaps / next up**:
- PNG export does not draw the citation footer (SVG and PDF do); the dialog
  says so rather than silently dropping it.
- Rotation is ignored when computing snapping/alignment boxes.
- No grouping of elements, and no image import beyond the BioArt library.

## Phase 3 — Packaging (config in place, not yet exercised)

`electron-builder` is configured in `app/package.json` for `.AppImage`
(Linux), `.exe`/NSIS (Windows) and `.dmg` (mac). Run `npm run dist` in `app/`.
Not yet built or tested on any platform.

## Repo layout (current)

```
Morphly/
  scraper/
    bioart_scraper.py       <- NIH BioArt (per-entry page scrape)
    bioicons_fetcher.py     <- Bioicons (single-request repo tarball)
    requirements.txt
  app/                      <- Electron + React + Konva editor
    src/
      main/                 <- main.js (window + morphly-asset:// protocol),
                               ipc.js, library.js, settings.js, preload.js
      renderer/
        App.jsx             <- layout, shortcuts, save/open, text overlay
        store.js            <- Zustand document + history
        lib/                <- svgPalette.js (recolour), exporters.js,
                               geometry.js (snapping), useSvgImage.js
        components/         <- Toolbar, AssetLibrary, CanvasStage,
                               Inspector, LayersPanel, ExportDialog
    package.json
  bioart_library/            <- ~1 GB, gitignored, regenerate locally
  bioicons_library/          <- 437 MB, gitignored, regenerate locally
  CLAUDE.md
```

## Immediate next steps

1. ~~Run the scraper locally, sanity-check output quality.~~ DONE — real
   vectors confirmed.
2. ~~DevTools network check on BioArt's real download flow.~~ DONE — see
   `filemapping` note above; scraper v2 pulls true SVGs.
3. ~~Scaffold the editor shell and wire in the manifest as the sidebar asset
   source.~~ DONE — on Konva rather than Polotno, see Phase 2.
4. ~~Get drag-drop-to-canvas working end to end.~~ DONE, along with recolour
   and PNG/SVG/PDF export.
5. Let the BioArt scrape finish, then exercise the app against the complete
   combined library.
6. Build and test installers (`npm run dist`). Distribute builds via Zenodo —
   they must not go into git.
