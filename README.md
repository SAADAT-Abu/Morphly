<div align="center">

<img src="icon.png" alt="Morphly" width="150">

# Morphly

**A free, offline desktop editor for scientific figures.**

Build publication-ready figures from thousands of openly licensed scientific
illustrations. Drag them onto a canvas, recolour them, add shapes and labels,
and export true vector PNG, SVG or PDF.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)
![Status](https://img.shields.io/badge/status-v0.1%20early-orange)

</div>

---

## What is Morphly?

Making a decent figure for a paper usually means either paying for a
subscription tool or fighting with general-purpose vector software that knows
nothing about biology.

Morphly is a third option. It is a desktop figure editor that sits on top of
**free, openly licensed scientific illustration libraries** (NIH BioArt and
Bioicons), giving you thousands of vetted viruses, cells, organs, lab
equipment, animals and molecules to build with. It runs entirely on your own
machine. No account, no subscription, no upload of unpublished work to anyone
else's server.

<div align="center">
<img src="docs/screenshot.png" alt="The Morphly editor: asset library, canvas, properties and layers" width="900">
</div>

## Features

- **Thousands of illustrations, searchable**: browse two libraries side by
  side, filter by collection or category, search on title, keyword or creator.
- **Recolour any vector in one click**: Morphly reads the distinct colours out
  of an illustration and lets you remap them. Change one swatch and every shape
  using that colour follows, so recolouring a 500-shape drawing is one action
  rather than five hundred. Non-destructive: the original file is never
  modified and every swatch resets.
- **Colour variants**: many BioArt entries ship the same drawing in several
  colour schemes; these collapse into one tile with a variant picker.
- **Shapes and text**: rectangles, ellipses, triangles, lines and arrows
  (no head, single or double), plus text boxes with inline editing.
- **Tables**: pick the size by pointing at a grid, then edit any cell by
  double-clicking it on the canvas. Rows and columns can be added or removed at
  any time, and headers, row shading, borders, cell padding and rounded corners
  are all adjustable.
- **Image import**: bring in plots, micrographs and photos as PNG, JPEG, GIF,
  WebP or BMP, from the toolbar or by dragging files onto the canvas.
  Images are stored inside the .morphly file, so a saved figure still opens
  after the original file has been moved or renamed.
- **Grid**: a background grid at any spacing, with optional snapping. It is a
  drawing aid only and never appears in an export.
- **Figure-friendly canvas**: presets for single-column, double-column, slide
  and poster sizes; snapping guides; alignment tools; layers with lock and
  hide; undo/redo. Drag a band across empty space to select several elements
  at once, and group them with Ctrl+G.
- **True vector export**: PNG at 1×/2×/4×, plus SVG and PDF that stay sharp at
  any size. Not a rasterised image wrapped in a PDF.
- **Attribution handled for you**: asset credits can be written into the
  footer of SVG and PDF exports automatically, correctly formatted.
- **Licence awareness built in**: every asset shows its licence, and Morphly
  warns you before exporting a figure containing share-alike artwork.

## Installation

### Download a build

Version 0.1.0 is archived on Zenodo with a citable DOI. **Both builds already
contain the full illustration libraries**, around 3,500 icons, so there is
nothing else to download and Morphly works offline the moment you open it.

| Platform | Download | Size |
| --- | --- | --- |
| Linux | [Morphly-0.1.0.AppImage](https://zenodo.org/records/22238249/files/Morphly-0.1.0.AppImage?download=1) | 465 MB |
| Windows | [Morphly Setup 0.1.0.exe](https://zenodo.org/records/22238249/files/Morphly%20Setup%200.1.0.exe?download=1) | 406 MB |

Both files, with their checksums, are on the
[Zenodo record](https://doi.org/10.5281/zenodo.22238249). macOS is not built
yet: it needs a macOS machine, and a `.dmg` will be added to a later release.

On Linux, mark the AppImage executable and run it:

```bash
chmod +x Morphly-0.1.0.AppImage
./Morphly-0.1.0.AppImage
```

Windows ships as an installer only. A portable build would unpack its entire
payload to a temporary folder on every launch, and with the libraries inside
that is close to a gigabyte of extraction before the window can appear.

**The builds are not code-signed.** Morphly is a free academic project and
Apple and Microsoft both charge for a signing certificate, so your operating
system will warn you the first time you open the app. This is expected and
does not mean anything is wrong with the download.

- **macOS**: right-click the app and choose Open, then confirm. Double
  clicking alone will be blocked by Gatekeeper.
- **Windows**: SmartScreen shows a blue "Windows protected your PC" screen.
  Click "More info", then "Run anyway".
- **Linux**: no warning, the AppImage just needs the executable bit above.


### Run from source

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/SAADAT-Abu/Morphly.git
cd Morphly/app
npm install
npm run dev      # development, with hot reload
npm start        # production build, then launch
```

To build installers for your platform:

```bash
npm run dist     # output lands in app/release/
```

## Getting the asset libraries

**The packaged builds already contain both libraries**, around 3,500
illustrations in all, which is why an installer is roughly 450 MB. They are
mounted automatically the first time you open the app, so it works offline
straight away with nothing to download or configure.

You only need this section if you are running from source, or if you want to
mount an extra library or a fresher copy of one. Morphly can read any number of
library folders from anywhere on disk, and each can be removed independently of
the bundled ones. To build one yourself:

```bash
pip install -r scraper/requirements.txt

# NIH BioArt: ~2,000 illustrations, many with colour variants
python scraper/bioart_scraper.py --start 1 --end 5000 --out ./bioart_library

# Bioicons: 2,830 icons, fetched in a single request
python scraper/bioicons_fetcher.py --out ./bioicons_library
```

Both scripts write a `manifest.json` alongside the SVGs. In Morphly, use
**File → Add asset library folder** and select the folder containing that
file. Both libraries can be mounted at once and are browsed together.

<details>
<summary>Notes on the fetchers</summary>

- `bioart_scraper.py` walks BioArt's sequential entry IDs and reads each
  entry's page. It is resumable (`--resume`) and writes its manifest
  incrementally, so an interrupted run loses at most one entry. It defaults to
  SVG only; pass `--formats SVG,PNG,AI` if you need other formats.
- `bioicons_fetcher.py` streams the Bioicons GitHub repository tarball in one
  request rather than making thousands of requests to the website, and
  extracts only the icons. Use `--max-bytes` to skip unusually heavy icons.
  The median is ~27 KB but a few exceed 10 MB.
- The libraries are large (roughly 1 GB and 440 MB respectively), which is why
  they are generated locally rather than committed.

</details>

## Quick start

1. **Add a library**: already done in a packaged build, both libraries are
   bundled. From source, use File → Add asset library folder.
2. **Place artwork**: search the sidebar, then click a thumbnail to drop it on
   the page, or drag it exactly where you want it.
3. **Recolour**: select the illustration and edit the swatches in the Colours
   panel.
4. **Build the figure**: add shapes, arrows and labels from the toolbar, and
   tables or images from the toolbar buttons beside them. Pink guides appear as things line up,
   and the grid button gives you a background grid to work against.
5. **Export**: PNG for a quick look, SVG to keep editing elsewhere, PDF for
   submission. Leave *Append asset citations* ticked.

Press <kbd>F1</kbd> in the app for full help, including every keyboard
shortcut. The welcome screen appears on first launch and stays available from
**Help → Show welcome screen**.

<div align="center">
<img src="docs/welcome.png" alt="Morphly's welcome screen" width="800">
</div>

## Licensing and attribution

**This matters, and Morphly is built to make it easy.**

The MIT licence in [`LICENSE`](LICENSE) covers Morphly's **source code only**.
The illustrations have their own licences, set by the artists who made them.
Morphly never bundles or redistributes them. See [`NOTICE.md`](NOTICE.md).

There are three cases in practice:

| | Meaning | What you do |
|---|---|---|
| **Public domain** <br>(all of NIH BioArt, CC0 icons in Bioicons) | Use for anything, including commercially. | Nothing. Credit is appreciated, never required. |
| **Credit required** <br>(most of Bioicons: CC BY, MIT, BSD) | Use for anything, including commercially, as long as you name the artist. | Keep a credit line. Morphly writes it for you at export. |
| **Share-alike** <br>(a few Bioicons: CC BY-SA) | Credit required, **and** derivative works must carry the same open licence, which can extend to your whole figure. | Fine for open-access work. Think twice if a publisher wants exclusive rights. Morphly warns you before export. |

Every thumbnail in the sidebar carries a **PD**, **BY** or **SA** badge, the
properties panel shows the full credit line for whatever is selected, and the
export dialog warns you if any share-alike artwork is in the figure.

> This is a plain-language summary, not legal advice. For share-alike
> specifically, check with your institution or target journal.

## Credits

Morphly is a thin layer over other people's excellent work.

### Illustration libraries

- **[NIH BioArt Source](https://bioart.niaid.nih.gov)**: NIAID Visual & Medical
  Arts, National Institutes of Health. ~2,000 vetted scientific and medical
  illustrations, public domain.
- **[Bioicons](https://bioicons.com)**: created and maintained by
  [Simon Duerr](https://github.com/duerrsimon/bioicons), with icons contributed
  by ~130 artists. The largest contributors are
  **[Servier Medical Art](https://smart.servier.com)** and
  **[DBCLS](https://togotv.dbcls.jp)**.

Morphly is not affiliated with, endorsed by, or connected to NIAID/NIH,
Bioicons or any contributing artist. All credit for the artwork belongs to its
creators.

### Built with

| Project | Role | Licence |
|---|---|---|
| [Electron](https://electronjs.org) | Desktop shell | MIT |
| [React](https://react.dev) | User interface | MIT |
| [Konva](https://konvajs.org) / [react-konva](https://github.com/konvajs/react-konva) | Canvas engine | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | Editor state | MIT |
| [Vite](https://vite.dev) | Build tooling | MIT |
| [electron-builder](https://www.electron.build) | Installers | MIT |
| [Requests](https://requests.readthedocs.io) | Asset fetching | Apache-2.0 |
| [Beautiful Soup](https://www.crummy.com/software/BeautifulSoup/) | Asset fetching | MIT |

## Found a bug? Want a feature?

Please [open an issue](https://github.com/SAADAT-Abu/Morphly/issues) rather
than emailing, so other users can see it and chip in. Bug reports are most
useful with your OS, what you did, and what happened instead.

## Citing Morphly

If Morphly helped make a figure in your work, please cite the archived
release:

> Saadat, A. (2026). *Morphly: a free desktop editor for scientific figures*
> (version 0.1.0) [Software]. Zenodo. https://doi.org/10.5281/zenodo.22238249

To cite whichever version is current rather than this one, use the concept DOI
[10.5281/zenodo.22238248](https://doi.org/10.5281/zenodo.22238248), which always
resolves to the latest release.

Illustrations should be cited to their original libraries, not to Morphly.
Ticking *Append asset citations* on export produces correctly formatted credits
for everything used in the figure.

## Author

**Abu Saadat**, Postdoctoral Fellow, Josep Carreras Leukaemia Research
Institute (IJC), Barcelona.

Morphly is a side project, built because good scientific figures should not
require a subscription.

## Licence

[MIT](LICENSE). See [`NOTICE.md`](NOTICE.md) for how this relates to the
illustration licences.
